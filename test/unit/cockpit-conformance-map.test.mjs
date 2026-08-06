import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * What this product actually enforces of `cockpit-ui-v1`, held honest.
 *
 * `contract/COCKPIT-UI-V1.md` is byte-identical across the family and therefore
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

const doc = readFileSync(join(root, 'contract', 'COCKPIT-UI-V1.md'), 'utf8')
const map = JSON.parse(readFileSync(join(root, 'contract', 'conformance.cockpit-ui-v1.json'), 'utf8'))

/** The rule IDs the contract declares, in document order. */
const declared = [...new Set([...doc.matchAll(/\*\*(CUI-[A-Z0-9]+-\d+)\*\*/g)].map((match) => match[1]))]

describe('cockpit-ui-v1 conformance', () => {
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
      `contract/conformance.cockpit-ui-v1.json says nothing about ${missing.join(', ')}.\n` +
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
    t.diagnostic(`cockpit-ui-v1: ${held} of ${total} rules enforced in this product`)
    // Deliberately not a threshold. The number is the point; a bar would invite
    // meeting it with a test that asserts nothing.
    assert.ok(total > 0)
  })
})
