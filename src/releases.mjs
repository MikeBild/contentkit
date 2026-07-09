import { randomBytes, randomUUID } from 'node:crypto'
import { buildSite } from './site-builder.mjs'
import { sha256 } from './utils.mjs'

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
      const built = await buildSite({ root: config.root, ...snapshot })
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
        try {
          await db.rpc('ck_activate_release', {
            p_release_id: releaseId,
            p_revision_ids: revisionIds,
            p_retire_item_ids: retireItemIds,
            p_expected_epoch: snapshot.site.publish_epoch ?? null,
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
        const token = randomBytes(32).toString('base64url')
        await db.insert('ck_preview_tokens', {
          release_id: releaseId,
          token_hash: sha256(`${config.previewSecret}:${token}`),
          expires_at: new Date(Date.now() + Math.min(expiresIn, 7 * 86400) * 1000).toISOString(),
        })
        return { release_id: releaseId, url: `${config.publicUrl}/p/${token}/`, expires_in: expiresIn }
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
    preview: (input) => build({ ...input, kind: 'preview' }),
    async rollback(siteId, releaseId) {
      const target = await repo.getRelease(releaseId)
      if (!target || target.site_id !== siteId || !['ready', 'active', 'superseded'].includes(target.status)) {
        throw Object.assign(new Error('release not found or not activatable'), { statusCode: 404 })
      }
      await db.rpc('ck_activate_release', { p_release_id: releaseId, p_revision_ids: [] })
      return { release_id: releaseId, active: true }
    },
  }
}
