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
const auditPage = readFileSync(join(root, 'apps', 'cockpit', 'src', 'pages', 'audit.tsx'), 'utf8')
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
  // `comment.${input.status}` and `comment.${row.status}` — src/routes.mjs and src/mcp/tools.mjs
  'comment.approved',
  'comment.rejected',
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

/**
 * Actions no surface writes any more, and that are still in the trail.
 *
 * The audit record is append-only, so "the server can no longer write it" is not
 * "nobody will ever read it". Until LOCAL-CK-AUDIT-MCP-SCHREIBWEISE the MCP
 * moderation tool audited the requested action while REST audited the resulting
 * status; the writer was fixed, the rows were not — and a mapping that forgot
 * them would turn old rows back into machine strings. They are kept apart from
 * ASSEMBLED_ACTIONS so the filter is not asked to offer a spelling nothing
 * produces.
 */
const LEGACY_ACTIONS = ['comment.approve', 'comment.reject']

describe('the Overview says what happened, not which endpoint it happened at', () => {
  test('every action the server writes resolves to a phrase', () => {
    const unnamed = [...LITERAL_ACTIONS, ...ASSEMBLED_ACTIONS, ...LEGACY_ACTIONS]
      .filter((action) => auditPhrase(action) === null)
      .sort()
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

/**
 * The audit page's own two tables, read out of the page for the same reason the
 * module's are: a rule asserted by reading source text is a rule nobody drives.
 */
function stringList(source, anchor) {
  const from = source.indexOf(anchor)
  assert.ok(from > 0, `${anchor} is not in apps/cockpit/src/pages/audit.tsx any more`)
  const to = source.indexOf('] as const', from)
  assert.ok(to > from, `${anchor} no longer ends in "] as const"`)
  return [...source.slice(from, to).matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((hit) => hit[1])
}

const DECISION_ACTIONS = stringList(auditPage, 'const DECISION_ACTIONS = [')
const ADMIN_ACTIONS = stringList(auditPage, 'const ADMIN_ACTIONS = [')
const AUDIT_ACTION_KEYS = Object.fromEntries(
  [
    ...braceGroup(auditPage, auditPage.indexOf('const AUDIT_ACTION_KEYS =')).matchAll(
      /'([a-z_]+(?:\.[a-z_]+)+)':\s*'([\w.]+)'/g,
    ),
  ].map((hit) => [hit[1], hit[2]]),
)

/**
 * The audit page's filter and its label table, graded the way the Overview's
 * mapping already is.
 *
 * The defect this exists for: the comment over DECISION_ACTIONS claimed the list
 * held "both spellings the moderation routes produce" while it held one, so a
 * comment approved over MCP reached the operator as `comment.approve` — a
 * machine string — and could not be filtered for under "Kommentar freigeben"
 * (LOCAL-CK-AUDIT-MCP-SCHREIBWEISE). lib/audit-action.ts knew both spellings and
 * was graded for it; this table knew neither and was graded by nothing.
 *
 * The list of actions is DERIVED from the server, as above. What is NOT required
 * to be in the filter is spelled out with a reason each, because the filter is a
 * list of DEEDS an operator did and the server also writes decision-subject rows
 * that are events rather than deeds. Every one of them must still resolve
 * through lib/audit-action.ts, so nothing in this class reaches a human as a raw
 * value on either surface.
 */
const NOT_A_DEED = {
  'draft_capture.create': 'a capture arriving is an event, not something an operator decided',
  'promotion_review.request': 'requesting a review opens the decision; it is not the answer to one',
  'contact.new': 'a contact request arriving is an event',
  'comment.delete': 'deleting a comment is administration of the record, not a moderation verdict',
  'contact.delete': 'deleting a contact request is administration of the record, not a verdict',
}

describe('the audit page names every decision the server can write, and can filter for it', () => {
  test('every action the filter offers has a label in both catalogs', () => {
    const offered = [...DECISION_ACTIONS, ...ADMIN_ACTIONS]
    const unnamed = offered.filter((action) => !AUDIT_ACTION_KEYS[action]).sort()
    assert.deepEqual(unnamed, [], `the filter offers these without a label: ${unnamed.join(', ')}`)
    const missing = [...new Set(Object.values(AUDIT_ACTION_KEYS))]
      .filter((key) => [...catalogs.matchAll(new RegExp(`'${key}':`, 'g'))].length !== 2)
      .sort()
    assert.deepEqual(
      missing,
      [],
      `these keys are not in both the English and the German catalog: ${missing.join(', ')}`,
    )
  })

  test('every decision the server writes is offered by the filter, or named as not being one', () => {
    const subjects = new Set(DECISION_ACTIONS.map((action) => action.split('.')[0]))
    const fromServer = [...LITERAL_ACTIONS, ...ASSEMBLED_ACTIONS].filter((action) => subjects.has(action.split('.')[0]))
    const orphans = fromServer.filter((action) => !DECISION_ACTIONS.includes(action) && !(action in NOT_A_DEED)).sort()
    assert.deepEqual(
      orphans,
      [],
      `the server writes these decision rows and the Cockpit's filter cannot ask for them: ${orphans.join(', ')}. ` +
        'Either the filter is missing a deed, or it is not one and belongs in NOT_A_DEED with a reason.',
    )
    // The exception list is not an excuse: what is not a deed still has to read
    // as German somewhere, and that somewhere is the Overview's sentence.
    for (const action of Object.keys(NOT_A_DEED)) {
      assert.ok(auditPhrase(action), `${action} is excused from the filter but reaches the Overview as a raw value`)
    }
  })

  test('one deed is one action string, so the equality filter reaches all of it', () => {
    // The audit endpoint filters `action` with `eq.`, so two spellings of the
    // same deed split the answer in half with nothing on screen saying so.
    // src/mcp/tools.mjs audits the resulting status, exactly as src/routes.mjs
    // does, and the spelling it used before is named but not offered.
    const mcp = readFileSync(join(root, 'src', 'mcp', 'tools.mjs'), 'utf8')
    assert.match(mcp, /action: `comment\.\$\{row\.status\}`/)
    // And no surface writes the requested action instead. Read over every server
    // source, not just the one that had the defect, so a second moderation
    // surface cannot reintroduce the split.
    const requested = serverSources(join(root, 'src'))
      .filter((file) => /action: `comment\.\$\{input\.action\}`/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(root.length + 1))
    assert.deepEqual(
      requested,
      [],
      `these audit a comment by the requested action rather than the resulting status: ${requested.join(', ')}`,
    )
    for (const legacy of LEGACY_ACTIONS) {
      assert.ok(AUDIT_ACTION_KEYS[legacy], `${legacy} is in the append-only trail and has to read as German`)
      assert.ok(!DECISION_ACTIONS.includes(legacy), `${legacy} must not be a second filter entry under the same label`)
    }
    const labels = DECISION_ACTIONS.map((action) => AUDIT_ACTION_KEYS[action])
    assert.equal(new Set(labels).size, labels.length, 'two filter entries share a label; one of them cannot be chosen')
  })
})
