import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReleaseManager, createSemaphore } from '../../src/releases.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const snapshotSite = {
  id: 'site-1',
  name: 'Example',
  description: '',
  base_url: 'https://example.test',
  default_locale: 'en',
  settings: {},
  publish_epoch: 3,
}

function makeSnapshot() {
  return { site: snapshotSite, locales: [{ locale: 'en' }], revisions: [], comments: [] }
}

function makeDb({ rpcError } = {}) {
  let rpcFailures = rpcError ? 1 : 0
  const calls = { inserts: [], updates: [], rpcs: [], removed: [] }
  return {
    calls,
    async insert(table, body) {
      calls.inserts.push({ table, body })
      return [body]
    },
    async update(table, filters, body) {
      calls.updates.push({ table, filters, body })
      return [body]
    },
    async rpc(name, params) {
      calls.rpcs.push({ name, params })
      if (rpcFailures > 0) {
        rpcFailures--
        throw new Error('activation failed: stale snapshot')
      }
      return []
    },
    async remove(table, filters) {
      calls.removed.push({ table, filters })
    },
  }
}

function makeStorage({ failOnUpload = 0 } = {}) {
  let uploads = 0
  const uploaded = []
  const removed = []
  return {
    uploaded,
    removed,
    async upload(path) {
      uploads++
      if (failOnUpload && uploads === failOnUpload) throw new Error('storage down')
      uploaded.push(path)
    },
    async remove(paths) {
      removed.push(...paths)
    },
  }
}

function makeRepo() {
  const outbox = []
  return {
    outbox,
    snapshots: 0,
    async buildSnapshot() {
      this.snapshots++
      return makeSnapshot()
    },
    async createOutbox(...args) {
      outbox.push(args)
    },
    async getRelease() {
      return null
    },
  }
}

const config = {
  root,
  buildConcurrency: 1,
  publicUrl: 'http://127.0.0.1:4050',
  previewSecret: 'preview-secret',
}
const logger = { warn() {}, error() {} }

test('semaphore hands its permit to the next waiter without over-admitting', async () => {
  const semaphore = createSemaphore(1)
  await semaphore.acquire()
  assert.equal(semaphore.active(), 1)
  let secondRan = false
  const second = semaphore.acquire().then(() => {
    secondRan = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(secondRan, false, 'second acquire must wait for release')
  semaphore.release()
  await second
  assert.equal(secondRan, true)
  assert.equal(semaphore.active(), 1, 'permit was handed over, not re-counted')
  semaphore.release()
  assert.equal(semaphore.active(), 0)
})

test('publish builds, uploads and activates with the snapshot epoch', async () => {
  const db = makeDb()
  const storage = makeStorage()
  const repo = makeRepo()
  const releases = createReleaseManager(config, repo, db, storage, logger)

  const result = await releases.publish({ siteId: 'site-1', revisionIds: [], reason: 'test' })
  assert.equal(result.active, true)
  assert.ok(result.file_count > 0)
  assert.ok(storage.uploaded.every((path) => path.startsWith(`sites/site-1/releases/${result.release_id}/`)))
  const activation = db.calls.rpcs.find((call) => call.name === 'ck_activate_release')
  assert.equal(activation.params.p_expected_epoch, 3)
  const ready = db.calls.updates.find((call) => call.table === 'ck_releases' && call.body.status === 'ready')
  assert.ok(ready, 'release row was not marked ready')
})

test('publish retries once from a fresh snapshot after a stale-snapshot activation', async () => {
  const db = makeDb({ rpcError: true })
  const repo = makeRepo()
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger)

  const result = await releases.publish({ siteId: 'site-1', revisionIds: [] })
  assert.equal(result.active, true)
  assert.equal(repo.snapshots, 2, 'a stale publish must re-snapshot')
  assert.equal(db.calls.removed.length, 1, 'the losing attempt must be discarded')
  assert.equal(repo.outbox.length, 0, 'a lost race is not a release failure')
})

test('a failed build marks the release failed, emits an event and cleans up uploads', async () => {
  const db = makeDb()
  const storage = makeStorage({ failOnUpload: 2 })
  const repo = makeRepo()
  const releases = createReleaseManager(config, repo, db, storage, logger)

  await assert.rejects(() => releases.publish({ siteId: 'site-1', revisionIds: [] }), /storage down/)
  const failed = db.calls.updates.find((call) => call.table === 'ck_releases' && call.body.status === 'failed')
  assert.match(failed.body.error, /storage down/)
  assert.equal(repo.outbox.length, 1)
  assert.equal(repo.outbox[0][1], 'contentkit.release.failed')
  assert.deepEqual(storage.removed, storage.uploaded, 'partial uploads must be removed')
})

test('preview returns a token URL and stores only the token hash', async () => {
  const db = makeDb()
  const releases = createReleaseManager(config, makeRepo(), db, makeStorage(), logger)

  const result = await releases.preview({ siteId: 'site-1', revisionIds: [], expiresIn: 60 })
  assert.match(result.url, new RegExp(`^${config.publicUrl}/p/[A-Za-z0-9_-]+/$`))
  const token = result.url.split('/p/')[1].replace(/\/$/, '')
  const stored = db.calls.inserts.find((call) => call.table === 'ck_preview_tokens')
  assert.match(stored.body.token_hash, /^[0-9a-f]{64}$/)
  assert.ok(!stored.body.token_hash.includes(token), 'raw token must never be stored')
  const noActivation = db.calls.rpcs.every((call) => call.name !== 'ck_activate_release')
  assert.ok(noActivation, 'previews must not activate a release')
})

test('preview fails with 503 when no preview secret is configured', async () => {
  const releases = createReleaseManager({ ...config, previewSecret: '' }, makeRepo(), makeDb(), makeStorage(), logger)
  await assert.rejects(
    () => releases.preview({ siteId: 'site-1', revisionIds: [] }),
    (error) => {
      assert.equal(error.statusCode, 503)
      return true
    },
  )
})

test('rollback rejects unknown or foreign releases and activates known ones', async () => {
  const db = makeDb()
  const repo = makeRepo()
  repo.getRelease = async (id) =>
    id === 'release-1' ? { id: 'release-1', site_id: 'site-1', status: 'superseded' } : null
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger)

  await assert.rejects(
    () => releases.rollback('site-1', 'missing'),
    (error) => {
      assert.equal(error.statusCode, 404)
      return true
    },
  )
  await assert.rejects(
    () => releases.rollback('other-site', 'release-1'),
    (error) => {
      assert.equal(error.statusCode, 404)
      return true
    },
  )
  const result = await releases.rollback('site-1', 'release-1')
  assert.deepEqual(result, { release_id: 'release-1', active: true })
  assert.equal(db.calls.rpcs.at(-1).name, 'ck_activate_release')
})
