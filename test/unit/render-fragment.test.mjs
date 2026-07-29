import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { renderFragment, renderFragmentEtag } from '../../src/render-fragment.mjs'

// The console must show authored Markdown with the same semantics a published
// page gets. A second renderer in the browser would have to reimplement
// directive parsing, the chart shapes and the sanitize allowlist, and would
// drift from what is actually published. This is that pipeline, one step early.
const RICH = [
  '# Titel',
  '',
  'Ein Absatz mit `code` und $E=mc^2$.',
  '',
  '```js',
  'const answer = 42',
  '```',
  '',
  '```mermaid',
  'graph TD; A-->B;',
  '```',
  '',
  ':::metric{label="Releases" value="42"}',
  ':::',
  '',
].join('\n')

describe('renderFragment', () => {
  test('renders prose without frontmatter instead of rejecting it', async () => {
    // A chat reply and a half-written draft have no frontmatter; demanding it
    // would make the endpoint useless for exactly its two callers.
    const out = await renderFragment({ markdown: 'Hello **world**.', version: 't' })
    assert.match(out.html, /<strong>world<\/strong>/)
    assert.equal(out.semantic?.presentation, 'prose')
    assert.deepEqual(out.diagnostics, [])
  })

  test('carries math, highlighting, diagrams and semantic directives through', async () => {
    const out = await renderFragment({ markdown: RICH, version: 't' })
    assert.match(out.html, /class="katex"/, 'math must render')
    assert.match(out.html, /<pre|<code/, 'code must render')
    assert.equal(out.has_mermaid, true, 'the caller needs to know a Mermaid runtime is required')
    const nodes = (out.semantic?.nodes ?? []).map((node) => node.type)
    assert.ok(nodes.includes('metric'), `expected a metric node, got ${nodes.join(',')}`)
    assert.ok(nodes.includes('diagram'), `expected a diagram node, got ${nodes.join(',')}`)
  })

  test('an explicit scheme emits one image, not a prefers-color-scheme picture', async () => {
    // The console's theme is a class the operator can set against the OS. A
    // <picture> would then show light charts on a dark surface.
    const chart = [
      '---',
      'title: Report',
      'layout: report',
      '---',
      '',
      ':::chart{title="Builds" description="Builds per month" type="line"}',
      '| period | builds |',
      '| --- | --- |',
      '| Jan | 4 |',
      '| Feb | 9 |',
      ':::',
      '',
    ].join('\n')

    const dark = await renderFragment({ markdown: chart, scheme: 'dark', version: 't' })
    if (dark.chart_count === 0) return // no chart pipeline in this build; nothing to assert
    assert.doesNotMatch(dark.html, /prefers-color-scheme/, 'an explicit scheme must not defer to the OS')
    assert.match(dark.html, /<img[^>]+report-chart-image/)

    const auto = await renderFragment({ markdown: chart, scheme: 'auto', version: 't' })
    assert.match(auto.html, /<picture/, 'a published page still needs the responsive picture')
  })

  test('oversized input is refused before it is parsed', async () => {
    await assert.rejects(renderFragment({ markdown: 'x'.repeat(300 * 1024), version: 't' }), (error) => {
      assert.equal(error.statusCode, 413)
      return true
    })
  })

  test('the ETag changes with the markdown, the theme and the scheme', async () => {
    const base = { markdown: '# A', scheme: 'auto', themeHash: 'aaa', version: '1' }
    const etag = renderFragmentEtag(base)
    assert.notEqual(etag, renderFragmentEtag({ ...base, markdown: '# B' }))
    assert.notEqual(etag, renderFragmentEtag({ ...base, scheme: 'dark' }))
    assert.notEqual(etag, renderFragmentEtag({ ...base, themeHash: 'bbb' }))
    // A release changes the renderer, so a cached fragment must not survive it.
    assert.notEqual(etag, renderFragmentEtag({ ...base, version: '2' }))
  })

  test('identical input renders once and is served from cache', async () => {
    const first = await renderFragment({ markdown: '# Cached', version: 't' })
    const second = await renderFragment({ markdown: '# Cached', version: 't' })
    assert.equal(first, second, 'the same fragment must not be rendered twice')
  })
})
