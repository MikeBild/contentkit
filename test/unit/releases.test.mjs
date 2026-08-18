import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReleaseManager, createSemaphore, releaseManifestSha256 } from '../../src/releases.mjs'
import { sha256 } from '../../src/utils.mjs'

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

function makeSnapshot(overrides = {}) {
  return {
    site: snapshotSite,
    locales: [{ locale: 'en' }],
    revisions: [],
    comments: [],
    items: [],
    overlay: [],
    ...overrides,
  }
}

function makeDb({ rpcError, rpcErrorMessage = 'activation failed: stale snapshot', selectRows = {} } = {}) {
  let rpcFailures = rpcError ? 1 : 0
  const calls = { inserts: [], updates: [], rpcs: [], removed: [], selects: [] }
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
    async select(table, query) {
      calls.selects.push({ table, query })
      return selectRows[table] || []
    },
    async rpc(name, params) {
      calls.rpcs.push({ name, params })
      if (rpcFailures > 0) {
        rpcFailures--
        throw new Error(rpcErrorMessage)
      }
      return []
    },
    async remove(table, filters) {
      calls.removed.push({ table, filters })
    },
    async tx(fn) {
      return fn(this)
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

function makeRepo(snapshot) {
  const outbox = []
  const enqueued = []
  return {
    outbox,
    enqueued,
    snapshots: 0,
    async buildSnapshot() {
      this.snapshots++
      return snapshot || makeSnapshot()
    },
    async createOutbox(...args) {
      outbox.push(args)
    },
    async enqueueContentEvents(exec, site, events) {
      enqueued.push({ exec, site, events })
      return events.map((event) => event.type)
    },
    async getSite() {
      return snapshotSite
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
  // Concurrent uploads make the completion order nondeterministic — compare as sets.
  assert.deepEqual([...storage.removed].sort(), [...storage.uploaded].sort(), 'partial uploads must be removed')
})

test('preview returns a named URL plus an expiring invitation and stores only hashes', async () => {
  const db = makeDb()
  const releases = createReleaseManager(config, makeRepo(), db, makeStorage(), logger)

  const result = await releases.preview({
    siteId: 'site-1',
    revisionIds: [],
    expiresIn: 60,
    previewSlug: 'release-review',
  })
  assert.equal(result.preview_url, `${config.publicUrl}/previews/release-review/`)
  assert.match(result.manifest_sha256, /^[0-9a-f]{64}$/)
  assert.equal(result.base_publish_epoch, 3)
  assert.deepEqual(result.revision_ids, [])
  assert.deepEqual(result.retire_item_ids, [])
  assert.match(result.invitation_url, new RegExp(`^${config.publicUrl}/preview-invitations/[A-Za-z0-9_-]+$`))
  const token = new URL(result.invitation_url).pathname.split('/').at(-1)
  const registration = db.calls.rpcs.find((call) => call.name === 'ck_register_preview_access')
  assert.equal(registration.params.p_slug, 'release-review')
  assert.equal(registration.params.p_expected_epoch, 3)
  assert.match(registration.params.p_invite_token_hash, /^[0-9a-f]{64}$/)
  assert.ok(!registration.params.p_invite_token_hash.includes(token), 'raw invitation token must never be stored')
  const noActivation = db.calls.rpcs.every((call) => call.name !== 'ck_activate_release')
  assert.ok(noActivation, 'previews must not activate a release')
})

test('preview retries registration from a fresh snapshot after a concurrent activation', async () => {
  const db = makeDb({ rpcError: true })
  const repo = makeRepo()
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger)

  const result = await releases.preview({ siteId: 'site-1', revisionIds: [], previewSlug: 'retry-review' })
  assert.equal(result.base_publish_epoch, 3)
  assert.equal(repo.snapshots, 2, 'a stale preview must be rebuilt from a fresh snapshot')
  assert.equal(db.calls.removed.length, 1, 'the stale preview release must be discarded')
  assert.equal(repo.outbox.length, 0, 'a registration race is not a release failure')
})

test('derived release protection is deferred without a failure event', async () => {
  const db = makeDb({
    rpcError: true,
    rpcErrorMessage: 'derived release deferred: exact preview review is active',
  })
  const repo = makeRepo()
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger)

  await assert.rejects(
    () => releases.publish({ siteId: 'site-1', revisionIds: [], reason: 'audio auto-rebuild' }),
    (error) => error.previewProtected === true,
  )
  assert.equal(db.calls.removed.length, 1)
  assert.equal(repo.outbox.length, 0)
})

test('generated batch invitation enters the first changed article and exposes every review target', async () => {
  const revisionIds = ['rev-1', 'rev-2']
  const snapshot = makeSnapshot({
    revisions: revisionIds.map((id) => ({ id })),
    overlay: revisionIds.map((id) => ({ id })),
  })
  const builder = makeBuilder(
    [],
    [
      { id: 'rev-2', title: 'Zweiter Artikel', url: '/de/blog/zweiter-artikel/' },
      { id: 'rev-1', title: 'Erster Artikel', url: '/de/blog/erster-artikel/' },
    ],
  )
  const releases = createReleaseManager(config, makeRepo(snapshot), makeDb(), makeStorage(), logger, {
    buildRunner: builder,
  })

  const result = await releases.preview({ siteId: 'site-1', revisionIds, previewSlug: 'batch-review' })
  assert.equal(
    new URL(result.invitation_url).searchParams.get('return_to'),
    '/previews/batch-review/de/blog/erster-artikel/',
  )
  assert.deepEqual(
    result.review_targets.map((target) => [target.revision_id, target.preview_url]),
    [
      ['rev-1', `${config.publicUrl}/previews/batch-review/de/blog/erster-artikel/`],
      ['rev-2', `${config.publicUrl}/previews/batch-review/de/blog/zweiter-artikel/`],
    ],
    'targets preserve the requested revision order, not the site render order',
  )
})

test('release manifest digest is canonical and changes with rendered bytes', () => {
  const a = { path: 'a.html', content_type: 'text/html', byte_size: 1, sha256: sha256('a'), cache_control: null }
  const b = { path: 'b.json', content_type: 'application/json', byte_size: 1, sha256: sha256('b'), cache_control: 'x' }
  const input = {
    siteId: 'site-1',
    basePublishEpoch: 3,
    revisionIds: ['rev-b', 'rev-a'],
    retireItemIds: ['item-b', 'item-a'],
    entries: [b, a],
  }
  const first = releaseManifestSha256(input)
  const reordered = releaseManifestSha256({
    ...input,
    revisionIds: [...input.revisionIds].reverse(),
    retireItemIds: [...input.retireItemIds].reverse(),
    entries: [{ ...a, storage_path: 'different-owner' }, b],
  })
  assert.equal(first, reordered)
  assert.notEqual(first, releaseManifestSha256({ ...input, entries: [{ ...a, sha256: sha256('changed') }, b] }))
})

function promotableRepo(overrides = {}) {
  const repo = makeRepo()
  repo.getRelease = async () => ({
    id: 'preview-1',
    site_id: 'site-1',
    kind: 'preview',
    status: 'preview',
    reason: 'reviewed article',
    revision_ids: [],
    retire_item_ids: [],
    base_publish_epoch: 3,
    manifest_sha256: 'a'.repeat(64),
    file_count: 7,
    ...overrides,
  })
  return repo
}

test('promotion activates the exact preview digest without rebuilding or uploading', async () => {
  const db = makeDb()
  const storage = makeStorage()
  const repo = promotableRepo()
  const releases = createReleaseManager(config, repo, db, storage, logger)
  const result = await releases.promote({
    siteId: 'site-1',
    releaseId: 'preview-1',
    manifestSha256: 'a'.repeat(64),
  })
  assert.deepEqual(result, {
    release_id: 'preview-1',
    file_count: 7,
    manifest_sha256: 'a'.repeat(64),
    active: true,
  })
  assert.deepEqual(storage.uploaded, [], 'promotion reuses the already-rendered preview bytes')
  const activation = db.calls.rpcs.find((call) => call.name === 'ck_activate_release')
  assert.equal(activation.params.p_release_id, 'preview-1')
  assert.equal(activation.params.p_expected_epoch, 3)
  assert.ok(
    db.calls.updates.some(
      (call) => call.table === 'ck_releases' && call.body.kind === 'release' && call.body.status === 'ready',
    ),
  )
  assert.ok(db.calls.updates.some((call) => call.table === 'ck_preview_access' && call.body.revoked_at))
  assert.equal(repo.enqueued.length, 1)
})

test('promotion fails closed on manifest or publish-epoch drift', async () => {
  const mismatchDb = makeDb()
  const mismatch = createReleaseManager(config, promotableRepo(), mismatchDb, makeStorage(), logger)
  await assert.rejects(
    () => mismatch.promote({ siteId: 'site-1', releaseId: 'preview-1', manifestSha256: 'b'.repeat(64) }),
    (error) => error.statusCode === 409 && /manifest mismatch/.test(error.message),
  )
  assert.equal(mismatchDb.calls.rpcs.length, 0)

  const staleDb = makeDb()
  const stale = createReleaseManager(config, promotableRepo({ base_publish_epoch: 2 }), staleDb, makeStorage(), logger)
  await assert.rejects(
    () => stale.promote({ siteId: 'site-1', releaseId: 'preview-1', manifestSha256: 'a'.repeat(64) }),
    (error) => error.statusCode === 409 && /stale preview/.test(error.message),
  )
  assert.equal(staleDb.calls.rpcs.length, 0)
})

test('promotion refuses deck pointer changes until their event metadata can be preserved', async () => {
  const db = makeDb()
  const repo = promotableRepo()
  repo.buildSnapshot = async () => makeSnapshot({ overlay: [{ id: 'deck-rev', item_id: 'deck', kind: 'deck' }] })
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger)
  await assert.rejects(
    () => releases.promote({ siteId: 'site-1', releaseId: 'preview-1', manifestSha256: 'a'.repeat(64) }),
    (error) => error.statusCode === 422 && /deck pointer/.test(error.message),
  )
  assert.equal(db.calls.rpcs.length, 0)
})

test('preview fails with 503 when no preview secret is configured', async () => {
  const releases = createReleaseManager({ ...config, previewSecret: '' }, makeRepo(), makeDb(), makeStorage(), logger)
  await assert.rejects(
    () => releases.preview({ siteId: 'site-1', revisionIds: [], previewSlug: 'release-review' }),
    (error) => {
      assert.equal(error.statusCode, 503)
      return true
    },
  )
})

test('preview rejects missing or non-human-readable slugs before building', async () => {
  const db = makeDb()
  const releases = createReleaseManager(config, makeRepo(), db, makeStorage(), logger)
  await assert.rejects(
    () => releases.preview({ siteId: 'site-1', previewSlug: 'Not memorable!' }),
    (error) => error.statusCode === 422,
  )
  assert.equal(db.calls.inserts.length, 0)
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

test('activation enqueues content.published for changed pointers plus one release.published', async () => {
  const db = makeDb()
  const repo = makeRepo(
    makeSnapshot({
      items: [
        { id: 'item-1', kind: 'post', locale: 'en', translation_key: 'hello', published_revision_id: null },
        { id: 'item-2', kind: 'page', locale: 'en', translation_key: 'about', published_revision_id: 'rev-old' },
      ],
      overlay: [{ id: 'rev-1', item_id: 'item-1', slug: 'hello', title: 'Hello' }],
    }),
  )
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger)

  const result = await releases.publish({ siteId: 'site-1', revisionIds: ['rev-1'], reason: 'first publish' })
  assert.equal(repo.enqueued.length, 1)
  const { exec, site, events } = repo.enqueued[0]
  assert.equal(exec, db, 'events must be enqueued through the activation transaction')
  assert.equal(site, snapshotSite)
  assert.deepEqual(
    events.map((event) => event.type),
    ['contentkit.content.published', 'contentkit.release.published'],
  )
  assert.deepEqual(events[0], {
    type: 'contentkit.content.published',
    resourceKind: 'content',
    resourceId: 'item-1',
    summary: 'Content published',
    data: {
      item_id: 'item-1',
      kind: 'post',
      locale: 'en',
      translation_key: 'hello',
      slug: 'hello',
      title: 'Hello',
      revision_id: 'rev-1',
      release_id: result.release_id,
    },
  })
  assert.deepEqual(events[1].data, {
    release_id: result.release_id,
    reason: 'first publish',
    published_count: 1,
    unpublished_count: 0,
    deck_count: 0,
  })
})

test('a no-op republish emits only release.published', async () => {
  const db = makeDb()
  const repo = makeRepo(
    makeSnapshot({
      items: [{ id: 'item-1', kind: 'post', locale: 'en', translation_key: 'hello', published_revision_id: 'rev-1' }],
      overlay: [{ id: 'rev-1', item_id: 'item-1', slug: 'hello', title: 'Hello' }],
    }),
  )
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger)

  await releases.publish({ siteId: 'site-1', revisionIds: ['rev-1'] })
  const { events } = repo.enqueued[0]
  assert.deepEqual(
    events.map((event) => event.type),
    ['contentkit.release.published'],
  )
  assert.equal(events[0].data.published_count, 0)
})

test('deck activation emits the source-addressed deck event and build statistics', async () => {
  const markdown = `---
kind: deck
layout: deck
title: Release deck
locale: en
slug: release-deck
---
# Release deck

---

# Decision
`
  const revision = {
    id: 'deck-rev-1',
    item_id: 'deck-item-1',
    kind: 'deck',
    locale: 'en',
    translation_key: 'release-deck',
    slug: 'release-deck',
    title: 'Release deck',
    markdown,
  }
  const db = makeDb()
  const repo = makeRepo(
    makeSnapshot({
      revisions: [revision],
      overlay: [revision],
      items: [
        {
          id: revision.item_id,
          kind: 'deck',
          locale: 'en',
          translation_key: 'release-deck',
          published_revision_id: null,
        },
      ],
    }),
  )
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger, {
    deckRenderer: {
      async render() {
        return { html: '<!doctype html><html><head></head><body>deck</body></html>', cache: 'miss' }
      },
    },
  })

  await releases.publish({ siteId: 'site-1', revisionIds: [revision.id] })
  const events = repo.enqueued[0].events
  assert.deepEqual(
    events.map((event) => event.type),
    ['contentkit.content.published', 'contentkit.deck.published', 'contentkit.release.published'],
  )
  const deckEvent = events[1]
  assert.equal(deckEvent.data.slide_count, 2)
  assert.match(deckEvent.data.plan_sha256, /^[0-9a-f]{64}$/)
  assert.equal(deckEvent.data.url, '/en/slides/release-deck/')
  assert.ok(
    db.calls.inserts.some(
      (call) =>
        call.table === 'ck_deck_build_events' && call.body.mode === 'release' && call.body.cache_result === 'miss',
    ),
  )
})

test('retiring a published item emits content.unpublished with the retired revision', async () => {
  const db = makeDb({
    selectRows: { ck_content_revisions: [{ id: 'rev-old', item_id: 'item-1', slug: 'bye', title: 'Bye' }] },
  })
  const repo = makeRepo(
    makeSnapshot({
      items: [
        { id: 'item-1', kind: 'post', locale: 'en', translation_key: 'bye', published_revision_id: 'rev-old' },
        { id: 'item-2', kind: 'page', locale: 'en', translation_key: 'never', published_revision_id: null },
      ],
    }),
  )
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger)

  const result = await releases.publish({ siteId: 'site-1', revisionIds: [], retireItemIds: ['item-1', 'item-2'] })
  const { events } = repo.enqueued[0]
  // item-2 had no published pointer, so retiring it is a no-op and stays silent.
  assert.deepEqual(
    events.map((event) => event.type),
    ['contentkit.content.unpublished', 'contentkit.release.published'],
  )
  assert.deepEqual(events[0].data, {
    item_id: 'item-1',
    kind: 'post',
    locale: 'en',
    translation_key: 'bye',
    slug: 'bye',
    title: 'Bye',
    revision_id: 'rev-old',
    release_id: result.release_id,
  })
  assert.deepEqual(events[1].data, {
    release_id: result.release_id,
    reason: '',
    published_count: 0,
    unpublished_count: 1,
    deck_count: 0,
  })
})

test('a stale-epoch first attempt enqueues nothing; only the retry attempt emits events', async () => {
  const db = makeDb({ rpcError: true })
  const repo = makeRepo()
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger)

  await releases.publish({ siteId: 'site-1', revisionIds: [] })
  assert.equal(repo.snapshots, 2)
  assert.equal(repo.enqueued.length, 1, 'the failed activation must not enqueue events')
  assert.deepEqual(
    repo.enqueued[0].events.map((event) => event.type),
    ['contentkit.release.published'],
  )
})

// A controlled builder via the buildRunner hook: exact bytes in, so dedup
// matches are deterministic instead of depending on real build output.
function makeBuilder(files, content = []) {
  return {
    async build() {
      return { files: new Map(files), content, accessEntries: [], accessCatalog: [] }
    },
    async close() {},
  }
}

const HTML = { contentType: 'text/html', cacheControl: 'public,max-age=60,must-revalidate' }

function priorEntry(path, body, overrides = {}) {
  return {
    path,
    storage_path: `sites/site-1/releases/r-prev/${path}`,
    content_type: HTML.contentType,
    cache_control: HTML.cacheControl,
    sha256: sha256(body),
    byte_size: body.length,
    ...overrides,
  }
}

test('publish reuses unchanged objects from the active release instead of re-uploading', async () => {
  const unchanged = Buffer.from('same bytes')
  const changed = Buffer.from('new bytes')
  const db = makeDb({
    selectRows: {
      ck_release_entries: [priorEntry('index.html', unchanged), priorEntry('about.html', Buffer.from('old bytes'))],
    },
  })
  const storage = makeStorage()
  const repo = makeRepo(makeSnapshot({ site: { ...snapshotSite, active_release_id: 'r-prev' } }))
  const builder = makeBuilder([
    ['index.html', { body: unchanged, ...HTML }],
    ['about.html', { body: changed, ...HTML }],
  ])
  const releases = createReleaseManager(config, repo, db, storage, logger, { buildRunner: builder })

  const result = await releases.publish({ siteId: 'site-1', revisionIds: [] })
  assert.equal(result.file_count, 2)
  assert.deepEqual(storage.uploaded, [`sites/site-1/releases/${result.release_id}/about.html`])
  const entries = db.calls.inserts.find((call) => call.table === 'ck_release_entries').body
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  assert.equal(
    byPath.get('index.html').storage_path,
    'sites/site-1/releases/r-prev/index.html',
    'unchanged file reuses the prior object',
  )
  assert.equal(byPath.get('about.html').storage_path, `sites/site-1/releases/${result.release_id}/about.html`)
  assert.equal(
    byPath.get('index.html').cache_control,
    HTML.cacheControl,
    'cache_control is persisted for future matches',
  )
})

test('a changed content type or cache-control defeats the dedup match despite equal bytes', async () => {
  const body = Buffer.from('same bytes')
  const db = makeDb({
    selectRows: {
      ck_release_entries: [
        priorEntry('index.html', body, { cache_control: null }),
        priorEntry('data.json', body, {
          content_type: 'text/plain',
          cache_control: 'public,max-age=31536000,immutable',
        }),
      ],
    },
  })
  const storage = makeStorage()
  const repo = makeRepo(makeSnapshot({ site: { ...snapshotSite, active_release_id: 'r-prev' } }))
  const builder = makeBuilder([
    ['index.html', { body, ...HTML }],
    ['data.json', { body, contentType: 'application/json', cacheControl: 'public,max-age=31536000,immutable' }],
  ])
  const releases = createReleaseManager(config, repo, db, storage, logger, { buildRunner: builder })

  const result = await releases.publish({ siteId: 'site-1', revisionIds: [] })
  assert.deepEqual(
    [...storage.uploaded].sort(),
    [`sites/site-1/releases/${result.release_id}/data.json`, `sites/site-1/releases/${result.release_id}/index.html`],
    'legacy NULL cache_control and a different content type both force a fresh upload',
  )
})

test('uploads run concurrently but never beyond uploadConcurrency', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const storage = {
    async upload() {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setImmediate(resolve))
      inFlight--
    },
  }
  const files = Array.from({ length: 20 }, (_, i) => [`page-${i}.html`, { body: Buffer.from(`page ${i}`), ...HTML }])
  const releases = createReleaseManager({ ...config, uploadConcurrency: 3 }, makeRepo(), makeDb(), storage, logger, {
    buildRunner: makeBuilder(files),
  })

  await releases.publish({ siteId: 'site-1', revisionIds: [] })
  assert.ok(maxInFlight > 1, 'uploads must actually overlap')
  assert.ok(maxInFlight <= 3, `at most 3 uploads in flight, saw ${maxInFlight}`)
})

test('failure cleanup removes only own uploads, never objects reused from the active release', async () => {
  const unchanged = Buffer.from('same bytes')
  const db = makeDb({ selectRows: { ck_release_entries: [priorEntry('index.html', unchanged)] } })
  const storage = makeStorage({ failOnUpload: 2 })
  const repo = makeRepo(makeSnapshot({ site: { ...snapshotSite, active_release_id: 'r-prev' } }))
  const builder = makeBuilder([
    ['index.html', { body: unchanged, ...HTML }],
    ['a.html', { body: Buffer.from('a'), ...HTML }],
    ['b.html', { body: Buffer.from('b'), ...HTML }],
  ])
  const releases = createReleaseManager(config, repo, db, storage, logger, { buildRunner: builder })

  await assert.rejects(() => releases.publish({ siteId: 'site-1', revisionIds: [] }), /storage down/)
  assert.ok(storage.removed.length >= 1, 'the successful upload is cleaned up')
  assert.ok(
    storage.removed.every((path) => !path.includes('r-prev')),
    'the active release object referenced by the reused entry must survive',
  )
  assert.deepEqual([...storage.removed].sort(), [...storage.uploaded].sort())
})

test('rollback emits only release.published with reason rollback and zero counts', async () => {
  const db = makeDb()
  const repo = makeRepo()
  repo.getRelease = async () => ({ id: 'release-1', site_id: 'site-1', status: 'superseded' })
  const releases = createReleaseManager(config, repo, db, makeStorage(), logger)

  await releases.rollback('site-1', 'release-1')
  assert.equal(repo.enqueued.length, 1)
  const { events } = repo.enqueued[0]
  assert.deepEqual(
    events.map((event) => event.type),
    ['contentkit.release.published'],
  )
  assert.deepEqual(events[0].data, {
    release_id: 'release-1',
    reason: 'rollback',
    published_count: 0,
    unpublished_count: 0,
  })
})
