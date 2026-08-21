/**
 * The one question no rule in scripts/konvention-check.mjs used to ask: whose
 * console answered?
 *
 * In CodeKit, WorkKit's console answered on the harness port and the run
 * produced eight violations in 156 s about a surface that was never CodeKit — a
 * complete, convincing, wrong report. The family is exposed to this by design:
 * the convention makes the DOM anchors of all six consoles identical, so a
 * sibling satisfies every precondition a run would otherwise trip over. As a
 * mandatory stage that report blocks, and the natural answer to a blocking stage
 * reporting inexplicable breaches is to silence it.
 *
 * The meta tag itself is the easy half — a missing one is loud. What rots
 * quietly is the SHAPE of the assertion: CodeKit's first version held the
 * expected value as a literal while a contract test imported it, so renaming the
 * value made the check say "foreign document" about its own console. So this
 * file asserts what the tag cannot assert about itself: one definition site,
 * read rather than typed and belonging to this package; the missing-attribute
 * branch pointing at THIS repository; the identity not being a rule the run has
 * to be able to find broken; and the question being asked before the browser
 * starts.
 *
 * The built document's half is in test/contract/cockpit-bundle.test.mjs.
 */
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/** The definition site, named here the same way the checker names it. */
const IDENTITY_SOURCE = join('apps', 'cockpit', 'index.html')

const shell = readFileSync(join(root, IDENTITY_SOURCE), 'utf8')
const checker = readFileSync(join(root, 'scripts', 'konvention-check.mjs'), 'utf8')
/** The checker without its prose, so a sentence in a comment cannot satisfy a test. */
const code = checker.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')

describe('the run knows whose console it measured', () => {
  test('the shell declares the product, once, in the one place it is written down', () => {
    const markers = [...shell.matchAll(/<meta[^>]+name="cockpit-product"[^>]+content="([^"]+)"/g)]
    assert.equal(markers.length, 1, `${IDENTITY_SOURCE} declares the identity exactly once`)

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    assert.equal(
      markers[0][1].toLowerCase(),
      pkg.name.toLowerCase(),
      'the marker exists to say which product this is, so a marker that could drift away from the package name ' +
        'would be worse than none',
    )
  })

  test('the checker holds the derived value against the package it runs in', () => {
    // Deriving alone is not enough: a sibling's index.html copied into this repo
    // makes the expected value and the delivered bundle agree, and the run then
    // certifies `conform: true` next to a foreign product name
    // (LOCAL-CK-ZERTIFIKAT-NENNT-FREMDES-PRODUKT). The unit test above catches
    // that in the tree; this catches it where the certificate is issued.
    assert.ok(
      code.includes("JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))"),
      'the checker reads the repository name rather than trusting the marker alone',
    )
    // Read where it is used, not at import time: on the top level a manifest
    // without a `name` ended the run in an uncaught TypeError — exit 1 with no
    // report at all, because the throw landed before the try block that turns a
    // failure into an unmeasured stand (LOCAL-CK-KONVENTION-CHECK-OHNE-BERICHT).
    assert.match(
      code,
      /function repositoryName\(\)[\s\S]*?throw new Error\(/,
      'a package.json without a name is refused in a sentence, not by a TypeError on the top level',
    )
    const start = code.indexOf('function assertStandIdentity(html, origin)')
    const body = code.slice(start, code.indexOf('\n}\n', start))
    assert.ok(
      body.includes('repositoryName()'),
      'the identity assertion compares the derived value with the repository it belongs to',
    )
  })

  test('the checker derives the expected value instead of typing it out', () => {
    // Derived: it comes out of the file that produces the document.
    assert.ok(
      code.includes("const IDENTITY_SOURCE = 'apps/cockpit/index.html'"),
      'the checker names one definition site',
    )
    assert.ok(
      code.includes("markerIn(readFileSync(join(root, IDENTITY_SOURCE), 'utf8'))"),
      'the checker READS the definition site rather than repeating what it says',
    )

    // And nowhere spelled out inside the assertion itself. Its BODY is checked
    // and not the whole file: "ContentKit" stands legitimately in rule 11, which
    // is §6's wordmark and title rule — and that is exactly why the identity
    // assertion must not use it. An identity that is also a checked rule turns
    // every real §6 breach into "that is not even ContentKit" and measures
    // nothing afterwards.
    const marker = /<meta[^>]+name="cockpit-product"[^>]+content="([^"]+)"/.exec(shell)?.[1]
    assert.ok(marker, `${IDENTITY_SOURCE} carries the marker`)
    const start = code.indexOf('function assertStandIdentity(html, origin)')
    assert.ok(start > 0, 'the identity assertion is findable')
    const body = code.slice(start, code.indexOf('\n}\n', start))
    assert.equal(
      body.includes(`'${marker}'`) || body.includes(`"${marker}"`),
      false,
      `the identity assertion spells "${marker}" out. Rename the value and the two sides drift apart silently — ` +
        'the defect CodeKit named in its own first version.',
    )
    assert.equal(body.includes('<title>'), true, 'the title is only quoted back in the message, never compared')
    assert.equal(/wordmark/i.test(body), false, 'the wordmark is a rule this run must be able to find broken')
    assert.equal(/rendered ===|nameVisible/.test(body), false, 'the identity is not read off a checked rule')
  })

  test('a renamed attribute is a finding about this repository, not about the responder', () => {
    // The direction that is easy to get backwards, and expensive when it is:
    // "the expected value can no longer be derived" is true, and "that is a
    // foreign console" is a guess about somebody else's machine.
    assert.ok(
      code.includes(`no longer carries <meta name="\${IDENTITY_META}" content="…">`),
      'the missing-attribute branch says the definition site lost the tag',
    )
    assert.ok(code.includes('finding about THIS repository'), 'the missing-attribute branch says whose problem it is')
    // Three branches, not two: no tag on the far side, and a tag naming someone
    // else, are different accidents with different next steps.
    assert.ok(code.includes('carries no <meta name="${IDENTITY_META}">'), 'the responder-without-a-marker branch')
    assert.ok(code.includes('it is ${delivered}'), 'the responder-names-another-product branch')
  })

  test('the question is asked before the browser starts', () => {
    const asked = code.indexOf('assertStandIdentity(shellDocument, fixture.origin)')
    const browser = code.indexOf('chromium.launch(')
    assert.ok(asked > 0, 'the assertion is wired into the run')
    assert.ok(browser > 0, 'the browser start is findable')
    assert.ok(
      asked < browser,
      'the identity is checked after the browser starts. Everything past that line costs a minute and reads a ' +
        'surface, which is the whole defect: 156 s of measuring somebody else.',
    )
  })

  test('the document it judges is the one the fixture served, not the one on disk', () => {
    // Reading assets/cockpit/index.html here instead would answer a different
    // question than "what will the browser be shown".
    assert.ok(code.includes('await fetch(`${fixture.origin}/cockpit/`)'), 'the shell is fetched from the stand')
  })

  test('the definition site is a hashed build input', () => {
    // ContentKit's stand serves the BUILT bundle, so the identity has to survive
    // the build — and a bundle built before this file changed must not be
    // certifiable. scripts/cockpit-build-stamp.mjs walks apps/cockpit, so this
    // holds today; it is asserted because the day somebody excludes `*.html`
    // from the walk, nothing else would say so.
    const stamp = readFileSync(join(root, 'scripts', 'cockpit-build-stamp.mjs'), 'utf8')
    assert.equal(/\.html/.test(stamp.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')), false, 'the walk excludes no HTML')
  })
})
