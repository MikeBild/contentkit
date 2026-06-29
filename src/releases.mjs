import { randomBytes, randomUUID } from 'node:crypto'
import { buildSite } from './site-builder.mjs'
import { sha256 } from './utils.mjs'

export function createReleaseManager(config, repo, db, storage, logger) {
  let active = 0
  const waiters = []
  async function acquire() {
    if (active < config.buildConcurrency) { active++; return }
    await new Promise((resolve) => waiters.push(resolve))
    active++
  }
  function release() {
    active--
    waiters.shift()?.()
  }

  async function build({ siteId, revisionIds = [], kind = 'release', expiresIn = 3600, reason = '' }) {
    await acquire()
    const releaseId = randomUUID()
    try {
      const snapshot = await repo.buildSnapshot(siteId, revisionIds)
      await db.insert('ck_releases', {
        id: releaseId, site_id: snapshot.site.id, kind, status: 'building',
        reason, revision_ids: revisionIds,
      })
      const built = await buildSite({ root: config.root, ...snapshot })
      const prefix = `sites/${snapshot.site.id}/releases/${releaseId}`
      const entries = []
      for (const [path, file] of built.files) {
        await storage.upload(`${prefix}/${path}`, file.body, file.contentType, file.cacheControl, false)
        entries.push({
          release_id: releaseId, path, storage_path: `${prefix}/${path}`,
          content_type: file.contentType, byte_size: file.body.length, sha256: sha256(file.body),
        })
      }
      await db.insert('ck_release_entries', entries, { returning: false })
      await db.update('ck_releases', { id: `eq.${releaseId}` }, {
        status: kind === 'preview' ? 'preview' : 'ready',
        storage_prefix: prefix, file_count: entries.length, completed_at: new Date().toISOString(),
      })
      if (kind === 'release') await db.rpc('ck_activate_release', { p_release_id: releaseId, p_revision_ids: revisionIds })

      if (kind === 'preview') {
        if (!config.previewSecret) throw Object.assign(new Error('CONTENTKIT_PREVIEW_SECRET is not configured'), { statusCode: 503 })
        const token = randomBytes(32).toString('base64url')
        await db.insert('ck_preview_tokens', {
          release_id: releaseId, token_hash: sha256(`${config.previewSecret}:${token}`),
          expires_at: new Date(Date.now() + Math.min(expiresIn, 7 * 86400) * 1000).toISOString(),
        })
        return { release_id: releaseId, url: `${config.publicUrl}/p/${token}/`, expires_in: expiresIn }
      }
      return { release_id: releaseId, file_count: entries.length, active: true }
    } catch (error) {
      await db.update('ck_releases', { id: `eq.${releaseId}` }, {
        status: 'failed', error: String(error.message || error).slice(0, 1000),
      }).catch(() => {})
      await repo.createOutbox(siteId, 'contentkit.release.failed', 'release', releaseId, 'Site release failed').catch(() => {})
      throw error
    } finally {
      release()
    }
  }

  return {
    inflight: () => active,
    publish: (input) => build({ ...input, kind: 'release' }),
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
