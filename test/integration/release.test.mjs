import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReleaseManager } from '../../src/releases.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const snapshot = {
  site: {
    id: 'site', name: 'Example', description: 'Site',
    base_url: 'https://example.com', default_locale: 'de', settings: {},
  },
  locales: [{ locale: 'de' }],
  revisions: [{
    id: 'revision', item_id: 'item', kind: 'post', locale: 'de', translation_key: 'post',
    markdown: '---\nkind: post\ntitle: Post\nlocale: de\nslug: post\ntranslationKey: post\n---\n# Post',
  }],
  comments: [],
}

function harness({ failUpload = false } = {}) {
  const calls = []
  let uploads = 0
  const db = {
    async insert(table, body) { calls.push(['insert', table, body]); return Array.isArray(body) ? body : [body] },
    async update(table, filters, body) { calls.push(['update', table, body]); return [body] },
    async rpc(name, body) { calls.push(['rpc', name, body]) },
  }
  const repo = {
    async buildSnapshot() { return snapshot },
    async createOutbox(...args) { calls.push(['outbox', ...args]) },
  }
  const storage = {
    async upload() {
      uploads++
      if (failUpload && uploads === 2) throw new Error('storage unavailable')
    },
  }
  const manager = createReleaseManager({
    root, publicUrl: 'https://contentkit.example', previewSecret: 'secret', buildConcurrency: 1,
  }, repo, db, storage, { debug() {} })
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

test('does not activate a partially uploaded release', async () => {
  const { manager, calls } = harness({ failUpload: true })
  await assert.rejects(() => manager.publish({ siteId: 'site', revisionIds: ['revision'] }), /storage unavailable/)
  assert.equal(calls.some((call) => call[0] === 'rpc' && call[1] === 'ck_activate_release'), false)
  assert.ok(calls.some((call) => call[0] === 'outbox' && call[2] === 'contentkit.release.failed'))
})
