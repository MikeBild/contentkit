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
