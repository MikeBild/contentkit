import { randomBytes, randomUUID } from 'node:crypto'
import { createBuildRunner } from './build-runner.mjs'
import { buildSite } from './site-builder.mjs'
import { WEBHOOK_EVENT } from './webhook-events.mjs'
import { sha256 } from './utils.mjs'

export function normalizePreviewSlug(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(slug)) {
    throw Object.assign(new Error('preview slug must be 3-80 lowercase letters, numbers or hyphens'), {
      statusCode: 422,
    })
  }
  return slug
}

// A permit-handoff semaphore: release() passes its slot straight to the next
// waiter rather than decrementing and re-incrementing, so a fresh acquire() in
// the wake-up gap can never over-admit past the limit.
export function createSemaphore(limit) {
  let active = 0
  const waiters = []
  return {
    active: () => active,
    async acquire() {
      if (active < limit) {
        active++
        return
      }
      await new Promise((resolve) => waiters.push(resolve))
    },
    release() {
      const next = waiters.shift()
      if (next) next()
      else active--
    },
  }
}

// Content identity for approval bindings. Storage paths deliberately do not
// participate: dedup may reuse an older object's path, while the bytes, media
// type and cache semantics remain identical. Sorting makes the digest stable
// across concurrent upload completion order.
export function releaseManifestSha256({
  siteId,
  basePublishEpoch,
  revisionIds = [],
  retireItemIds = [],
  entries = [],
}) {
  const manifest = {
    schema_version: 1,
    site_id: siteId,
    base_publish_epoch: String(basePublishEpoch ?? 0),
    revision_ids: [...revisionIds].sort(),
    retire_item_ids: [...retireItemIds].sort(),
    entries: entries
      .map(({ path, content_type, byte_size, sha256: digest, cache_control }) => ({
        path,
        content_type,
        byte_size: Number(byte_size),
        sha256: digest,
        cache_control: cache_control ?? null,
      }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
  }
  return sha256(JSON.stringify(manifest))
}

// Derives the content.* webhook events for a release activation from the
// pointer transitions it is about to make: published fires only when an
// overlay revision actually changes an item's published pointer (a no-op
// republish stays silent), unpublished only for retired items whose pointer
// was set. Payloads carry no absolute URLs — the URL layout is the site
// builder's contract, not the CMS's.
async function contentTransitionEvents(db, snapshot, retireItemIds, releaseId) {
  const itemsById = new Map((snapshot.items || []).map((item) => [item.id, item]))
  const events = []
  for (const revision of snapshot.overlay || []) {
    const item = itemsById.get(revision.item_id)
    if (!item || item.published_revision_id === revision.id) continue
    events.push({
      type: WEBHOOK_EVENT.contentPublished,
      resourceKind: 'content',
      resourceId: item.id,
      summary: 'Content published',
      data: {
        item_id: item.id,
        kind: item.kind,
        locale: item.locale,
        translation_key: item.translation_key,
        slug: revision.slug,
        title: revision.title,
        revision_id: revision.id,
        release_id: releaseId,
      },
    })
  }
  // Retired items are excluded from the snapshot's rendered set, so their
  // until-now published revisions (for slug/title) are loaded separately.
  const retiring = retireItemIds.map((itemId) => itemsById.get(itemId)).filter((item) => item?.published_revision_id)
  if (retiring.length) {
    const revisions = await db.select('ck_content_revisions', {
      id: `in.(${retiring.map((item) => item.published_revision_id).join(',')})`,
    })
    const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]))
    for (const item of retiring) {
      const revision = revisionsById.get(item.published_revision_id)
      events.push({
        type: WEBHOOK_EVENT.contentUnpublished,
        resourceKind: 'content',
        resourceId: item.id,
        summary: 'Content unpublished',
        data: {
          item_id: item.id,
          kind: item.kind,
          locale: item.locale,
          translation_key: item.translation_key,
          slug: revision?.slug ?? null,
          title: revision?.title ?? null,
          revision_id: item.published_revision_id,
          release_id: releaseId,
        },
      })
    }
  }
  return events
}

// The rendering half of a release runs off the API's event loop. Measured with
// scripts/loadtest-release-build.mjs, which publishes through this manager:
// releasing 1000 documents in-process left an unrelated GET /health waiting
// 10 197 ms of the publish's 10 233 ms. Off-thread the worst wait is 4.69 ms and
// the publish takes 10 283 ms — half a percent slower for a two-thousandfold
// better answer. See src/build-runner.mjs for why a Worker and not a fork.
//
// Only the pure part moves. `buildSite` returns bytes or throws; every Postgres
// and object-storage write below — the entries, the activation RPC, the event
// enqueue, the cleanup on failure — stays on this thread inside the same
// transaction it was always in. A worker cannot produce a half-committed
// release, only bytes or an error.
//
// `config.buildWorker === false` keeps the old in-process path as an operator
// escape hatch. It has no environment variable yet: config.mjs needs a
// `buildWorker` entry (and CONTENTKIT_BUILD_WORKER in .env.defaults) before an
// operator can reach it without editing code.
function createBuildStrategy(config, logger, hooks) {
  if (hooks.buildRunner) return hooks.buildRunner
  if (config.buildWorker === false) {
    return {
      build: (input) => buildSite({ root: config.root, logger, deckRenderer: hooks.deckRenderer, ...input }),
      async close() {},
    }
  }
  return createBuildRunner({
    root: config.root,
    logger,
    deckRenderer: hooks.deckRenderer,
    // The semaphore below already admits at most this many builds, so a worker
    // per admitted build is the ceiling — never a queue behind a queue.
    concurrency: config.buildConcurrency || 1,
    // A warm worker saves ~2.6s of module compilation on the next build and
    // costs the retained build heap until it goes.
    idleMs: config.buildWorkerIdleMs ?? 60000,
    timeoutMs: config.buildTimeoutMs ?? 0,
  })
}

export function createReleaseManager(config, repo, db, storage, logger, hooks = {}) {
  const semaphore = createSemaphore(config.buildConcurrency)
  const acquire = () => semaphore.acquire()
  const release = () => semaphore.release()
  const builder = createBuildStrategy(config, logger, hooks)

  async function build({
    siteId,
    revisionIds = [],
    retireItemIds = [],
    kind = 'release',
    expiresIn = 3600,
    previewSlug = '',
    reason = '',
  }) {
    await acquire()
    const buildStarted = Date.now()
    const releaseId = randomUUID()
    let prefix
    let deckCount = 0
    let deckSlides = 0
    let deckSvg = 0
    let deckPng = 0
    let deckCacheResult
    const entries = []
    // Only paths this build actually uploaded. The failure cleanup below must
    // iterate these, never `entries`: an entry may reference an object owned by
    // the still-active previous release, and removing it would break the live
    // site.
    const uploadedPaths = []
    try {
      const snapshot = await repo.buildSnapshot(siteId, revisionIds, retireItemIds)
      deckCount = snapshot.revisions.filter((revision) => revision.kind === 'deck').length
      await db.insert('ck_releases', {
        id: releaseId,
        site_id: snapshot.site.id,
        kind,
        status: 'building',
        reason,
        revision_ids: revisionIds,
        retire_item_ids: retireItemIds,
        base_publish_epoch: snapshot.site.publish_epoch ?? 0,
      })
      // Only what buildSite reads crosses the thread boundary. `items` and
      // `overlay` stay here: the CMS pointer bookkeeping below needs them, and
      // the build does not.
      const built = await builder.build({
        site: snapshot.site,
        locales: snapshot.locales,
        revisions: snapshot.revisions,
        comments: snapshot.comments,
        audio: snapshot.audio,
        accessRules: snapshot.accessRules,
        accessGroups: snapshot.accessGroups,
      })
      const decks = built.content.filter((item) => item.kind === 'deck')
      deckCount = decks.length
      deckSlides = decks.reduce((sum, item) => sum + (item.slide_count || 0), 0)
      deckSvg = decks.reduce(
        (sum, item) =>
          sum + (item.deck_artifacts?.length || 0) * (item.deck_plan?.settings?.visual_scheme === 'auto' ? 2 : 1),
        0,
      )
      deckPng = deckSvg
      deckCacheResult = decks.length ? (decks.every((item) => item.deck_cache_result === 'hit') ? 'hit' : 'miss') : null
      prefix = `sites/${snapshot.site.id}/releases/${releaseId}`
      // Reuse unchanged objects from the currently-active release instead of
      // re-uploading them. Safe against the GC: the source release stays
      // 'active' — and therefore uncollectable — until our own activation,
      // which runs after the entries insert, so every reused object is
      // re-referenced before its source could be swept. cache_control belongs
      // to the stored object (serving derives response headers from it), so it
      // is part of the match key; legacy entries carry NULL there and simply
      // never match.
      const previous = new Map()
      if (snapshot.site.active_release_id) {
        const rows = await db.select('ck_release_entries', { release_id: `eq.${snapshot.site.active_release_id}` })
        for (const row of rows) previous.set(row.path, row)
      }
      const files = [...built.files]
      const ordered = new Array(files.length)
      const uploads = createSemaphore(config.uploadConcurrency ?? 8)
      let uploadError = null
      await Promise.all(
        files.map(async ([path, file], index) => {
          const digest = sha256(file.body)
          const cacheControl = file.cacheControl ?? null
          const entry = {
            release_id: releaseId,
            path,
            content_type: file.contentType,
            byte_size: file.body.length,
            sha256: digest,
            cache_control: cacheControl,
          }
          const prior = previous.get(path)
          if (
            prior &&
            prior.sha256 === digest &&
            prior.content_type === file.contentType &&
            (prior.cache_control ?? null) === cacheControl
          ) {
            ordered[index] = { ...entry, storage_path: prior.storage_path }
            return
          }
          await uploads.acquire()
          try {
            // Fail fast after the first error, but let every in-flight upload
            // settle before build() throws — the cleanup in the catch block
            // must see each object that actually landed.
            if (uploadError) return
            await storage.upload(`${prefix}/${path}`, file.body, file.contentType, file.cacheControl, false)
            uploadedPaths.push(`${prefix}/${path}`)
            ordered[index] = { ...entry, storage_path: `${prefix}/${path}` }
          } catch (error) {
            uploadError ??= error
          } finally {
            uploads.release()
          }
        }),
      )
      if (uploadError) throw uploadError
      entries.push(...ordered)
      await db.insert('ck_release_entries', entries, { returning: false })
      const manifestSha256 = releaseManifestSha256({
        siteId: snapshot.site.id,
        basePublishEpoch: snapshot.site.publish_epoch,
        revisionIds,
        retireItemIds,
        entries,
      })
      logger.info?.('release uploaded', {
        release_id: releaseId,
        uploaded: uploadedPaths.length,
        reused: entries.length - uploadedPaths.length,
      })
      if (built.accessEntries?.length) {
        await db.insert(
          'ck_release_access_entries',
          built.accessEntries.map((entry) => ({ release_id: releaseId, ...entry })),
          { returning: false },
        )
      }
      if (built.accessCatalog?.length) {
        await db.insert(
          'ck_release_access_catalog',
          built.accessCatalog.map((entry) => ({ release_id: releaseId, ...entry })),
          { returning: false },
        )
      }
      await db.update(
        'ck_releases',
        { id: `eq.${releaseId}` },
        {
          status: kind === 'preview' ? 'preview' : 'ready',
          storage_prefix: prefix,
          file_count: entries.length,
          manifest_sha256: manifestSha256,
          completed_at: new Date().toISOString(),
        },
      )
      if (kind === 'release') {
        const events = await contentTransitionEvents(db, snapshot, retireItemIds, releaseId)
        const published = events.filter((event) => event.type === WEBHOOK_EVENT.contentPublished)
        const publishedCount = published.length
        const unpublishedCount = events.filter((event) => event.type === WEBHOOK_EVENT.contentUnpublished).length
        const builtDecks = new Map(decks.map((deck) => [deck.item_id, deck]))
        for (const event of published.filter((entry) => entry.data.kind === 'deck')) {
          const deck = builtDecks.get(event.resourceId)
          events.push({
            type: WEBHOOK_EVENT.deckPublished,
            resourceKind: 'deck',
            resourceId: event.resourceId,
            summary: 'Slide deck published',
            data: {
              ...event.data,
              url: deck?.url || null,
              slide_count: deck?.slide_count || 0,
              plan_sha256: deck?.deck_plan?.plan_sha256 || null,
              component_count: deck?.deck_artifacts?.length || 0,
            },
          })
        }
        events.push({
          type: WEBHOOK_EVENT.releasePublished,
          resourceKind: 'release',
          resourceId: releaseId,
          summary: 'Site release published',
          data: {
            release_id: releaseId,
            reason,
            published_count: publishedCount,
            unpublished_count: unpublishedCount,
            deck_count: deckCount,
          },
        })
        try {
          // Activation and event enqueue commit atomically: a delivery can only
          // exist for a pointer switch that actually happened, and vice versa.
          await db.tx(async (tx) => {
            await tx.rpc('ck_activate_release', {
              p_release_id: releaseId,
              p_revision_ids: revisionIds,
              p_retire_item_ids: retireItemIds,
              p_expected_epoch: snapshot.site.publish_epoch ?? null,
            })
            await repo.enqueueContentEvents(tx, snapshot.site, events)
          })
        } catch (error) {
          // Another publish activated between our snapshot and this activation.
          const message = String(error.message || error)
          if (/stale snapshot/.test(message)) error.staleSnapshot = true
          if (/derived release deferred: exact preview review is active/.test(message)) error.previewProtected = true
          throw error
        }
      }

      // The release is live at this point; anything downstream (e.g. enqueuing
      // read-aloud audio jobs) is best-effort and must never fail the publish.
      if (kind === 'release' && revisionIds.length && hooks.onPublished) {
        Promise.resolve(hooks.onPublished({ siteId: snapshot.site.id, revisionIds })).catch((error) =>
          logger.warn?.('post-publish hook failed', {
            siteId: snapshot.site.id,
            error: String(error.message || error),
          }),
        )
      }

      if (kind === 'preview') {
        if (!config.previewSecret)
          throw Object.assign(new Error('CONTENTKIT_PREVIEW_SECRET is not configured'), { statusCode: 503 })
        const slug = normalizePreviewSlug(previewSlug)
        const token = randomBytes(32).toString('base64url')
        const effectiveExpiresIn = Math.max(60, Math.min(Number(expiresIn) || 3600, 7 * 86400))
        const expiresAt = new Date(Date.now() + effectiveExpiresIn * 1000).toISOString()
        try {
          // Registration and a derived release activation take the same site
          // lock. Whichever arrives second observes the first: a preview is
          // either current and protected, or retried from a fresh snapshot.
          await db.tx((tx) =>
            tx.rpc('ck_register_preview_access', {
              p_release_id: releaseId,
              p_slug: slug,
              p_invite_token_hash: sha256(`${config.previewSecret}:invite:${token}`),
              p_expires_at: expiresAt,
              p_expected_epoch: snapshot.site.publish_epoch ?? 0,
            }),
          )
        } catch (error) {
          if (/stale snapshot/.test(String(error.message || error))) error.staleSnapshot = true
          throw error
        }
        if (deckCount) {
          await db.insert(
            'ck_deck_build_events',
            {
              site_id: snapshot.site.id,
              mode: 'preview',
              result: 'success',
              cache_result: deckCacheResult,
              slide_count: deckSlides,
              svg_count: deckSvg,
              png_count: deckPng,
              output_bytes: entries
                .filter((entry) => entry.path.includes('/slides/'))
                .reduce((sum, entry) => sum + Number(entry.byte_size), 0),
              duration_ms: Date.now() - buildStarted,
            },
            { returning: false },
          )
        }
        const previewRoot = `/previews/${slug}/`
        const contentByRevisionId = new Map(built.content.map((item) => [item.id, item]))
        const reviewTargets = revisionIds.flatMap((revisionId) => {
          const item = contentByRevisionId.get(revisionId)
          if (!item?.url) return []
          const publishedPath = new URL(item.url, config.publicUrl).pathname
          const previewPath = `/previews/${slug}${publishedPath}`
          return [
            {
              revision_id: revisionId,
              title: item.title,
              preview_url: `${config.publicUrl}${previewPath}`,
            },
          ]
        })
        const invitationBase = `${config.publicUrl}/preview-invitations/${token}`
        const invitationUrl = reviewTargets[0]
          ? `${invitationBase}?return_to=${encodeURIComponent(new URL(reviewTargets[0].preview_url).pathname)}`
          : invitationBase
        return {
          release_id: releaseId,
          manifest_sha256: manifestSha256,
          base_publish_epoch: snapshot.site.publish_epoch ?? 0,
          revision_ids: revisionIds,
          retire_item_ids: retireItemIds,
          preview_url: `${config.publicUrl}${previewRoot}`,
          invitation_url: invitationUrl,
          review_targets: reviewTargets,
          expires_in: effectiveExpiresIn,
        }
      }
      if (deckCount) {
        await db.insert(
          'ck_deck_build_events',
          {
            site_id: snapshot.site.id,
            mode: 'release',
            result: 'success',
            cache_result: deckCacheResult,
            slide_count: deckSlides,
            svg_count: deckSvg,
            png_count: deckPng,
            output_bytes: entries
              .filter((entry) => entry.path.includes('/slides/'))
              .reduce((sum, entry) => sum + Number(entry.byte_size), 0),
            duration_ms: Date.now() - buildStarted,
          },
          { returning: false },
        )
      }
      return { release_id: releaseId, file_count: entries.length, manifest_sha256: manifestSha256, active: true }
    } catch (error) {
      // Best-effort remove any objects uploaded before the failure so they don't
      // leak (GC also enumerates via entries, but a crash before that insert has
      // no entries — this closes that gap). Strictly the uploaded paths: reused
      // entries point at the active release's objects, which the live site is
      // serving right now.
      if (storage.remove && uploadedPaths.length) {
        for (let i = 0; i < uploadedPaths.length; i += 100) {
          await storage.remove(uploadedPaths.slice(i, i + 100)).catch(() => {})
        }
      }
      if (error?.staleSnapshot || error?.previewProtected) {
        // Neither is a failed release: a concurrent publication won the epoch,
        // or a derived rebuild yielded to a live exact-review lock. Discard the
        // attempt quietly and do NOT emit release.failed.
        if (db.remove) await db.remove('ck_releases', { id: `eq.${releaseId}` }).catch(() => {})
        throw error
      }
      await db
        .update(
          'ck_releases',
          { id: `eq.${releaseId}` },
          {
            status: 'failed',
            error: String(error.message || error).slice(0, 1000),
          },
        )
        .catch(() => {})
      await repo
        .createOutbox(siteId, WEBHOOK_EVENT.releaseFailed, 'release', releaseId, 'Site release failed')
        .catch(() => {})
      if (deckCount) {
        await repo
          .createOutbox(siteId, WEBHOOK_EVENT.deckReleaseFailed, 'release', releaseId, 'Slide deck release failed')
          .catch(() => {})
        await db
          .insert(
            'ck_deck_build_events',
            {
              site_id: siteId,
              mode: kind === 'preview' ? 'preview' : 'release',
              result: error.code === 'TIMEOUT' ? 'timeout' : 'error',
              slide_count: deckSlides,
              svg_count: deckSvg,
              png_count: deckPng,
              duration_ms: Date.now() - buildStarted,
            },
            { returning: false },
          )
          .catch(() => {})
      }
      throw error
    } finally {
      release()
    }
  }

  // Retries once from a fresh snapshot if a concurrent publish invalidated the
  // captured epoch, so an optimistic-concurrency conflict self-heals.
  async function publish(input, attempt = 0) {
    try {
      return await build({ ...input, kind: 'release' })
    } catch (error) {
      if (error?.staleSnapshot && attempt < 1) {
        logger.warn?.('publish retrying after stale snapshot', { siteId: input.siteId })
        return publish(input, attempt + 1)
      }
      throw error
    }
  }

  async function preview(input, attempt = 0) {
    try {
      return await build({ ...input, previewSlug: normalizePreviewSlug(input.previewSlug), kind: 'preview' })
    } catch (error) {
      if (error?.staleSnapshot && attempt < 1) {
        logger.warn?.('preview retrying after stale snapshot', { siteId: input.siteId })
        return preview(input, attempt + 1)
      }
      throw error
    }
  }

  return {
    inflight: () => semaphore.active(),
    // Terminates any warm build worker. Idle workers are unref'd, so nothing
    // hangs without this — it exists so a draining server gives the memory back
    // immediately instead of waiting out the idle timer.
    stop: () => builder.close?.(),
    publish,
    preview,
    async promote({ siteId, releaseId, manifestSha256, onActivated }) {
      if (typeof manifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifestSha256)) {
        throw Object.assign(new Error('manifest_sha256 must be a lowercase SHA-256 digest'), { statusCode: 422 })
      }
      const target = await repo.getRelease(releaseId)
      if (!target || target.site_id !== siteId || target.kind !== 'preview' || target.status !== 'preview') {
        throw Object.assign(new Error('preview not found or not promotable'), { statusCode: 404 })
      }
      if (target.manifest_sha256 !== manifestSha256) {
        throw Object.assign(new Error('preview manifest mismatch'), { statusCode: 409 })
      }
      const revisionIds = target.revision_ids || []
      const retireItemIds = target.retire_item_ids || []
      const snapshot = await repo.buildSnapshot(siteId, revisionIds, retireItemIds)
      if (Number(snapshot.site.publish_epoch ?? 0) !== Number(target.base_publish_epoch ?? 0)) {
        throw Object.assign(new Error('stale preview: site changed since review'), { statusCode: 409 })
      }
      const retiring = new Set(retireItemIds)
      const promotesDeck =
        (snapshot.overlay || []).some((revision) => revision.kind === 'deck') ||
        (snapshot.items || []).some((item) => retiring.has(item.id) && item.kind === 'deck')
      if (promotesDeck) {
        throw Object.assign(new Error('preview promotion does not yet support deck pointer changes'), {
          statusCode: 422,
        })
      }
      const events = await contentTransitionEvents(db, snapshot, retireItemIds, releaseId)
      const deckCount = (snapshot.revisions || []).filter((revision) => revision.kind === 'deck').length
      events.push({
        type: WEBHOOK_EVENT.releasePublished,
        resourceKind: 'release',
        resourceId: releaseId,
        summary: 'Site release published',
        data: {
          release_id: releaseId,
          reason: target.reason,
          published_count: events.filter((event) => event.type === WEBHOOK_EVENT.contentPublished).length,
          unpublished_count: events.filter((event) => event.type === WEBHOOK_EVENT.contentUnpublished).length,
          deck_count: deckCount,
        },
      })
      await db.tx(async (tx) => {
        await tx.update('ck_releases', { id: `eq.${releaseId}` }, { kind: 'release', status: 'ready' })
        await tx.rpc('ck_activate_release', {
          p_release_id: releaseId,
          p_revision_ids: revisionIds,
          p_retire_item_ids: retireItemIds,
          p_expected_epoch: target.base_publish_epoch,
        })
        await tx.update(
          'ck_preview_access',
          { release_id: `eq.${releaseId}` },
          { revoked_at: new Date().toISOString() },
        )
        await repo.enqueueContentEvents(tx, snapshot.site, events)
        if (onActivated) await onActivated(tx)
      })
      if (revisionIds.length && hooks.onPublished) {
        Promise.resolve(hooks.onPublished({ siteId, revisionIds })).catch((error) =>
          logger.warn?.('post-promotion hook failed', { siteId, error: String(error.message || error) }),
        )
      }
      return { release_id: releaseId, file_count: target.file_count, manifest_sha256: manifestSha256, active: true }
    },
    async rollback(siteId, releaseId) {
      const target = await repo.getRelease(releaseId)
      if (!target || target.site_id !== siteId || !['ready', 'active', 'superseded'].includes(target.status)) {
        throw Object.assign(new Error('release not found or not activatable'), { statusCode: 404 })
      }
      // Rollback moves the site pointer, not item pointers — so it emits only
      // release.published, never content.* events.
      const site = (await repo.getSite(siteId)) || { id: siteId, name: null }
      await db.tx(async (tx) => {
        await tx.rpc('ck_activate_release', { p_release_id: releaseId, p_revision_ids: [] })
        await repo.enqueueContentEvents(tx, site, [
          {
            type: WEBHOOK_EVENT.releasePublished,
            resourceKind: 'release',
            resourceId: releaseId,
            summary: 'Site release published',
            data: { release_id: releaseId, reason: 'rollback', published_count: 0, unpublished_count: 0 },
          },
        ])
      })
      return { release_id: releaseId, active: true }
    },
  }
}
