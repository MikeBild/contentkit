import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS, AUDIT_TRANSPORTS, auditActor } from '../../src/audit.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const src = join(root, 'src')

// An audit row that violates a check constraint is rejected by the database and
// swallowed by createAudit().record(): the operation still succeeds, the trail
// is simply absent, and the only signal is a warn line nobody reads. That is how
// `transport: 'rest'` reached production on the one destructive HTTP verb. These
// tests are the gate that a `grep` for the literal would have been.
const migration = readFileSync(join(src, 'db/migrations/0012_contentkit_mcp_oauth.sql'), 'utf8')

/** The `check (col in ('a', 'b'))` set a column declares, read out of the DDL. */
function declaredSet(column) {
  const match = migration.match(new RegExp(`${column} text not null check \\(${column} in \\(([^)]*)\\)\\)`))
  assert.ok(match, `ck_audit_events.${column} must declare a closed set`)
  return match[1].split(',').map((entry) => entry.trim().replace(/^'|'$/g, ''))
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'db' ? [] : sourceFiles(full)
    return entry.name.endsWith('.mjs') ? [full] : []
  })
}

/** Every `key: 'literal'` written anywhere under src/, with the file it came from. */
function literalsFor(key) {
  const found = []
  for (const file of sourceFiles(src)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(new RegExp(`\\b${key}:\\s*'([^']*)'`, 'g'))) {
      found.push({ file: file.slice(root.length + 1), value: match[1] })
    }
  }
  return found
}

describe('audit enums', () => {
  test('the sets exported from src/audit.mjs are the sets the migration enforces', () => {
    assert.deepEqual([...AUDIT_ACTOR_TYPES], declaredSet('actor_type'))
    assert.deepEqual([...AUDIT_TRANSPORTS], declaredSet('transport'))
    assert.deepEqual([...AUDIT_RESULTS], declaredSet('result'))
  })

  test('every transport literal in src/ is one the database accepts', () => {
    const literals = literalsFor('transport')
    // `transport:` is an audit-only key, so an empty scan means the scan broke,
    // not that the codebase is clean.
    assert.ok(literals.length >= 10, `expected the audit call sites to be found, got ${literals.length}`)
    const rejected = literals.filter((entry) => !AUDIT_TRANSPORTS.includes(entry.value))
    assert.deepEqual(rejected, [], `transport values the check constraint would reject: ${JSON.stringify(rejected)}`)
  })

  test('every actorType literal in src/ is one the database accepts', () => {
    const rejected = literalsFor('actorType').filter((entry) => !AUDIT_ACTOR_TYPES.includes(entry.value))
    assert.deepEqual(rejected, [], `actorType values the check constraint would reject: ${JSON.stringify(rejected)}`)
  })

  test('auditActor names each credential shape as the database spells it', () => {
    // The Cockpit's session principal is neither an API key nor an OAuth token,
    // and the Audit page's actor column is only readable if that stays true.
    assert.equal(auditActor({ id: 'oauth:1', oauth: true }).actorType, 'oauth')
    assert.equal(auditActor({ id: 'operator:1', via: 'operator_session' }).actorType, 'operator')
    assert.equal(auditActor({ id: 'key-1' }).actorType, 'api_key')
    for (const principal of [{ oauth: true }, { via: 'operator_session' }, {}, null]) {
      assert.ok(AUDIT_ACTOR_TYPES.includes(auditActor(principal).actorType))
    }
  })

  test('every audit action literal matches the shape the action column allows', () => {
    // `action ~ '^[a-z][a-z0-9_.:-]{0,119}$'` — a capitalised or spaced verb is
    // rejected by the same silent path an unknown transport takes.
    const shape = /^[a-z][a-z0-9_.:-]{0,119}$/
    const dotted = literalsFor('action').filter((entry) => entry.value.includes('.'))
    assert.ok(dotted.length >= 10, `expected the audit action literals to be found, got ${dotted.length}`)
    const rejected = dotted.filter((entry) => !shape.test(entry.value))
    assert.deepEqual(rejected, [], `action values the check constraint would reject: ${JSON.stringify(rejected)}`)
  })
})
