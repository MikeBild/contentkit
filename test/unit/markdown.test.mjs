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
