import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDeckRenderer, sweepStaleDeckBuilds } from '../../src/deck-renderer.mjs'

const logger = { debug() {} }

async function fixture(script) {
  const root = await mkdtemp(join(tmpdir(), 'contentkit-deck-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'assets', 'deck-neutral.css'), '.slidev-layout{color:teal}', 'utf8')
  await writeFile(join(root, 'fake-slidev.mjs'), script, 'utf8')
  return {
    root,
    config: {
      root,
      version: 'test',
      deckBuildConcurrency: 1,
      deckBuildQueueMax: 1,
      deckBuildTimeoutMs: 1000,
      deckQueueTimeoutMs: 1000,
      deckCacheMax: 2,
      deckWorkDir: join(root, '.deck-work'),
      deckSlidevCli: join(root, 'fake-slidev.mjs'),
    },
  }
}

test('deck renderer injects controlled CSS, caches and cleans every build file', async () => {
  const f = await fixture(`
    import { mkdir, writeFile } from 'node:fs/promises'
    const out = process.argv[process.argv.indexOf('--out') + 1]
    await mkdir(out, { recursive: true })
    await writeFile(out + '/index.html', '<html><head><link href="https://fonts.googleapis.com/x"></head><body>ok</body></html>')
  `)
  const cache = []
  const builds = []
  try {
    const renderer = createDeckRenderer(f.config, logger, {
      cache: (value) => cache.push(value),
      build: (value) => builds.push(value),
    })
    const first = await renderer.render('# Deck')
    const second = await renderer.render('# Deck')
    assert.equal(first.cache, 'miss')
    assert.equal(second.cache, 'hit')
    assert.equal(first.html, second.html)
    assert.match(first.html, /data-contentkit-deck-theme/)
    assert.match(first.html, /color:teal/)
    assert.doesNotMatch(first.html, /fonts\.googleapis/)
    assert.deepEqual(cache, ['miss', 'hit'])
    assert.equal(builds.length, 1)
    assert.deepEqual(
      (await readdir(f.root)).filter((name) => /^\.deck-.*\.md$/.test(name)),
      [],
    )
    assert.deepEqual(await readdir(f.config.deckWorkDir), [])

    await writeFile(join(f.root, '.deck-stale.md'), 'stale')
    await mkdir(join(f.config.deckWorkDir, 'stale'))
    await sweepStaleDeckBuilds(f.config)
    await assert.rejects(readFile(join(f.root, '.deck-stale.md')), /ENOENT/)
    assert.deepEqual(await readdir(f.config.deckWorkDir), [])
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('deck renderer kills builds that exceed the bounded timeout', { timeout: 5000 }, async () => {
  const f = await fixture('setInterval(() => {}, 1000)')
  f.config.deckBuildTimeoutMs = 30
  try {
    const renderer = createDeckRenderer(f.config, logger)
    await assert.rejects(renderer.render('# Deck'), (error) => error.code === 'TIMEOUT' && error.statusCode === 504)
    assert.equal(renderer.inflight(), 0)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})
