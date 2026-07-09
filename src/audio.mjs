import { extractSpeechText } from './speech-text.mjs'
import { createTtsProvider } from './tts.mjs'
import { sha256 } from './utils.mjs'

// Read-aloud audio ("Vorlesen") after the outbox blueprint: publishing enqueues
// a row in ck_audio_jobs, a setInterval poller synthesizes MP3s minutes later
// and files them as ordinary ck_assets. The player only renders when an asset
// exists, so the async gap is invisible — never a broken page state.
//
// Idempotency hangs on UNIQUE(item_id, speech_sha256), where the hash covers
// the extracted speech text: re-publishing a revision, or editing only a code
// block or the sources section, finds the existing job and enqueues nothing.

// Google prices Chirp 3 HD at 30 USD per million characters; used for the
// backfill dry-run estimate only, never for billing.
const USD_PER_MILLION_CHARS = 30

// The `processing` status doubles as a lease: the claim pushes next_attempt_at
// this far ahead, so a worker crash mid-synthesis re-surfaces the job instead
// of stranding it.
const PROCESSING_LEASE_MS = 15 * 60 * 1000

// Exponential backoff (base 60s, doubling, capped 1h) with ±15% jitter, same
// shape as webhook deliveries but slower: TTS failures are usually quota or
// upstream outages, not blips.
function nextDelaySeconds(attempts) {
  const base = Math.min(60 * 2 ** Math.min(attempts - 1, 6), 3600)
  return base * (0.85 + Math.random() * 0.3)
}

const isUniqueViolation = (error) => /duplicate key|unique constraint/i.test(String(error.message || error))

const JOB_STATUSES = ['pending', 'processing', 'done', 'failed', 'skipped']

const estimatedUsd = (chars) => Math.round((chars / 1_000_000) * USD_PER_MILLION_CHARS * 100) / 100

// Total, locale-independent comparator (see site-builder.mjs for the rationale).
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export function createAudioWorker(config, db, repo, storage, logger, ttsFactory = createTtsProvider) {
  let timer
  let running = false
  // One provider instance per name; sites choose via settings.audio.provider.
  const providers = new Map()
  const providerFor = (name) => {
    const key = name || 'google'
    if (!providers.has(key)) providers.set(key, ttsFactory(config, key))
    return providers.get(key)
  }

  // The release manager is constructed *with* this worker (its onPublished hook
  // enqueues jobs here), so the worker cannot receive it in its own constructor.
  // server.mjs injects the publish function afterwards via setPublisher() —
  // a late-bound reference instead of an import cycle.
  let publishRelease = null

  // Debounced auto-rebuild, one timer per site: a finished narration only
  // reaches visitors through a new release, and a burst of completions (e.g.
  // a backfill draining) must coalesce into a single build. No loop is
  // possible: the rebuild publishes with empty revision_ids, and the
  // onPublished hook only fires when revisionIds is non-empty.
  const rebuildTimers = new Map()

  function scheduleRebuild(site) {
    if (!site || site.settings?.audio?.auto_rebuild === false) return false
    clearTimeout(rebuildTimers.get(site.id))
    const handle = setTimeout(() => {
      rebuildTimers.delete(site.id)
      if (!publishRelease) return
      Promise.resolve(publishRelease({ siteId: site.id, revisionIds: [], reason: 'audio auto-rebuild' })).catch(
        (error) => logger.warn('audio auto-rebuild failed', { siteId: site.id, error: String(error.message || error) }),
      )
    }, config.audioRebuildDebounceMs ?? 60000)
    handle.unref?.()
    rebuildTimers.set(site.id, handle)
    return true
  }

  // Characters consumed in the current UTC calendar month. Pending/processing
  // jobs count — they will be synthesized and billed; skipped ones never are.
  // Filtered in memory (like maintenance.mjs) because the query builder has no
  // gte/neq operators, and a site's job count stays small.
  async function charsThisMonth(siteId, now = new Date()) {
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    const jobs = await db.select('ck_audio_jobs', { site_id: `eq.${siteId}` })
    return jobs
      .filter((job) => job.status !== 'skipped' && new Date(job.created_at).getTime() >= monthStart)
      .reduce((sum, job) => sum + Number(job.chars || 0), 0)
  }

  // Best-effort asset removal for superseded or deleted narrations. Audio MP3s
  // are ordinary content-addressed ck_assets, but nothing except ck_audio_jobs
  // ever references them — and storage-gc only sweeps release objects (see
  // maintenance.mjs), so this is the one place their bytes get reclaimed.
  async function removeAsset(assetId) {
    try {
      const asset = await repo.one('ck_assets', { id: `eq.${assetId}` })
      if (!asset) return false
      if (storage.remove) await storage.remove([asset.storage_path])
      if (db.remove) await db.remove('ck_assets', { id: `eq.${assetId}` })
      return true
    } catch (error) {
      logger.warn('audio asset cleanup failed', { assetId, error: String(error.message || error) })
      return false
    }
  }

  async function insertJob({ site, item, revision, speech, force = false }) {
    const existing = await repo.one('ck_audio_jobs', { item_id: `eq.${item.id}`, speech_sha256: `eq.${speech.sha256}` })
    if (existing) {
      if (!force) return false
      // Re-render on demand (voice change, provider fix): reset the job instead
      // of fighting the unique constraint. The previous asset stays referenced
      // until the worker finishes and swaps it, so a live player never 404s.
      await db.update(
        'ck_audio_jobs',
        { id: `eq.${existing.id}` },
        { status: 'pending', attempts: 0, error: null, next_attempt_at: new Date().toISOString() },
        { returning: false },
      )
      return true
    }
    try {
      await db.insert(
        'ck_audio_jobs',
        {
          site_id: site.id,
          item_id: item.id,
          revision_id: revision.id,
          speech_sha256: speech.sha256,
          status: 'pending',
          chars: speech.chars,
          next_attempt_at: new Date().toISOString(),
        },
        { returning: false },
      )
      return true
    } catch (error) {
      // A concurrent enqueue won the race to the same speech hash — that is the
      // idempotent outcome, not a failure.
      if (isUniqueViolation(error)) return false
      throw error
    }
  }

  // Fire-and-forget hook target for a successful release: enqueue a job per
  // published post revision whose speech text is new. Site-level opt-in
  // (settings.audio.enabled) and the frontmatter override (audio: false) are
  // both honoured here, so the worker only ever sees intended jobs.
  async function enqueueAudioJobs({ siteId, revisionIds = [] }) {
    if (!revisionIds.length) return { enqueued: 0 }
    const site = await repo.getSite(siteId)
    if (!site || site.settings?.audio?.enabled !== true) return { enqueued: 0 }
    const budget = Number(site.settings?.audio?.monthly_char_budget)
    let enqueued = 0
    for (const revisionId of revisionIds) {
      const revision = await repo.one('ck_content_revisions', { id: `eq.${revisionId}` })
      if (!revision) continue
      const item = await repo.one('ck_content_items', { id: `eq.${revision.item_id}`, site_id: `eq.${site.id}` })
      if (!item || item.kind !== 'post') continue
      const speech = extractSpeechText(revision.markdown, { title: revision.title })
      if (!speech.enabled || !speech.chars) continue
      // The monthly budget is a hard stop for automatic enqueuing — a publish
      // must never silently overrun the TTS quota. Backfill keeps its own
      // explicit budget handling (limit_chars) and is unaffected here.
      if (Number.isFinite(budget) && budget > 0 && (await charsThisMonth(site.id)) + speech.chars > budget) {
        logger.warn('audio budget exhausted', { siteId: site.id, itemId: item.id, chars: speech.chars })
        continue
      }
      if (await insertJob({ site, item, revision, speech })) enqueued++
    }
    if (enqueued) logger.info('audio jobs enqueued', { siteId: site.id, enqueued })
    return { enqueued }
  }

  // Archive backfill: walk the published posts newest-first, skip everything
  // that already has a job for its current speech text, and stop at the
  // character budget (limit_chars, else settings.audio.monthly_char_budget).
  // dry_run prices the batch without enqueuing anything. An optional slugs
  // list narrows the walk to specific posts (still budget- and idempotency-
  // checked), which is how a single post gets its narration on demand.
  async function backfill({ site, limitChars, dryRun = false, slugs, force = false }) {
    const settings = site.settings?.audio || {}
    if (settings.enabled !== true) {
      throw Object.assign(new Error('audio is not enabled for this site (settings.audio.enabled)'), {
        statusCode: 409,
      })
    }
    const items = await db.select('ck_content_items', {
      site_id: `eq.${site.id}`,
      kind: 'eq.post',
      published_revision_id: 'not.is.null',
    })
    const itemsByRevision = new Map(items.map((item) => [item.published_revision_id, item]))
    const revisionIds = [...itemsByRevision.keys()]
    const revisions = revisionIds.length
      ? await db.select('ck_content_revisions', { id: `in.(${revisionIds.join(',')})` })
      : []
    revisions.sort((a, b) => cmp(String(b.published_at || ''), String(a.published_at || '')))
    const slugFilter = Array.isArray(slugs) && slugs.length ? new Set(slugs.map(String)) : null
    const selected = slugFilter ? revisions.filter((revision) => slugFilter.has(revision.slug)) : revisions
    const requested = Number(limitChars ?? settings.monthly_char_budget)
    const budget = Number.isFinite(requested) && requested > 0 ? requested : Infinity
    const jobs = []
    let totalChars = 0
    let skipped = 0
    for (const revision of selected) {
      const item = itemsByRevision.get(revision.id)
      const speech = extractSpeechText(revision.markdown, { title: revision.title })
      if (!speech.enabled || !speech.chars) {
        skipped++
        continue
      }
      if (
        !force &&
        (await repo.one('ck_audio_jobs', { item_id: `eq.${item.id}`, speech_sha256: `eq.${speech.sha256}` }))
      ) {
        skipped++
        continue
      }
      // Newest-first until the budget is spent; the next backfill run picks up
      // where this one stopped, which is how the free tier gets stretched.
      if (totalChars + speech.chars > budget) break
      totalChars += speech.chars
      jobs.push({ item, revision, speech })
    }
    let enqueued = 0
    if (!dryRun) {
      for (const job of jobs) {
        if (await insertJob({ site, ...job, force })) enqueued++
      }
    }
    return {
      dry_run: dryRun,
      jobs: jobs.map(({ item, revision, speech }) => ({
        item_id: item.id,
        revision_id: revision.id,
        title: revision.title,
        chars: speech.chars,
      })),
      total_chars: totalChars,
      estimated_usd: estimatedUsd(totalChars),
      skipped,
      ...(dryRun ? {} : { enqueued }),
    }
  }

  // Status of the newest job for one content item, with the /media URL once done.
  async function status(itemId) {
    const job = await repo.one('ck_audio_jobs', { item_id: `eq.${itemId}`, order: 'created_at.desc' })
    if (!job) return { item_id: itemId, status: 'none', audio: null }
    let audio = null
    if (job.status === 'done' && job.asset_id) {
      const asset = await repo.one('ck_assets', { id: `eq.${job.asset_id}` })
      if (asset) {
        audio = {
          url: `/media/${asset.id}/${encodeURIComponent(asset.filename)}`,
          content_type: asset.content_type,
          byte_size: Number(asset.byte_size),
          duration_secs: job.duration_secs,
        }
      }
    }
    return {
      item_id: itemId,
      status: job.status,
      job: {
        id: job.id,
        revision_id: job.revision_id,
        speech_sha256: job.speech_sha256,
        attempts: job.attempts,
        chars: job.chars,
        duration_secs: job.duration_secs,
        error: job.error,
        created_at: job.created_at,
        updated_at: job.updated_at,
      },
      audio,
    }
  }

  // DELETE /v1/content/{item}/audio: drop every job for the item and every
  // narration asset those jobs referenced, then schedule a rebuild so the
  // player and podcast entry disappear from the live site.
  async function remove({ site, item }) {
    const jobs = await db.select('ck_audio_jobs', { item_id: `eq.${item.id}` })
    const assetIds = [...new Set(jobs.map((job) => job.asset_id).filter(Boolean))]
    let deletedAssets = 0
    for (const assetId of assetIds) if (await removeAsset(assetId)) deletedAssets++
    if (jobs.length && db.remove) await db.remove('ck_audio_jobs', { item_id: `eq.${item.id}` })
    const rebuildScheduled = jobs.length ? scheduleRebuild(site) : false
    if (jobs.length) logger.info('audio deleted', { itemId: item.id, jobs: jobs.length, assets: deletedAssets })
    return {
      item_id: item.id,
      deleted_jobs: jobs.length,
      deleted_assets: deletedAssets,
      rebuild_scheduled: rebuildScheduled,
    }
  }

  // Operations view for GET /v1/sites/{site}/audio/jobs: newest jobs first
  // (optionally filtered by status), each resolved to its revision's slug and
  // title, plus a summary with per-status counters and the monthly budget.
  async function listJobs({ site, status, limit = 100 }) {
    if (status && !JOB_STATUSES.includes(status)) {
      throw Object.assign(new Error(`status must be one of ${JOB_STATUSES.join(', ')}`), { statusCode: 422 })
    }
    const all = await db.select('ck_audio_jobs', { site_id: `eq.${site.id}`, order: 'created_at.desc' })
    const counters = Object.fromEntries(JOB_STATUSES.map((name) => [name, 0]))
    for (const job of all) if (job.status in counters) counters[job.status]++
    const cap = Math.min(Math.max(Number(limit) || 100, 1), 500)
    const page = (status ? all.filter((job) => job.status === status) : all).slice(0, cap)
    const revisionIds = [...new Set(page.map((job) => job.revision_id).filter(Boolean))]
    const revisions = revisionIds.length
      ? await db.select('ck_content_revisions', { id: `in.(${revisionIds.join(',')})` })
      : []
    const byRevision = new Map(revisions.map((revision) => [revision.id, revision]))
    const used = await charsThisMonth(site.id)
    const budget = Number(site.settings?.audio?.monthly_char_budget)
    const budgeted = Number.isFinite(budget) && budget > 0
    return {
      jobs: page.map((job) => ({
        id: job.id,
        item_id: job.item_id,
        slug: byRevision.get(job.revision_id)?.slug || null,
        title: byRevision.get(job.revision_id)?.title || null,
        status: job.status,
        attempts: job.attempts,
        chars: job.chars,
        error: job.error,
        created_at: job.created_at,
        updated_at: job.updated_at,
      })),
      summary: {
        ...counters,
        chars_this_month: used,
        monthly_char_budget: budgeted ? budget : null,
        budget_remaining: budgeted ? Math.max(0, budget - used) : null,
      },
    }
  }

  async function markSkipped(job, reason) {
    await db.update(
      'ck_audio_jobs',
      { id: `eq.${job.id}` },
      { status: 'skipped', error: reason, updated_at: new Date().toISOString() },
      { returning: false },
    )
  }

  async function process(job) {
    // Captured before any update: a force-reset job still points at the asset
    // it is about to replace, and that reference is what gets cleaned up at
    // the swap point below.
    const previousAssetId = job.asset_id
    // Claim with a lease: a crash mid-synthesis re-surfaces the job after the
    // lease instead of stranding it in `processing` forever.
    await db.update(
      'ck_audio_jobs',
      { id: `eq.${job.id}` },
      {
        status: 'processing',
        next_attempt_at: new Date(Date.now() + PROCESSING_LEASE_MS).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { returning: false },
    )
    const site = await repo.getSite(job.site_id)
    const revision = await repo.one('ck_content_revisions', { id: `eq.${job.revision_id}` })
    if (!site || !revision) return markSkipped(job, 'site or revision no longer exists')
    const speech = extractSpeechText(revision.markdown, { title: revision.title })
    if (!speech.enabled || !speech.text) return markSkipped(job, 'speech text is empty or disabled')
    const settings = site.settings?.audio || {}
    const provider = providerFor(settings.provider)
    const { audio, contentType, durationSecs } = await provider.synthesize(speech.text, { voice: settings.voice })
    // File the MP3 exactly like an uploaded asset (see repo.ingest): content-
    // addressed storage path plus a ck_assets row, so /media serves it with
    // immutable caching and independent of any release.
    const hash = sha256(audio)
    const filename = `${revision.slug}-vorlesen.mp3`
    const storagePath = `sites/${site.id}/assets/${hash}/${filename}`
    await storage.upload(storagePath, audio, contentType, '31536000', true)
    const existing = await repo.one('ck_assets', { site_id: `eq.${site.id}`, sha256: `eq.${hash}` })
    const asset =
      existing ||
      (
        await db.insert('ck_assets', {
          site_id: site.id,
          sha256: hash,
          filename,
          storage_path: storagePath,
          content_type: contentType,
          byte_size: audio.length,
        })
      )[0]
    await db.update(
      'ck_audio_jobs',
      { id: `eq.${job.id}` },
      {
        status: 'done',
        asset_id: asset.id,
        duration_secs: Math.max(1, Math.round(durationSecs)),
        chars: speech.chars,
        error: null,
        attempts: Number(job.attempts || 0) + 1,
        updated_at: new Date().toISOString(),
      },
      { returning: false },
    )
    // The swap point of a force re-render: the job carried the previous asset
    // until the new one was safely referenced (so a live player never 404ed);
    // now the superseded MP3 is unreachable and its bytes can go. Best effort.
    if (previousAssetId && previousAssetId !== asset.id) await removeAsset(previousAssetId)
    logger.info('audio synthesized', {
      jobId: job.id,
      itemId: job.item_id,
      assetId: asset.id,
      chars: speech.chars,
      durationSecs: Math.round(durationSecs),
    })
    scheduleRebuild(site)
  }

  async function onFailure(job, error) {
    const attempts = Number(job.attempts || 0) + 1
    const terminal = attempts >= config.audioMaxAttempts
    await db
      .update(
        'ck_audio_jobs',
        { id: `eq.${job.id}` },
        {
          attempts,
          status: terminal ? 'failed' : 'pending',
          error: String(error.message || error).slice(0, 500),
          next_attempt_at: new Date(Date.now() + nextDelaySeconds(attempts) * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { returning: false },
      )
      .catch(() => {})
    logger.warn('audio job failed', { jobId: job.id, attempts, terminal, error: String(error.message || error) })
  }

  async function tick() {
    if (running) return
    running = true
    try {
      const jobs = await db.select('ck_audio_jobs', {
        status: 'in.(pending,processing)',
        next_attempt_at: `lte.${new Date().toISOString()}`,
        order: 'created_at.asc',
        limit: '3',
      })
      for (const job of jobs) {
        try {
          await process(job)
        } catch (error) {
          await onFailure(job, error)
        }
      }
    } catch (error) {
      logger.error('audio poll failed', { error: String(error.message || error) })
    } finally {
      running = false
    }
  }

  return {
    enqueueAudioJobs,
    backfill,
    status,
    remove,
    listJobs,
    tick,
    setPublisher(fn) {
      publishRelease = fn
    },
    start() {
      timer = setInterval(tick, config.audioPollMs)
      timer.unref?.()
      tick()
    },
    stop() {
      clearInterval(timer)
      for (const handle of rebuildTimers.values()) clearTimeout(handle)
      rebuildTimers.clear()
    },
  }
}
