/**
 * The identity reader, held against the browser it is supposed to agree with.
 *
 * `scripts/konvention-check.mjs` asks one question before it measures anything:
 * whose console answered? Until LOCAL-CK-KENNUNG-LIEST-NICHT-WAS-DER-BROWSER-LIEST
 * it answered that with a regular expression over the served bytes — a second
 * HTML parser standing beside the one whose reading actually matters. The two
 * were measured against each other at a living Chromium over real HTTP, eight
 * marker forms, one document each: they disagreed on FIVE, and on THREE of those
 * the check passed and printed `conform: true` next to a product name the
 * browser had never read.
 *
 * The reader asks the browser now, so none of the forms below is a special case
 * for it — that is exactly the claim this file measures. It lifts the shipped
 * `markerAt` out of the checker rather than re-implementing it, serves each form
 * over real HTTP, and holds the answer against a value written down here. A
 * reader that goes back to reading bytes turns five of these red; a reader that
 * guesses when a document says two things turns two of them red.
 *
 * The names in the fixtures are deliberately neither this product's nor a
 * sibling's: what is measured is which of two markers is read, not which word.
 */
import test, { after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const CHECKER = join(root, 'scripts', 'konvention-check.mjs')

/** The marker the console gives its own document — the real word, not a stand-in. */
const REAL = 'AlphaKit'
/** The word a wrong answer would carry. It is in every fixture that has a decoy. */
const DECOY = 'BetaKit'

/**
 * The shipped reader, made callable.
 *
 * Lifted by text because the checker runs its whole gate on import and cannot be
 * imported from a test. A reader that no longer exists, no longer parses or no
 * longer answers with `{ count, value }` is a red test rather than a skipped one.
 */
function liftReader() {
  const source = readFileSync(CHECKER, 'utf8')
  const attribute = /^const IDENTITY_META = '([^']+)'$/m.exec(source)
  assert.ok(attribute, 'the checker no longer declares IDENTITY_META')
  const start = source.indexOf('async function markerAt(page, url)')
  assert.ok(start > 0, 'the checker no longer defines markerAt(page, url)')
  const end = source.indexOf('\n}\n', start)
  assert.ok(end > start, 'markerAt has no end')
  const body = source.slice(start, end + 2)
  return {
    attribute: attribute[1],
    markerAt: new Function('IDENTITY_META', `${body}\nreturn markerAt`)(attribute[1]),
    /** The identity assertion's own text, for the "no second parser" reading below. */
    assertion: source.slice(
      source.indexOf('async function assertStandIdentity(page, origin)'),
      source.indexOf('\n}\n', source.indexOf('async function assertStandIdentity(page, origin)')),
    ),
  }
}

const { attribute, markerAt, assertion } = liftReader()
const marker = (name) => `<meta name="${attribute}" content="${name}" />`

/**
 * One document per marker form, with what the BROWSER makes of it.
 *
 * Every expectation here was measured, not reasoned about: each is what Chromium
 * reported for that document over real HTTP. The comment on each says which
 * parser rule produces it, so a disagreement is settled against the browser and
 * not against this table.
 */
const FORMS = [
  {
    id: 'the document as it stands',
    head: marker(REAL),
    expect: { count: 1, value: REAL },
  },
  {
    id: 'a marker inside a comment, with a real one below it',
    // Thirty comment lines stand above the real marker in apps/cockpit/index.html.
    // None of them happens to contain an example marker today, and "happens to"
    // was the entire reason this passed.
    head: `<!-- like this: ${marker(DECOY)} -->\n    ${marker(REAL)}`,
    expect: { count: 1, value: REAL },
  },
  {
    id: 'a marker inside a comment and no real one',
    // The form that certified a name no document carried: the byte reader
    // stripped no comments at all.
    head: `<!-- like this: ${marker(DECOY)} -->`,
    expect: { count: 0, value: null },
  },
  {
    id: 'two content= attributes, the decoy first',
    // First attribute wins. A greedy `[^>]+` reads the LAST one, and a counter
    // matching `name="…"` sees a single tag, so both halves were satisfied.
    head: `<meta name="${attribute}" content="${DECOY}" content="${REAL}" />`,
    expect: { count: 1, value: DECOY },
  },
  {
    id: 'a character reference in the name, the decoy first',
    // Character references are decoded in an attribute VALUE, so `cockpit&#45;product`
    // IS the marker to the browser. Two markers, and the first is the decoy.
    head: `<meta name="cockpit&#45;product" content="${DECOY}" />\n    ${marker(REAL)}`,
    expect: { count: 2, value: null },
  },
  {
    id: 'an empty comment opening a decoy, with a real one below',
    // `<!-->` is a complete comment, so the meta after it is live in the DOM.
    head: `<!--><meta name="${attribute}" content="${DECOY}"><!---->\n    ${marker(REAL)}`,
    expect: { count: 2, value: null },
  },
  {
    id: 'a shouted marker name',
    // Attribute names are lowercased by the parser; attribute VALUES are not, and
    // `name="COCKPIT-PRODUCT"` is not this attribute at all.
    head: `<meta NAME="COCKPIT-PRODUCT" content="${DECOY}" />\n    ${marker(REAL)}`,
    expect: { count: 1, value: REAL },
  },
  {
    id: 'an unquoted value ending in a slash',
    // In an unquoted attribute value only whitespace and `>` end the value, so
    // the slash is part of the product name the browser reads.
    head: `<meta name=${attribute} content=${DECOY}/>`,
    expect: { count: 1, value: `${DECOY}/` },
  },
]

const documents = new Map(
  FORMS.map((form, index) => [
    `/${index}`,
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8" />\n    ${form.head}\n    <title>${form.id}</title></head><body>x</body></html>`,
  ]),
)

let server = null
let origin = null
let browser = null
let page = null

before(async () => {
  server = createServer((request, response) => {
    const body = documents.get(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
    response.writeHead(body === undefined ? 404 : 200, {
      'content-type': body === undefined ? 'text/plain' : 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(body ?? 'not found')
  })
  // Ephemeral, so this is runnable while anything else holds a port.
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
})

after(async () => {
  await browser?.close()
  await new Promise((done) => server?.close(done))
})

describe('the identity reader reads what the browser reads', () => {
  for (const [index, form] of FORMS.entries()) {
    test(form.id, async () => {
      const read = await markerAt(page, `${origin}/${index}`)
      assert.deepEqual(
        { count: read.count, value: read.value },
        form.expect,
        `the reader disagrees with the browser on "${form.id}".\n` +
          `  This is the whole class: a reader that parses the bytes itself is a SECOND HTML parser, and the\n` +
          `  one that draws the console is the only one whose answer decides which product was measured.\n` +
          `  Five of the eight forms in this file separated the two the last time the reader was a regex, and\n` +
          `  three of those five ended in "conform: true" beside the wrong name.`,
      )
    })
  }

  test('a document that says two things is refused, never guessed', () => {
    // Two markers is not an answer. Picking the first would be right about the
    // parser and wrong about the run: the checker cannot say whose console it
    // measured, and a guessed name is exactly the outcome the assertion exists
    // to prevent.
    const ambiguous = FORMS.filter((form) => form.expect.count > 1)
    assert.ok(ambiguous.length >= 2, 'no ambiguous form is measured here any more')
    for (const form of ambiguous) {
      assert.equal(form.expect.value, null, `"${form.id}" resolves an ambiguous document to a name`)
    }
  })

  test('the identity assertion keeps no parser of its own', () => {
    // The cheap half, and written down as the cheap half: the table above is the
    // measurement, this is the tripwire that catches the reintroduction before a
    // form nobody listed gets a chance to be the one that slips through.
    const code = assertion.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')
    assert.equal(/RegExp|matchAll|\.exec\(/.test(code), false, 'the identity assertion parses HTML itself again')
    assert.ok(code.includes('markerAt('), 'the identity assertion no longer goes through the browser reader')
  })
})
