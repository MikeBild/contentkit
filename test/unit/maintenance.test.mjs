import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaintenance } from '../../src/maintenance.mjs'

function fixture() {
  const now = Date.parse('2026-07-01T00:00:00Z')
  // pg returns timestamptz as Date objects — use Dates here so the fixture
  // catches the Date-vs-ISO-string comparison bug (ISO strings would compare fine).
  const old = new Date(now - 30 * 86400 * 1000)
  const recent = new Date(now - 1 * 86400 * 1000)
  const sites = [{ id: 's1', active_release_id: 'r-active' }]
  const releases = [
    { id: 'r-active', site_id: 's1', kind: 'release', status: 'active', created_at: old },
    { id: 'r-keepwindow', site_id: 's1', kind: 'release', status: 'superseded', created_at: recent },
    { id: 'r-old', site_id: 's1', kind: 'release', status: 'superseded', created_at: old },
    { id: 'r-preview-live', site_id: 's1', kind: 'preview', status: 'preview', created_at: old },
    { id: 'r-building-stuck', site_id: 's1', kind: 'release', status: 'building', created_at: old },
  ]
  const entriesByRelease = {
    'r-old': [
      { storage_path: 'sites/s1/releases/r-old/index.html' },
      { storage_path: 'sites/s1/releases/r-old/a.css' },
    ],
    'r-building-stuck': [{ storage_path: 'sites/s1/releases/r-building-stuck/partial.html' }],
    'r-preview-live': [{ storage_path: 'sites/s1/releases/r-preview-live/index.html' }],
  }
  const tokens = [{ release_id: 'r-preview-live', revoked_at: null, expires_at: new Date(now + 86400000) }]
  const removedObjects = []
  const removedReleases = []
  const removedAuthEvents = []
  const updated = []
  const db = {
    async select(table, q = {}) {
      if (table === 'ck_sites') return sites
      if (table === 'ck_preview_tokens') return tokens
      if (table === 'ck_release_entries') return entriesByRelease[q.release_id.slice(3)] || []
      if (table === 'ck_releases') {
        if (q.status === 'eq.building') return releases.filter((r) => r.status === 'building')
        if (q.site_id)
          return releases
            .filter((r) => r.site_id === q.site_id.slice(3) && (!q.kind || r.kind === q.kind.slice(3)))
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        return releases
      }
      return []
    },
    async remove(table, f) {
      if (table === 'ck_releases') removedReleases.push(f.id.slice(3))
      if (table === 'ck_reader_auth_events') removedAuthEvents.push(f.created_at.slice(4))
    },
    async update(table, f, body) {
      updated.push({ id: f.id.slice(3), body })
      return [body]
    },
  }
  const storage = {
    async remove(paths) {
      removedObjects.push(...paths)
    },
  }
  return { db, storage, now, removedObjects, removedReleases, removedAuthEvents, updated }
}

test('storage GC keeps active + rollback-window + live-preview releases, removes old ones with their objects', async () => {
  const f = fixture()
  const maint = createMaintenance(
    { releaseHistoryKeep: 1, releaseRetentionMs: 7 * 86400 * 1000, buildingReapMs: 3600 * 1000 },
    f.db,
    f.storage,
    { info() {}, warn() {} },
  )
  const result = await maint.run(f.now)

  assert.equal(result.reaped_builds, 1, 'stuck building release reaped')
  assert.ok(f.updated.find((u) => u.id === 'r-building-stuck' && u.body.status === 'failed'))

  assert.ok(f.removedReleases.includes('r-old'), 'old superseded release removed')
  assert.ok(f.removedObjects.includes('sites/s1/releases/r-old/index.html'), 'its objects deleted')

  for (const kept of ['r-active', 'r-keepwindow', 'r-preview-live']) {
    assert.ok(!f.removedReleases.includes(kept), `${kept} must be kept`)
  }
  // The live preview's objects must never be swept while its token is valid.
  assert.ok(!f.removedObjects.some((p) => p.includes('r-preview-live')), 'live preview objects kept')
  assert.deepEqual(f.removedAuthEvents, ['2025-05-27T00:00:00.000Z'], 'reader auth facts use 400-day retention')
})

test('storage GC keeps a recently-superseded release even beyond the keep count when within retention', async () => {
  const f = fixture()
  const maint = createMaintenance(
    { releaseHistoryKeep: 0, releaseRetentionMs: 7 * 86400 * 1000, buildingReapMs: 3600 * 1000 },
    f.db,
    f.storage,
    { info() {}, warn() {} },
  )
  await maint.run(f.now)
  // r-keepwindow is 1 day old, inside the 7-day retention window → not eligible even with keep=0.
  assert.ok(!f.removedReleases.includes('r-keepwindow'))
})
