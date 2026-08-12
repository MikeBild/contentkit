// Storage lifecycle: reap builds stuck in 'building' and garbage-collect
// release objects that are no longer referenced. Objects are enumerated from
// ck_release_entries (recorded per file) because storage.remove deletes exact
// keys, not prefixes. The active release and a rollback window are always kept.
//
// Ordering invariant: a release row is dropped only after every one of its
// objects is gone. Deleting the row cascades ck_release_entries away, so a row
// removed while a delete batch failed would strand its surviving objects with
// nothing left pointing at them. On a storage error the release is deferred to
// the next sweep instead — see `deferred` in the run() result.
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
  const PRODUCT_STATS_RETENTION_DAYS = config.productStatsRetentionDays ?? 400

  // Returns { removed, failed }. `failed` is what keeps a transient storage
  // error from turning into a permanent leak: ck_release_entries is the only
  // index of these objects, so the caller must not drop the release row while
  // any batch is still unaccounted for.
  async function removeReleaseObjects(releaseId) {
    if (!storage.remove) return { removed: 0, failed: false }
    const entries = await db.select('ck_release_entries', { release_id: `eq.${releaseId}` })
    const paths = entries.map((entry) => entry.storage_path).filter(Boolean)
    let removed = 0
    let failed = false
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100)
      try {
        await storage.remove(batch)
        removed += batch.length
      } catch (error) {
        failed = true
        logger.warn?.('storage gc delete failed', { releaseId, error: String(error.message || error) })
      }
    }
    return { removed, failed }
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
    // Keep releases still reachable through live named preview access.
    const tokens = await db.select('ck_preview_access', { revoked_at: 'is.null' })
    tokens.filter((token) => new Date(token.expires_at).getTime() > now).forEach((token) => keep.add(token.release_id))
    return keep
  }

  async function collectGarbage(now) {
    const keep = await computeKeepSet(now)
    const cutoff = now - RETENTION_MS
    const releases = await db.select('ck_releases', {})
    let removed = 0
    let objects = 0
    let deferred = 0
    for (const release of releases) {
      if (release.status === 'active' || keep.has(release.id)) continue
      if (new Date(release.created_at).getTime() >= cutoff) continue
      const { removed: objectCount, failed } = await removeReleaseObjects(release.id)
      objects += objectCount
      if (failed) {
        // Keep the row. Deleting it cascades ck_release_entries away, and with
        // it the only record of which objects belong to this release — the
        // survivors would then be invisible to every future sweep. The release
        // stays eligible, so the next run retries it.
        deferred++
        continue
      }
      await db.remove('ck_releases', { id: `eq.${release.id}` }).catch(() => {})
      removed++
    }
    return { removed, objects, deferred }
  }

  return {
    async run(now = Date.now()) {
      await db
        .remove('ck_reader_auth_events', {
          created_at: `lte.${new Date(now - PRODUCT_STATS_RETENTION_DAYS * 86400 * 1000).toISOString()}`,
        })
        .catch((error) => logger.warn?.('reader auth metric retention failed', { error: String(error) }))
      await db
        .remove('ck_deck_build_events', {
          created_at: `lte.${new Date(now - PRODUCT_STATS_RETENTION_DAYS * 86400 * 1000).toISOString()}`,
        })
        .catch((error) => logger.warn?.('deck metric retention failed', { error: String(error) }))
      const reaped = await reapStuckBuilds(now)
      const { removed, objects, deferred } = await collectGarbage(now)
      logger.info?.('storage gc complete', { reaped, removed, objects, deferred })
      return { reaped_builds: reaped, removed_releases: removed, removed_objects: objects, deferred_releases: deferred }
    },
  }
}
