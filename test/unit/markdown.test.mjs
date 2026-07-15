import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../../src/markdown.mjs'

const frontmatter = `---
kind: post
title: Test post
locale: de
slug: test-post
translationKey: test-post
tags: [one, two]
---
`

test('renders the rich Markdown profile', async () => {
  const result = await renderMarkdown(`${frontmatter}
# Heading

~~strike~~

| A | B |
| - | - |
| 1 | 2 |

- [x] done

$E=mc^2$

\`\`\`js
const ok = true
\`\`\`

\`\`\`mermaid
flowchart LR; A-->B
\`\`\`
`)
  assert.equal(result.meta.kind, 'post')
  assert.deepEqual(result.meta.tags, ['one', 'two'])
  assert.match(result.html, /<table>/)
  assert.match(result.html, /class="katex"/)
  assert.match(result.html, /class="mermaid"/)
  assert.match(result.html, /shiki/)
  assert.equal(result.hasMermaid, true)
})

test('does not pass through raw HTML or script URLs', async () => {
  const result = await renderMarkdown(`${frontmatter}
<script>alert(1)</script>
<img src=x onerror=alert(2)>
[bad](javascript:alert(3))
`)
  assert.doesNotMatch(result.html, /script|onerror|javascript:/i)
})

test('validates required frontmatter', async () => {
  await assert.rejects(() => renderMarkdown('---\nlocale: invalid_locale\n---\n# Missing'), /title is required/)
})

test('tldr and faq frontmatter are validated, trimmed and default to empty', async () => {
  const doc = `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\ntldr:\n  - " Erste Kernaussage "\n  - Zweite Kernaussage\nfaq:\n  - q: " Was ist T? "\n    a: Ein Test.\n---\nBody.`
  const result = await renderMarkdown(doc)
  assert.deepEqual(result.meta.tldr, ['Erste Kernaussage', 'Zweite Kernaussage'])
  assert.deepEqual(result.meta.faq, [{ q: 'Was ist T?', a: 'Ein Test.' }])

  const plain = await renderMarkdown(`---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n---\nBody.`)
  assert.deepEqual(plain.meta.tldr, [])
  assert.deepEqual(plain.meta.faq, [])
})

test('malformed tldr and faq frontmatter fail the upload with a clear 422', async () => {
  const doc = (fields) => `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n${fields}\n---\nBody.`
  await assert.rejects(() => renderMarkdown(doc('tldr: not a list')), /tldr must be a list/)
  await assert.rejects(() => renderMarkdown(doc('tldr:\n  - ok\n  - ""')), /tldr must not contain empty entries/)
  await assert.rejects(
    () => renderMarkdown(doc('tldr:\n  - q: nested\n    a: object')),
    /tldr must be a list of strings/,
  )
  await assert.rejects(() => renderMarkdown(doc('faq: not a list')), /faq must be a list/)
  await assert.rejects(
    () => renderMarkdown(doc('faq:\n  - q: only a question')),
    /faq must be a list of \{ q, a \} entries/,
  )
  await assert.rejects(
    () => renderMarkdown(doc('faq:\n  - q: ""\n    a: answer')),
    /faq entries need a non-empty q and a/,
  )
})

test('a leading heading that repeats the title is dropped from the rendered html', async () => {
  // The layout renders the frontmatter title as the page <h1>; the authored copy would
  // make it the second one and start the document outline twice.
  const doc = (body) => `---\nkind: post\ntitle: Signed Webhooks\nlocale: de\nslug: s\nsummary: S\n---\n\n${body}`
  const h1s = (html) => (html.match(/<h1/g) || []).length

  assert.equal(h1s((await renderMarkdown(doc('# Signed Webhooks\n\nText.'))).html), 0)
  // Matching is on normalized text, so casing, spacing and inline markup do not matter.
  assert.equal(h1s((await renderMarkdown(doc('#   signed   webhooks\n\nText.'))).html), 0)
  assert.equal(h1s((await renderMarkdown(doc('# Signed *Webhooks*\n\nText.'))).html), 0)

  // Inline markdown in the *title* is the case that shipped broken: mdast renders
  // `` `async/await` `` as an inlineCode node without backticks, while the frontmatter
  // title is a raw string that still has them.
  const coded = (title, body) => `---\nkind: post\ntitle: ${title}\nlocale: de\nslug: s\nsummary: S\n---\n\n${body}`
  assert.equal(h1s((await renderMarkdown(coded('Control Flow vor `x/y`', '# Control Flow vor `x/y`\n\nT.'))).html), 0)
  assert.equal(h1s((await renderMarkdown(coded('Signed *Webhooks*', '# Signed *Webhooks*\n\nT.'))).html), 0)
  assert.equal(h1s((await renderMarkdown(coded('snake_case Regeln', '# snake_case Regeln\n\nT.'))).html), 0)

  // A near-miss must not be swallowed.
  assert.equal(h1s((await renderMarkdown(doc('# Signed Webhooks II\n\nText.'))).html), 1)

  // A body that deliberately opens with a different top-level heading keeps it, and a
  // heading that is not the first block is never touched.
  assert.equal(h1s((await renderMarkdown(doc('# Vorwort\n\nText.'))).html), 1)
  assert.equal(h1s((await renderMarkdown(doc('Intro.\n\n# Signed Webhooks\n\nText.'))).html), 1)
})

test('dropping the redundant title leaves the body, the anchors and the source alone', async () => {
  const result = await renderMarkdown(
    `---\nkind: post\ntitle: T\nlocale: de\nslug: s\nsummary: S\n---\n\n# T\n\nBody stays.\n\n## Section\n`,
  )
  assert.match(result.html, /Body stays\./)
  assert.match(result.html, /<h2[^>]*id="section"/, 'lower headings keep their slugs and anchors')
  // `source` feeds llms-full.txt and the reading-time estimate: it is the authored
  // document, not the rendered one.
  assert.match(result.source, /^\s*# T\n/)
})

test('extra frontmatter passes through verbatim with its YAML types preserved', async () => {
  const doc = `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\nextra:\n  reading_level: 3\n  series: effect-ts\n  audiences: [devs, ops]\n  ratings:\n    stars: 4.5\n    source: internal\n---\nBody.`
  const result = await renderMarkdown(doc)
  assert.deepEqual(result.meta.extra, {
    reading_level: 3,
    series: 'effect-ts',
    audiences: ['devs', 'ops'],
    ratings: { stars: 4.5, source: 'internal' },
  })
})

test('absent or empty extra and related leave the meta exactly as it is today', async () => {
  const plain = await renderMarkdown(`---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n---\nBody.`)
  assert.ok(!('extra' in plain.meta), 'absent extra must not appear in meta')
  assert.ok(!('related_slugs' in plain.meta), 'absent related must not appear in meta')

  // Empty values are treated as absent, so old revisions and empty-authored
  // ones serialize to byte-identical metadata.
  const empty = await renderMarkdown(
    `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\nextra: {}\nrelated: []\n---\nBody.`,
  )
  assert.equal(JSON.stringify(empty.meta), JSON.stringify(plain.meta))
})

test('malformed extra frontmatter fails the upload with a clear 422', async () => {
  const doc = (fields) => `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n${fields}\n---\nBody.`
  await assert.rejects(() => renderMarkdown(doc('extra: not a map')), /extra must be a map of custom fields/)
  await assert.rejects(() => renderMarkdown(doc('extra:\n  - a\n  - b')), /extra must be a map of custom fields/)
  await assert.rejects(
    () => renderMarkdown(doc('extra:\n  BadKey: 1')),
    /extra keys must match \[a-z\]\[a-z0-9_\]\{0,63\}/,
  )
  await assert.rejects(
    () => renderMarkdown(doc('extra:\n  nested:\n    BadKey: 1')),
    /extra keys must match/,
    'nested map keys follow the same pattern',
  )
  const manyFields = `extra:\n${Array.from({ length: 33 }, (_, i) => `  field_${i}: 1`).join('\n')}`
  await assert.rejects(() => renderMarkdown(doc(manyFields)), /extra allows at most 32 fields/)
  const longList = `extra:\n  list: [${Array.from({ length: 65 }, (_, i) => i).join(', ')}]`
  await assert.rejects(() => renderMarkdown(doc(longList)), /extra lists allow at most 64 entries/)
  const bigMap = `extra:\n  map:\n${Array.from({ length: 33 }, (_, i) => `    key_${i}: 1`).join('\n')}`
  await assert.rejects(() => renderMarkdown(doc(bigMap)), /extra maps allow at most 32 entries/)
  // Depth is capped at two: a map inside a map is not a scalar entry anymore.
  await assert.rejects(
    () => renderMarkdown(doc('extra:\n  map:\n    deep:\n      too: far')),
    /extra values must be scalars, lists of scalars or flat maps of scalars/,
  )
  await assert.rejects(() => renderMarkdown(doc('extra:\n  gone: null')), /extra values must be scalars/)
  await assert.rejects(() => renderMarkdown(doc('extra:\n  list:\n    - {a: 1}')), /extra values must be scalars/)
  const oversized = `extra:\n  blob: "${'x'.repeat(16400)}"`
  await assert.rejects(() => renderMarkdown(doc(oversized)), /extra must not exceed 16 KiB/)
})

test('lenient rendering drops malformed extra and related instead of throwing', async () => {
  // The build path (buildSite) and the Read API replay revisions stored before
  // the extra/related rules existed — a value that was valid then must never
  // fail a future release, only be dropped with a warning.
  const doc = `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\nextra: not a map\nrelated: see-also\n---\nBody.`
  await assert.rejects(() => renderMarkdown(doc), /extra must be a map of custom fields/, 'the write path stays strict')
  const result = await renderMarkdown(doc, { lenient: true })
  assert.ok(!('extra' in result.meta))
  assert.ok(!('related_slugs' in result.meta))
  assert.deepEqual(
    result.warnings.map((warning) => warning.split(':')[0]),
    ['frontmatter extra dropped', 'frontmatter related dropped'],
  )
  assert.match(result.html, /Body\./, 'the document still renders')

  // Lenient only forgives the additive keys — a broken document stays broken.
  await assert.rejects(
    () => renderMarkdown(`---\nkind: post\nlocale: de\n---\nBody.`, { lenient: true }),
    /title is required/,
  )
  // And a valid document yields no warnings in either mode.
  const clean = await renderMarkdown(`---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n---\nBody.`, {
    lenient: true,
  })
  assert.deepEqual(clean.warnings, [])
})

test('related frontmatter is validated and stored as related_slugs', async () => {
  const doc = (fields) => `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n${fields}\n---\nBody.`
  const result = await renderMarkdown(doc('related: [first-post, second-post]'))
  assert.deepEqual(result.meta.related_slugs, ['first-post', 'second-post'])
  assert.ok(!('related' in result.meta), 'the authored key must not shadow the derived related projection')

  await assert.rejects(() => renderMarkdown(doc('related: not-a-list')), /related must be a list of slugs/)
  await assert.rejects(
    () => renderMarkdown(doc('related: [Not A Slug]')),
    /related must contain lowercase letters, numbers and hyphens/,
  )
  const tooMany = `related: [${Array.from({ length: 9 }, (_, i) => `post-${i}`).join(', ')}]`
  await assert.rejects(() => renderMarkdown(doc(tooMany)), /related allows at most 8 references/)
  await assert.rejects(() => renderMarkdown(doc('related: [a, a]')), /related must not contain duplicates/)
  await assert.rejects(() => renderMarkdown(doc('related: [t]')), /related must not reference the document itself/)
})
