import { randomBytes, randomUUID } from 'node:crypto'
import { buildSite } from './site-builder.mjs'
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
      type: 'contentkit.content.published',
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
        type: 'contentkit.content.unpublished',
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

export function createReleaseManager(config, repo, db, storage, logger, hooks = {}) {
  const semaphore = createSemaphore(config.buildConcurrency)
  const acquire = () => semaphore.acquire()
  const release = () => semaphore.release()

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
    const releaseId = randomUUID()
    let prefix
    const entries = []
    try {
      const snapshot = await repo.buildSnapshot(siteId, revisionIds, retireItemIds)
      await db.insert('ck_releases', {
        id: releaseId,
        site_id: snapshot.site.id,
        kind,
        status: 'building',
        reason,
        revision_ids: revisionIds,
      })
      const built = await buildSite({ root: config.root, logger, ...snapshot })
      prefix = `sites/${snapshot.site.id}/releases/${releaseId}`
      for (const [path, file] of built.files) {
        await storage.upload(`${prefix}/${path}`, file.body, file.contentType, file.cacheControl, false)
        entries.push({
          release_id: releaseId,
          path,
          storage_path: `${prefix}/${path}`,
          content_type: file.contentType,
          byte_size: file.body.length,
          sha256: sha256(file.body),
        })
      }
      await db.insert('ck_release_entries', entries, { returning: false })
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
          completed_at: new Date().toISOString(),
        },
      )
      if (kind === 'release') {
        const events = await contentTransitionEvents(db, snapshot, retireItemIds, releaseId)
        const publishedCount = events.filter((event) => event.type === 'contentkit.content.published').length
        events.push({
          type: 'contentkit.release.published',
          resourceKind: 'release',
          resourceId: releaseId,
          summary: 'Site release published',
          data: {
            release_id: releaseId,
            reason,
            published_count: publishedCount,
            unpublished_count: events.length - publishedCount,
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
          if (/stale snapshot/.test(String(error.message || error))) error.stalePublish = true
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
        await db.insert(
          'ck_preview_access',
          {
            release_id: releaseId,
            slug,
            invite_token_hash: sha256(`${config.previewSecret}:invite:${token}`),
            expires_at: new Date(Date.now() + effectiveExpiresIn * 1000).toISOString(),
            consumed_at: null,
            session_token_hash: null,
            revoked_at: null,
          },
          { upsert: true, onConflict: 'slug' },
        )
        return {
          release_id: releaseId,
          preview_url: `${config.publicUrl}/previews/${slug}/`,
          invitation_url: `${config.publicUrl}/preview-invitations/${token}`,
          expires_in: effectiveExpiresIn,
        }
      }
      return { release_id: releaseId, file_count: entries.length, active: true }
    } catch (error) {
      // Best-effort remove any objects uploaded before the failure so they don't
      // leak (GC also enumerates via entries, but a crash before that insert has
      // no entries — this closes that gap).
      if (storage.remove && entries.length) {
        const paths = entries.map((entry) => entry.storage_path)
        for (let i = 0; i < paths.length; i += 100) await storage.remove(paths.slice(i, i + 100)).catch(() => {})
      }
      if (error?.stalePublish) {
        // Not a real failure — a concurrent publish won the race. Discard this
        // attempt quietly (publish() retries) and do NOT emit release.failed.
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
        .createOutbox(siteId, 'contentkit.release.failed', 'release', releaseId, 'Site release failed')
        .catch(() => {})
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
      if (error?.stalePublish && attempt < 1) {
        logger.warn?.('publish retrying after stale snapshot', { siteId: input.siteId })
        return publish(input, attempt + 1)
      }
      throw error
    }
  }

  return {
    inflight: () => semaphore.active(),
    publish,
    preview: async (input) =>
      build({ ...input, previewSlug: normalizePreviewSlug(input.previewSlug), kind: 'preview' }),
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
            type: 'contentkit.release.published',
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
