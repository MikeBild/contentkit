// Storage lifecycle: reap builds stuck in 'building' and garbage-collect
// release objects that are no longer referenced. Objects are enumerated from
// ck_release_entries (recorded per file) because storage.remove deletes exact
// keys, not prefixes. The active release and a rollback window are always kept.
//
// Deliberately out of scope: ck_assets and their content-addressed storage
// objects (uploads and read-aloud MP3s) are never collected here, so an asset
// referenced by ck_audio_jobs.asset_id — live audio — cannot be swept. Audio
// bytes are reclaimed at their swap point and via DELETE /v1/content/{item}/audio
// (both in audio.mjs); uploaded assets are currently kept forever.
export function createMaintenance(config, db, storage, logger) {
  const KEEP = config.releaseHistoryKeep ?? 5
  const RETENTION_MS = config.releaseRetentionMs ?? 7 * 86400 * 1000
  const BUILDING_REAP_MS = config.buildingReapMs ?? 3600 * 1000

  async function removeReleaseObjects(releaseId) {
    if (!storage.remove) return 0
    const entries = await db.select('ck_release_entries', { release_id: `eq.${releaseId}` })
    const paths = entries.map((entry) => entry.storage_path).filter(Boolean)
    for (let i = 0; i < paths.length; i += 100) {
      await storage.remove(paths.slice(i, i + 100)).catch((error) => {
        logger.warn?.('storage gc delete failed', { releaseId, error: String(error.message || error) })
      })
    }
    return paths.length
  }

  async function reapStuckBuilds(now) {
    const cutoff = now - BUILDING_REAP_MS
    const building = await db.select('ck_releases', { status: 'eq.building' })
    let reaped = 0
    for (const release of building) {
      // created_at comes back from pg as a Date; compare on epoch ms (a Date vs
      // ISO-string comparison silently coerces to NaN and is always false).
      if (new Date(release.created_at).getTime() >= cutoff) continue
      await removeReleaseObjects(release.id)
      await db
        .update(
          'ck_releases',
          { id: `eq.${release.id}` },
          { status: 'failed', error: 'reaped: stuck in building' },
          { returning: false },
        )
        .catch(() => {})
      reaped++
    }
    return reaped
  }

  async function computeKeepSet(now) {
    const keep = new Set()
    const sites = await db.select('ck_sites', {})
    for (const site of sites) {
      if (site.active_release_id) keep.add(site.active_release_id)
      // Keep the most recent releases per site as a rollback window.
      const recent = await db.select('ck_releases', {
        site_id: `eq.${site.id}`,
        kind: 'eq.release',
        order: 'created_at.desc',
      })
      recent.slice(0, KEEP).forEach((release) => keep.add(release.id))
    }
    // Keep releases still reachable through a live (non-expired, non-revoked) preview token.
    const tokens = await db.select('ck_preview_tokens', { revoked_at: 'is.null' })
    tokens.filter((token) => new Date(token.expires_at).getTime() > now).forEach((token) => keep.add(token.release_id))
    return keep
  }

  async function collectGarbage(now) {
    const keep = await computeKeepSet(now)
    const cutoff = now - RETENTION_MS
    const releases = await db.select('ck_releases', {})
    let removed = 0
    let objects = 0
    for (const release of releases) {
      if (release.status === 'active' || keep.has(release.id)) continue
      if (new Date(release.created_at).getTime() >= cutoff) continue
      objects += await removeReleaseObjects(release.id)
      await db.remove('ck_releases', { id: `eq.${release.id}` }).catch(() => {})
      removed++
    }
    return { removed, objects }
  }

  return {
    async run(now = Date.now()) {
      const reaped = await reapStuckBuilds(now)
      const { removed, objects } = await collectGarbage(now)
      logger.info?.('storage gc complete', { reaped, removed, objects })
      return { reaped_builds: reaped, removed_releases: removed, removed_objects: objects }
    },
  }
}
