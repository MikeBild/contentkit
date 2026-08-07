import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * What this product actually enforces of `cockpit-ui`, held honest.
 *
 * `contract/COCKPIT-UI.md` is byte-identical across the family and therefore
 * cannot name a test: the two products are at different stages and a shared file
 * that claimed one product's coverage for the other would be false in one of them.
 * So the rules carry IDs and each product maps them locally.
 *
 * The rule that matters here is the last one: **an empty `enforced_by` requires a
 * `why`.** "Not enforced" must be said, not omitted. An earlier version of
 * UI-UX.md credited two files with a rule neither of them asserted, and that is
 * the failure this file exists to make impossible — a style guide that is wrong
 * about itself is worse than none.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))

const doc = readFileSync(join(root, 'contract', 'COCKPIT-UI.md'), 'utf8')
const map = JSON.parse(readFileSync(join(root, 'contract', 'conformance.cockpit-ui.json'), 'utf8'))

/** The rule IDs the contract declares, in document order. */
const declared = [...new Set([...doc.matchAll(/\*\*(CUI-[A-Z0-9]+-\d+)\*\*/g)].map((match) => match[1]))]

describe('cockpit-ui conformance', () => {
  test('the map names the contract it maps', () => {
    assert.equal(map.contract, doc.match(/^Contract:\s*(.+)$/m)?.[1].trim())
  })

  test('every rule in the contract has an entry, and every entry names a rule', () => {
    const mapped = Object.keys(map.rules)
    const missing = declared.filter((id) => !mapped.includes(id))
    const extra = mapped.filter((id) => !declared.includes(id))
    assert.deepEqual(
      missing,
      [],
      `contract/conformance.cockpit-ui.json says nothing about ${missing.join(', ')}.\n` +
        'A rule with no entry is a rule nobody decided about. Add it, with an empty\n' +
        '`enforced_by` and a `why` if nothing holds it yet.',
    )
    assert.deepEqual(extra, [], `the map claims rules the contract does not declare: ${extra.join(', ')}`)
  })

  test('every test named as enforcement exists on disk', () => {
    for (const [id, entry] of Object.entries(map.rules)) {
      for (const path of entry.enforced_by) {
        assert.ok(existsSync(join(root, path)), `${id} names \`${path}\`, which does not exist`)
      }
    }
  })

  test('a rule marked not-applicable says what would make it apply', () => {
    // Three states, not two. A rule can be enforced, unenforced, or NOT
    // APPLICABLE — and counting the third with the second made the coverage
    // number lie in the pessimistic direction.
    //
    // `trigger` is what stops this being an escape hatch. Without it the state
    // is a shrug; with it there is a sentence somebody meets on the day it stops
    // being true. A rule that silently became applicable is worse than one
    // openly unenforced, because nobody is looking for it.
    for (const [id, entry] of Object.entries(map.rules)) {
      if (!entry.not_applicable) continue
      assert.equal(
        entry.enforced_by.length,
        0,
        `${id} is marked not-applicable AND names enforcement. Pick one: either the rule bites here, or it does not.`,
      )
      assert.ok(
        typeof entry.trigger === 'string' && entry.trigger.trim().length > 20,
        `${id} is parked as not-applicable with no trigger. Say what would make it apply — ` +
          'without that sentence this is an exemption nobody will ever revisit.',
      )
    }
  })

  test('a rule nothing enforces says why, in words', () => {
    for (const [id, entry] of Object.entries(map.rules)) {
      if (entry.enforced_by.length > 0) continue
      assert.ok(
        typeof entry.why === 'string' && entry.why.trim().length > 20,
        `${id} is enforced by nothing and gives no reason.\n` +
          'Silence reads as coverage. Say what is missing and why — that sentence is\n' +
          'what turns an unenforced rule into a piece of work somebody can pick up.',
      )
    }
  })

  test('coverage is reported rather than implied', (t) => {
    const total = declared.length
    const held = declared.filter((id) => map.rules[id].enforced_by.length > 0).length
    const parked = declared.filter((id) => map.rules[id].not_applicable).length
    const open = declared.length - held - parked
    t.diagnostic(`cockpit-ui: ${held} of ${total} enforced · ${parked} not applicable · ${open} open in this product`)
    // Deliberately not a threshold. The number is the point; a bar would invite
    // meeting it with a test that asserts nothing.
    assert.ok(total > 0)
  })
})
