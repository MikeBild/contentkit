import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReleaseManager, createSemaphore } from '../../src/releases.mjs'

test('createSemaphore hands the permit to a waiter without over-admitting', async () => {
  const s = createSemaphore(1)
  await s.acquire()
  assert.equal(s.active(), 1)
  let second = false
  s.acquire().then(() => {
    second = true
  })
  assert.equal(s.active(), 1)
  s.release() // hand the permit straight to the waiter
  assert.equal(s.active(), 1, 'permit handed over — active not dropped below in-flight (the over-admission bug)')
  let third = false
  s.acquire().then(() => {
    third = true
  })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(second, true, 'the waiter received the permit')
  assert.equal(third, false, 'a fresh acquire in the wake-up gap does not over-admit')
})

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const snapshot = {
  site: {
    id: 'site',
    name: 'Example',
    description: 'Site',
    base_url: 'https://example.com',
    default_locale: 'de',
    settings: {},
  },
  locales: [{ locale: 'de' }],
  revisions: [
    {
      id: 'revision',
      item_id: 'item',
      kind: 'post',
      locale: 'de',
      translation_key: 'post',
      markdown: '---\nkind: post\ntitle: Post\nlocale: de\nslug: post\ntranslationKey: post\n---\n# Post',
    },
  ],
  comments: [],
}

function harness({ failUpload = false, staleUntil = 0 } = {}) {
  const calls = []
  let uploads = 0
  let rpcCount = 0
  const db = {
    async insert(table, body) {
      calls.push(['insert', table, body])
      return Array.isArray(body) ? body : [body]
    },
    async update(table, filters, body) {
      calls.push(['update', table, body])
      return [body]
    },
    async rpc(name, body) {
      calls.push(['rpc', name, body])
      if (++rpcCount <= staleUntil) throw new Error('stale snapshot: site changed since build (epoch 9 <> 8)')
    },
  }
  const repo = {
    async buildSnapshot(...args) {
      calls.push(['snapshot', ...args])
      return snapshot
    },
    async createOutbox(...args) {
      calls.push(['outbox', ...args])
    },
  }
  const storage = {
    async upload() {
      uploads++
      if (failUpload && uploads === 2) throw new Error('storage unavailable')
    },
    async remove(paths) {
      calls.push(['remove', paths])
    },
  }
  const manager = createReleaseManager(
    {
      root,
      publicUrl: 'https://contentkit.example',
      previewSecret: 'secret',
      buildConcurrency: 1,
    },
    repo,
    db,
    storage,
    { debug() {} },
  )
  return { manager, calls }
}

test('activates only after every release object and manifest row is stored', async () => {
  const { manager, calls } = harness()
  const result = await manager.publish({ siteId: 'site', revisionIds: ['revision'] })
  assert.equal(result.active, true)
  const entries = calls.findIndex((call) => call[0] === 'insert' && call[1] === 'ck_release_entries')
  const activate = calls.findIndex((call) => call[0] === 'rpc' && call[1] === 'ck_activate_release')
  assert.ok(entries >= 0)
  assert.ok(activate > entries)
})

test('does not activate a partially uploaded release and removes its partial objects', async () => {
  const { manager, calls } = harness({ failUpload: true })
  await assert.rejects(() => manager.publish({ siteId: 'site', revisionIds: ['revision'] }), /storage unavailable/)
  assert.equal(
    calls.some((call) => call[0] === 'rpc' && call[1] === 'ck_activate_release'),
    false,
  )
  assert.ok(calls.some((call) => call[0] === 'outbox' && call[2] === 'contentkit.release.failed'))
  // The objects uploaded before the failure are cleaned up (no leak).
  const remove = calls.find((call) => call[0] === 'remove')
  assert.ok(remove && remove[1].length >= 1, 'partial uploads removed on failure')
})

test('forwards retired items to the snapshot build and the activation function', async () => {
  const { manager, calls } = harness()
  const result = await manager.publish({ siteId: 'site', retireItemIds: ['item'] })
  assert.equal(result.active, true)
  const snapshotCall = calls.find((call) => call[0] === 'snapshot')
  assert.deepEqual(snapshotCall.slice(1), ['site', [], ['item']])
  const activate = calls.find((call) => call[0] === 'rpc' && call[1] === 'ck_activate_release')
  assert.deepEqual(activate[2].p_revision_ids, [])
  assert.deepEqual(activate[2].p_retire_item_ids, ['item'])
})

test('forwards the captured publish_epoch for optimistic concurrency', async () => {
  const { manager, calls } = harness()
  await manager.publish({ siteId: 'site', revisionIds: ['revision'] })
  const activate = calls.find((call) => call[0] === 'rpc' && call[1] === 'ck_activate_release')
  assert.ok('p_expected_epoch' in activate[2])
})

test('retries a publish once from a fresh snapshot on a stale-epoch conflict', async () => {
  const { manager, calls } = harness({ staleUntil: 1 })
  const result = await manager.publish({ siteId: 'site', revisionIds: ['revision'] })
  assert.equal(result.active, true)
  assert.equal(calls.filter((c) => c[0] === 'snapshot').length, 2, 'rebuilt from a fresh snapshot')
  assert.equal(calls.filter((c) => c[0] === 'rpc').length, 2)
  // A self-healing conflict must not emit a spurious release.failed notification.
  assert.equal(
    calls.some((c) => c[0] === 'outbox' && c[2] === 'contentkit.release.failed'),
    false,
  )
})

test('gives up after a single stale retry', async () => {
  const { manager, calls } = harness({ staleUntil: 5 })
  await assert.rejects(() => manager.publish({ siteId: 'site', revisionIds: ['revision'] }), /stale snapshot/)
  assert.equal(calls.filter((c) => c[0] === 'snapshot').length, 2, 'one retry only')
})

test('serializes builds at buildConcurrency 1', async () => {
  const gate = []
  let inFlight = 0
  let peak = 0
  const db = {
    async insert(table, body) {
      return Array.isArray(body) ? body : [body]
    },
    async update() {
      return [{}]
    },
    async rpc() {},
  }
  const repo = {
    async buildSnapshot() {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => gate.push(resolve))
      inFlight--
      return snapshot
    },
    async createOutbox() {},
  }
  const manager = createReleaseManager(
    { root, publicUrl: 'x', buildConcurrency: 1 },
    repo,
    db,
    { async upload() {} },
    { debug() {}, warn() {} },
  )
  const p1 = manager.publish({ siteId: 's', revisionIds: ['revision'] })
  const p2 = manager.publish({ siteId: 's', revisionIds: ['revision'] })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(peak, 1, 'only one build enters the snapshot stage at a time')
  gate.shift()?.()
  await new Promise((resolve) => setTimeout(resolve, 20))
  gate.shift()?.()
  await Promise.all([p1, p2])
  assert.equal(peak, 1)
})
