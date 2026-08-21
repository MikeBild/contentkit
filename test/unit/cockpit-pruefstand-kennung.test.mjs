/**
 * The one question no rule in scripts/konvention-check.mjs used to ask: whose
 * console answered?
 *
 * THE INCIDENT
 *
 * In CodeKit, WorkKit's console answered on the harness port and the run
 * produced eight violations in 156 s about a surface that was never CodeKit. Not
 * a timeout and not a crash — a complete, convincing, wrong report. The family
 * is unusually exposed to this: the convention makes the DOM anchors of all six
 * consoles identical on purpose (`cockpit-wordmark`, `operator-role`, `sidebar`,
 * `page-title`), so a sibling satisfies every precondition a run would otherwise
 * trip over. Since the check became a mandatory stage such a report is blocking,
 * and the natural response to a mandatory stage reporting inexplicable breaches
 * is to silence it. That is how an assurance dies.
 *
 * WHAT THIS FILE HOLDS, AND WHY IT IS NOT THE META TAG
 *
 * The meta tag is the easy half and it would hold itself: a missing one is
 * loud. The half that rots quietly is the SHAPE of the assertion, and CodeKit's
 * first version named its own weakness — the expected value stood as a literal
 * in the script while a contract test imported the same value, so renaming it
 * made the check say "foreign document" about its own console. That is the most
 * expensive message to get wrong, and no test caught it because there was
 * nothing wrong with the meta tag.
 *
 * So this file asserts the four properties the tag cannot assert about itself:
 * one definition site, read rather than typed; the missing-attribute branch
 * pointing at THIS repository rather than at the responder; the identity being
 * something other than a rule the run has to be able to find broken; and the
 * question being asked before the browser starts, because everything after that
 * line costs a minute and reads a surface.
 *
 * The built document's half is in test/contract/cockpit-bundle.test.mjs, where
 * the value is held against the package name.
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
