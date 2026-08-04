import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../../src/markdown.mjs'
import { renderFragment } from '../../src/render-fragment.mjs'

/**
 * One malformed directive must not take the whole message with it.
 *
 * The assistant writes composition directives, and it gets them wrong — a
 * `comparison` with one side rather than two is the case a user photographed. Until
 * this, that threw a 422 from inside the directive plugin, `renderFragment` failed,
 * and the console fell back to a client-side draft view that cannot render ANY
 * directive. So one bad block turned every good block in the reply into a grey box
 * reading "not shown", and the reader who asked a question got three of them.
 *
 * The bargain is the one `dropWhenLenient` already strikes for frontmatter, and the
 * argument is stronger here: an assistant reply was never a document. The write path
 * stays strict — an author spelling a composition wrongly is told at once — and the
 * lenient path keeps the directive's children, which are ordinary markdown, and says
 * in a warning which block lost its presentation.
 */
const withDirective = (body) => `---\ntitle: T\nlocale: de\n---\n\nBefore.\n\n${body}\n\nAfter.\n`
const brokenComparison = withDirective(':::comparison{title="X"}\n:::side{label="A"}\n- one\n:::\n:::')

describe('a malformed directive is a 422 to an author and a paragraph to a reader', () => {
  test('the write path still refuses it, because that is where an author can fix it', async () => {
    await assert.rejects(
      () => renderMarkdown(brokenComparison),
      (error) => error.statusCode === 422 && /comparison requires/.test(error.message),
      'strict rendering must keep rejecting a composition that is not one',
    )
  })

  test('the lenient path renders, and keeps everything around the broken block', async () => {
    const rendered = await renderMarkdown(brokenComparison, { lenient: true })
    assert.match(rendered.html, /Before\./, 'text before the block survives')
    assert.match(rendered.html, /After\./, 'and text after it — this is what used to be lost')
  })

  test('and keeps the block’s own content, because its children are ordinary markdown', async () => {
    const rendered = await renderMarkdown(brokenComparison, { lenient: true })
    assert.match(rendered.html, /one/, 'the point of degrading rather than dropping')
    assert.match(rendered.html, /ck-directive-unrendered/, 'and it is marked, so nothing pretends it rendered')
  })

  test('the warning names the directive, so a silent downgrade is not silent', async () => {
    const rendered = await renderMarkdown(brokenComparison, { lenient: true })
    assert.equal(rendered.warnings.length, 1)
    assert.match(rendered.warnings[0], /^comparison directive not rendered: comparison requires/)
  })

  test('renderFragment hands the warning to its caller', async () => {
    const fragment = await renderFragment({ markdown: brokenComparison, locale: 'de' })
    assert.ok(Array.isArray(fragment.warnings), 'the console cannot report what it is not given')
    assert.match(fragment.warnings[0] ?? '', /comparison directive not rendered/)
  })

  test('a well-formed directive in the same message is unaffected', async () => {
    const mixed = withDirective(
      ':::metric{label="Release" value="4.9.0"}\nFine.\n:::\n\n:::comparison{title="X"}\n:::side{label="A"}\n- one\n:::\n:::',
    )
    const rendered = await renderMarkdown(mixed, { lenient: true })
    assert.match(rendered.html, /4\.9\.0/, 'the good block still renders as itself')
    assert.equal(rendered.warnings.length, 1, 'and only the bad one is reported')
  })

  test('a directive that fails after appending a chart leaves no half-built one behind', async () => {
    // The collectors are snapshotted and truncated on failure: a composition that
    // pushes a chart and then fails its own shape check would otherwise leave the
    // chart in the result, and a chart nothing references is drawn from nowhere.
    const rendered = await renderMarkdown(brokenComparison, { lenient: true })
    assert.equal(rendered.charts?.length ?? 0, 0)
  })
})
