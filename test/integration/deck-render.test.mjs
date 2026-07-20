import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { compileDeck } from '../../src/decks.mjs'
import { createDeckRenderer } from '../../src/deck-renderer.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')

test('real Slidev compiler emits one offline presenter-capable semantic deck', { timeout: 120000 }, async () => {
  const work = await mkdtemp(join(tmpdir(), 'contentkit-real-deck-'))
  const renderer = createDeckRenderer(
    {
      root,
      version: 'integration',
      deckBuildConcurrency: 1,
      deckBuildQueueMax: 1,
      deckBuildTimeoutMs: 120000,
      deckQueueTimeoutMs: 120000,
      deckCacheMax: 2,
      deckWorkDir: work,
      deckSlidevCli: join(root, 'node_modules', '@slidev', 'cli', 'bin', 'slidev.mjs'),
    },
    { debug() {} },
  )
  try {
    const source = await readFile(join(root, 'examples', 'decks', 'decision.en.md'), 'utf8')
    const compiled = await renderer.run((render) =>
      compileDeck(source, {
        renderHtml: async (markdown, theme) => (await render(markdown, theme)).html,
      }),
    )
    assert.equal(compiled.plan.slides.length, 5)
    assert.ok(compiled.artifacts.length >= 2)
    assert.match(compiled.html, /^<!DOCTYPE html>/i)
    assert.match(compiled.html, /data-contentkit-deck-theme/)
    assert.match(compiled.html, /presenter/)
    assert.doesNotMatch(compiled.html, /<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:/i)
    assert.doesNotMatch(compiled.html, /fonts\.googleapis|fonts\.gstatic/)
    assert.match(compiled.html_sha256, /^[0-9a-f]{64}$/)

    const cached = await renderer.render(compiled.markdown, compiled.plan.settings.theme)
    assert.equal(cached.cache, 'hit')
    assert.equal(cached.html, compiled.html)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
})
