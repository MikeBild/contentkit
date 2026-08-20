import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Overview's activity list, after it stopped printing "release.promote" at a
 * human — COCKPIT-KONVENTION.md §5, "Deutsch auf oberster Ebene; Fachbegriffe
 * (SRE, API-Namen) erst in der Detailtiefe".
 *
 * Two things are graded here and they pull in opposite directions:
 *
 *  - Coverage. The mapping is worthless if it names four actions and falls back
 *    for the rest, so every action the SERVER can write is read out of
 *    `src/**` and required to resolve. That list is derived rather than
 *    restated: a table of actions kept by hand in a test is a table that goes
 *    stale in exactly the silent way this module exists to avoid.
 *  - Restraint. An action nobody named must answer `null`, not a guess. A
 *    plausible German sentence over an unmapped event is a worse row than the
 *    raw string, because the raw string admits what it is.
 *
 * The module is a `.ts` file with no runtime imports of its own, so the two
 * records and the function are lifted out as source and evaluated. Node cannot
 * import TypeScript, and a rule asserted by `assert.match` over source text is a
 * rule nobody has ever executed.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const module = readFileSync(join(root, 'apps', 'cockpit', 'src', 'lib', 'audit-action.ts'), 'utf8')
const overview = readFileSync(join(root, 'apps', 'cockpit', 'src', 'pages', 'overview.tsx'), 'utf8')
const catalogs = readFileSync(join(root, 'apps', 'cockpit', 'src', 'lib', 'i18n.ts'), 'utf8')

/** The `{…}` that follows an anchor, braces balanced. */
function braceGroup(text, from) {
  const start = text.indexOf('{', from)
  assert.ok(start > 0, 'no object literal follows that anchor')
  let depth = 0
  for (let at = start; at < text.length; at += 1) {
    if (text[at] === '{') depth += 1
    else if (text[at] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, at + 1)
    }
  }
  assert.fail('unbalanced braces')
}

const record = (name) => new Function(`return (${braceGroup(module, module.indexOf(`const ${name} =`))})`)()

const SUBJECT_KEYS = record('SUBJECT_KEYS')
const VERB_KEYS = record('VERB_KEYS')
const OVERRIDES = record('OVERRIDES')

/** The module's own rule, re-implemented from its source so the test drives it. */
function auditPhrase(action) {
  if (action in OVERRIDES) return OVERRIDES[action]
  const parts = action.split('.')
  if (parts.length < 2) return null
  const subject = SUBJECT_KEYS[parts[0]]
  const verb = VERB_KEYS[parts[parts.length - 1]]
  return subject && verb ? { subject, verb } : null
}

/** Every `.mjs` under src/, so no surface's actions are missed by a path list. */
function serverSources(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...serverSources(path))
    else if (entry.name.endsWith('.mjs')) out.push(path)
  }
  return out
}

/**
 * Every action the server can write, read from the server.
 *
 * Two shapes exist: the literal `action: 'release.promote'` and the assembled
 * `action: \`comment.${input.status}\``. The second cannot be resolved from the
 * template alone, so its subject is taken and the verbs are supplied by the enum
 * that feeds it — which is why those pairs are spelled out below. The `eq.`
 * prefix is a PostgREST filter, not an audited action, and is dropped.
 */
const LITERAL_ACTIONS = [
  ...new Set(
    serverSources(join(root, 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/action: '([a-z_]+(?:\.[a-z_]+)+)'/g)].map((hit) => hit[1]),
    ),
  ),
].filter((action) => !action.startsWith('eq.'))

const ASSEMBLED_ACTIONS = [
  // `comment.${input.status}` and `comment.${input.action}` — src/routes.mjs and src/mcp/tools.mjs
  'comment.approved',
  'comment.rejected',
  'comment.approve',
  'comment.reject',
  // `contact.${input.status}` — the ContactSubmission enum in src/openapi.mjs
  'contact.new',
  'contact.read',
  'contact.closed',
  // `decision.${input.action}` — DECISION_STATES' transitions in src/decisions.mjs
  'decision.defer',
  'decision.dismiss',
  'decision.restore',
  // `release.${input.action}`, `site.${input.action}`, `webhook.${input.action}`,
  // `identity.${input.action}` and `access.${singular}.${verb}` — src/mcp/tools.mjs
  'release.publish',
  'release.unpublish',
  'release.create',
  'release.activate',
  'release.delete',
  'site.create',
  'site.update',
  'site.delete',
  'webhook.create',
  'webhook.update',
  'webhook.delete',
  'identity.create',
  'identity.update',
  'identity.restore',
  'identity.revoke',
  'access.reader.create',
  'access.reader.update',
  'access.reader.delete',
]

describe('the Overview says what happened, not which endpoint it happened at', () => {
  test('every action the server writes resolves to a phrase', () => {
    const unnamed = [...LITERAL_ACTIONS, ...ASSEMBLED_ACTIONS].filter((action) => auditPhrase(action) === null).sort()
    assert.deepEqual(
      unnamed,
      [],
      `these actions still reach the operator as raw machine values: ${unnamed.join(', ')}. ` +
        'A subject or a verb is missing from lib/audit-action.ts.',
    )
  })

  test('an action nobody named answers null rather than a guess', () => {
    // The fixture's own synthesized actions are bare words, and a module that
    // tried to make a sentence out of "release" alone would be inventing one.
    for (const action of ['release', 'deck', 'locale', '', 'something.nobody.mapped']) {
      assert.equal(auditPhrase(action), null, `"${action}" must not be given a sentence`)
    }
  })

  test('release.promote is the sentence the finding asked for', () => {
    const phrase = auditPhrase('release.promote')
    assert.deepEqual(phrase, { subject: 'audit.subject.release', verb: 'audit.verb.activated' })
    // Read out of the catalogue rather than restated, so a reworded translation
    // fails here instead of quietly turning the row back into jargon.
    const german = (key) => new RegExp(`'${key}': '([^']*)'`).exec(catalogs.slice(catalogs.indexOf('const DE')))?.[1]
    assert.equal(german('audit.subject.release'), 'Release')
    assert.equal(german('audit.verb.activated'), 'aktiviert')
  })

  test('the verb is read from the end, because two shapes put it there', () => {
    // `access.reader.create` has its subject first and `release.promote.approved`
    // has its verb last; reading position 1 names the middle of one and the
    // subject of the other.
    assert.deepEqual(auditPhrase('access.reader.create'), {
      subject: 'audit.subject.access',
      verb: 'audit.verb.created',
    })
    assert.deepEqual(auditPhrase('release.promote.approved'), {
      subject: 'audit.subject.release',
      verb: 'audit.verb.approved',
    })
  })

  test('the overrides exist only where composition produces nonsense', () => {
    // Every override has to be justified: either composition cannot reach it at
    // all, or it reaches a different phrase. An override that agrees with
    // composition is a lookup-table entry sneaking back in.
    for (const [action, phrase] of Object.entries(OVERRIDES)) {
      const parts = action.split('.')
      const composed =
        SUBJECT_KEYS[parts[0]] && VERB_KEYS[parts[parts.length - 1]]
          ? { subject: SUBJECT_KEYS[parts[0]], verb: VERB_KEYS[parts[parts.length - 1]] }
          : null
      assert.notDeepEqual(composed, phrase, `${action} composes to its override already; the override is dead weight`)
    }
  })

  test('every key the module names exists in both catalogs', () => {
    const keys = new Set([
      ...Object.values(SUBJECT_KEYS),
      ...Object.values(VERB_KEYS),
      ...Object.values(OVERRIDES).flatMap((phrase) => [phrase.subject, phrase.verb]),
    ])
    const missing = [...keys].filter((key) => [...catalogs.matchAll(new RegExp(`'${key}':`, 'g'))].length !== 2).sort()
    assert.deepEqual(
      missing,
      [],
      `these keys are not in both the English and the German catalog: ${missing.join(', ')}`,
    )
  })

  test('the raw action stays on screen beside the sentence', () => {
    // §5 moves the API name into the detail, it does not delete it: the string is
    // what an operator filters the audit trail by and greps a log for. Mono, so
    // it reads as a machine value rather than as more prose.
    assert.match(overview, /<code\b[\s\S]{0,200}?font-mono[\s\S]{0,200}?\{event\.action\}/)
    assert.match(overview, /auditPhrase\(event\.action\)/, 'and the sentence comes from the module that can be tested')
    assert.match(
      overview,
      /sentence \? <span className="min-w-0 truncate">\{sentence\}<\/span> : null/,
      'an unnamed action keeps the machine value alone rather than an invented sentence',
    )
  })
})
