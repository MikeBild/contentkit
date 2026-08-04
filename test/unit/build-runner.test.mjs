import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILD_WORKER_ENTRY, createBuildRunner } from '../../src/build-runner.mjs'
import { createReleaseManager } from '../../src/releases.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const site = {
  id: 'runner-site',
  name: 'Runner',
  base_url: 'https://runner.example',
  default_locale: 'en',
  settings: {},
}

const doc = (slug, extra = '') => ({
  id: `rev-${slug}`,
  item_id: `item-${slug}`,
  kind: 'post',
  locale: 'en',
  translation_key: slug,
  markdown: `---\nkind: post\ntitle: ${slug}\nlocale: en\nslug: ${slug}\ntranslationKey: ${slug}\n${extra}---\n\nBody for ${slug}.\n`,
})

const deckDoc = {
  id: 'rev-deck',
  item_id: 'item-deck',
  kind: 'deck',
  locale: 'en',
  translation_key: 'runner-deck',
  markdown: `---\nkind: deck\ntitle: Runner deck\nlocale: en\nslug: runner-deck\ntranslationKey: runner-deck\n---\n\n# One\n\n---\n\n# Two\n`,
}

const build = (runner, revisions) => runner.build({ site, locales: [{ locale: 'en' }], revisions })

test('the worker entry point resolves as a sibling of the runner, not from cwd', () => {
  // This is the mistake that would break only in the standalone binary, which
  // unpacks src/ to a cache directory and runs server.mjs from there. A
  // cwd-relative or argv-relative path passes every test in a checkout.
  assert.ok(BUILD_WORKER_ENTRY.href.endsWith('/src/build-worker.mjs'))
  assert.ok(existsSync(fileURLToPath(BUILD_WORKER_ENTRY)), 'build-worker.mjs is missing next to build-runner.mjs')
  const source = readFileSync(join(root, 'src', 'build-runner.mjs'), 'utf8')
  assert.doesNotMatch(source, /process\.cwd\(\)/, 'the build runner must not resolve its worker through cwd')
  // src/ ships wholesale in the binary payload, which is what puts the worker
  // entry beside its runner after extraction.
  assert.match(readFileSync(join(root, 'build-binary.sh'), 'utf8'), /\bsrc\b/)
})

// Spawning a worker costs ~2.3s of module compilation, so the cases that need
// nothing special from the runner share one. Anything testing lifecycle or a
// particular deck renderer builds its own.
const shared = createBuildRunner({ root })
after(() => shared.close())

test('a build in a worker returns the same shape as an in-process build', async () => {
  const built = await build(shared, [doc('alpha'), doc('beta')])
  assert.ok(built.files.size > 0)
  assert.equal(built.content.length, 2)
  // Structured clone hands back Uint8Array; everything downstream in
  // releases.mjs (sha256, byte_size, storage.upload) is written for Buffer.
  for (const file of built.files.values()) assert.ok(Buffer.isBuffer(file.body), 'file bodies must be Buffers')
  assert.ok(built.files.get('en/blog/alpha/index.html'), 'the rendered page is missing')
})

test('a build failure keeps its status code across the thread boundary', async () => {
  // Structured clone drops an Error's own properties. Losing statusCode would
  // turn an author's 422 into a 500 the moment the build moved off-thread.
  await assert.rejects(
    () => build(shared, [doc('same'), { ...doc('same'), id: 'rev-other', item_id: 'item-other' }]),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /duplicate/i)
      return true
    },
  )
})

test('a worker survives a failed build and serves the next one', async () => {
  assert.ok((await build(shared, [doc('after-failure')])).files.size > 0)
})

test('the worker is reused across builds and released after the idle window', async () => {
  const runner = createBuildRunner({ root, idleMs: 40 })
  try {
    await build(runner, [doc('one')])
    assert.equal(runner.workers(), 1)
    await build(runner, [doc('two')])
    assert.equal(runner.workers(), 1, 'a second build must reuse the warm worker')
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(runner.workers(), 0, 'an idle worker must be given back')
    // …and the runner still works afterwards.
    assert.ok((await build(runner, [doc('three')])).files.size > 0)
  } finally {
    await runner.close()
  }
})

test('builds beyond the concurrency limit queue instead of spawning more workers', async () => {
  const runner = createBuildRunner({ root, concurrency: 1 })
  try {
    const first = build(runner, [doc('q1')])
    const second = build(runner, [doc('q2')])
    assert.equal(runner.queued(), 1, 'the second build must wait for the permit, not open a second worker')
    await Promise.all([first, second])
    assert.equal(runner.workers(), 1)
  } finally {
    await runner.close()
  }
})

test('closing the runner rejects in-flight and queued builds', async () => {
  const runner = createBuildRunner({ root, concurrency: 1 })
  // Handlers are attached before close(), because close() rejects both
  // synchronously and an unhandled rejection is a test failure of its own.
  const inflight = build(runner, [doc('c1')]).then(
    () => null,
    (error) => error,
  )
  const queued = build(runner, [doc('c2')]).then(
    () => null,
    (error) => error,
  )
  await runner.close()
  assert.match(String((await inflight)?.message), /stopped|closed/)
  assert.match(String((await queued)?.message), /closed/)
  await assert.rejects(() => build(runner, [doc('c3')]), /closed/)
})

test('the deck renderer stays on the parent thread and its permit spans the compile', async () => {
  const order = []
  let active = 0
  const deckRenderer = {
    async run(task) {
      active++
      order.push('acquire')
      assert.equal(active, 1, 'two builds must never hold the deck permit at once')
      try {
        return await task(async () => {
          order.push('render')
          return { html: '<!doctype html><html><head></head><body>deck</body></html>', cache: 'miss' }
        })
      } finally {
        active--
        order.push('release')
      }
    },
  }
  const runner = createBuildRunner({ root, deckRenderer })
  try {
    const built = await build(runner, [deckDoc])
    assert.deepEqual(order.slice(0, 2), ['acquire', 'render'])
    assert.equal(order.at(-1), 'release', 'the permit must be released after the compile, not before')
    assert.equal(built.content[0].slide_count, 2)
    assert.equal(built.content[0].deck_cache_result, 'miss')
  } finally {
    await runner.close()
  }
})

test('a renderer that offers only render() is accepted, as it is in-process', async () => {
  const runner = createBuildRunner({
    root,
    deckRenderer: {
      async render() {
        return { html: '<!doctype html><html><head></head><body>deck</body></html>', cache: 'hit' }
      },
    },
  })
  try {
    const built = await build(runner, [deckDoc])
    assert.equal(built.content[0].deck_cache_result, 'hit')
  } finally {
    await runner.close()
  }
})

test('a deck render failure fails the build with its own status code', async () => {
  const runner = createBuildRunner({
    root,
    deckRenderer: {
      async run() {
        throw Object.assign(new Error('deck build timed out'), { code: 'TIMEOUT', statusCode: 504 })
      },
    },
  })
  try {
    await assert.rejects(
      () => build(runner, [deckDoc]),
      (error) => {
        assert.equal(error.statusCode, 504)
        assert.equal(error.code, 'TIMEOUT')
        return true
      },
    )
  } finally {
    await runner.close()
  }
})

test('a build with no deck renderer configured still fails as 503, not as a hang', async () => {
  await assert.rejects(() => build(shared, [deckDoc]), /deck renderer is unavailable/)
})

// --- the wiring in releases.mjs -------------------------------------------------

const releaseConfig = { root, buildConcurrency: 1, publicUrl: 'http://127.0.0.1:4050', previewSecret: 's' }
const silent = { warn() {}, error() {}, info() {}, debug() {} }

function stubs() {
  const snapshot = {
    site: { ...site, id: 'site-1', publish_epoch: 1 },
    locales: [{ locale: 'en' }],
    revisions: [doc('wired')],
    comments: [],
    audio: [],
    accessRules: [],
    accessGroups: [],
    items: [{ id: 'item-wired', kind: 'post', locale: 'en', translation_key: 'wired', published_revision_id: null }],
    overlay: [],
  }
  return {
    repo: {
      async buildSnapshot() {
        return snapshot
      },
      async enqueueContentEvents() {},
      async createOutbox() {},
      async getSite() {
        return snapshot.site
      },
    },
    db: {
      async insert() {},
      async update() {},
      async remove() {},
      async select() {
        return []
      },
      async tx(fn) {
        return fn({ async rpc() {}, async insert() {} })
      },
    },
    storage: {
      uploaded: [],
      async upload(path) {
        this.uploaded.push(path)
      },
      async remove() {},
    },
  }
}

// That the DEFAULT config routes off-thread is proven by test/load — a mutation
// that forces the in-process path passes every assertion in this file and fails
// there. What this case pins down is the shape of the boundary.
test('only the build inputs cross to the runner', async () => {
  const { repo, db, storage } = stubs()
  let usedRunner = 0
  const releases = createReleaseManager(releaseConfig, repo, db, storage, silent, {
    buildRunner: {
      build(input) {
        usedRunner++
        // Only what buildSite reads should cross the boundary.
        assert.deepEqual(Object.keys(input).sort(), [
          'accessGroups',
          'accessRules',
          'audio',
          'comments',
          'locales',
          'revisions',
          'site',
        ])
        return Promise.resolve({ files: new Map(), content: [], accessEntries: [], accessCatalog: [] })
      },
      async close() {},
    },
  })
  await releases.publish({ siteId: 'site-1', revisionIds: [] })
  assert.equal(usedRunner, 1, 'publish must route the build through the runner')
  await releases.stop()
})

test('config.buildWorker false keeps the build in this process', async () => {
  const { repo, db, storage } = stubs()
  const releases = createReleaseManager({ ...releaseConfig, buildWorker: false }, repo, db, storage, silent)
  const result = await releases.publish({ siteId: 'site-1', revisionIds: [] })
  assert.ok(result.file_count > 0, 'the in-process escape hatch must still produce a release')
  await releases.stop()
})

/**
 * A worker that dies must not take the queue with it.
 *
 * `checkIn` is the only other place that shifts the queue, and it runs when a job
 * FINISHES — a worker that is killed never finishes one. So with every worker busy
 * and a build queued behind them, one out-of-memory left that build waiting forever:
 * no rejection, no timeout at this level, nothing the caller could observe. Found by
 * an adversarial pass reading the runner, not by any test.
 */
test('a queued build still runs after the worker ahead of it dies', async () => {
  // 40 MB is under what rendering needs, so the first build reliably dies of it,
  // which is the real shape of the failure rather than a stubbed rejection.
  const runner = createBuildRunner({ root, concurrency: 1, resourceLimits: { maxOldGenerationSizeMb: 40 } })
  try {
    const docs = Array.from({ length: 400 }, (_, index) => doc(`heavy-${index}`))
    const dying = build(runner, docs).then(
      () => null,
      (error) => error,
    )
    const queued = build(runner, [doc('after-the-death')])
    assert.equal(runner.queued(), 1, 'the second build must be queued behind the only worker')

    assert.ok(await dying, 'the dying worker rejects its own job — that part always worked')

    // The assertion that matters. Without the fix this never settles: the queue is
    // only drained by a job finishing, and this worker never finished one.
    const settled = await Promise.race([
      queued.then(
        (value) => value,
        (error) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve('ABANDONED'), 20_000)),
    ])
    assert.notEqual(settled, 'ABANDONED', 'a build queued behind a worker that died was never served')
    assert.equal(runner.queued(), 0, 'and the queue is empty afterwards')
  } finally {
    await runner.close()
  }
})
