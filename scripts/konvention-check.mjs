/* global document, getComputedStyle, window */
/**
 * The family convention, asserted against this repo's Cockpit in a real browser.
 *
 * WHY THIS EXISTS
 *
 * COCKPIT-KONVENTION.md is prose in six repositories. §7 says so itself: the
 * convention "wird nicht technisch erzwungen" and is held by two light
 * mechanisms — a versioned copy per repo, and a contract check that reads the
 * running console. This file is the second mechanism for ContentKit. It does not
 * re-check anything a source test can read; it opens the built console and reads
 * the words an operator reads, because that is the only place a shared label is
 * either kept or quietly lost. A rule that only exists in a document is a rule
 * that drifts.
 *
 * WHAT IT RUNS AGAINST
 *
 * `scripts/cockpit-fixture.mjs` — the built `assets/cockpit` on a local origin,
 * with an API synthesized from `docs/openapi.json`. No database, no backend, no
 * `npm start`; the reasoning for that shape is in that file's header. On top of
 * it this file installs `page.route()` overrides for the one endpoint whose
 * *numbers* have to be coherent rather than merely well-shaped: the decision
 * queue. The fixture synthesizes `counts.open` and `items` independently, so the
 * two disagree by construction — which would turn §8.1's counter rule into a
 * measurement of the fixture instead of the console. Two variants are driven,
 * because §8.7 is a rule with two halves: a gate is open (the banner must be
 * there) and nothing is open (it must not).
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not soften. Red is a legitimate answer here, and an assertion relaxed
 * to make the output green is the one change that makes this file worthless —
 * the more so now that it is a gate stage, because a gate is a standing
 * temptation to argue with the assertion instead of with the console. Every rule
 * below quotes the paragraph it comes from, so a disagreement is settled against
 * COCKPIT-KONVENTION.md rather than against this script.
 *
 * WHY IT IS A GATE STAGE NOW, AND WHY IT WAS NOT
 *
 * Until 20.08.2026 this header said the opposite in this very place: "not wired
 * into `verify`, `test`, `validate:*` or any CI workflow, and must not be. It
 * reports where the console stands against the family convention; the repo's own
 * gates report whether the repo is sound. Mixing the two turns a roadmap into a
 * broken build."
 *
 * That was correct for the state it described, and it is worth keeping the
 * reasoning rather than deleting it. This file landed in fa8e45f BEFORE the
 * console had been brought to the convention, so it was deliberately RED — a
 * backlog measured against COCKPIT-KONVENTION.md, not a verdict about the repo.
 * A red check cannot be a gate: it blocks every commit over the defects it
 * exists to enumerate, and the only way out is to weaken an assertion, which
 * deletes exactly the information this file carries.
 *
 * That state ended on 20.08.2026. LOCAL-CK-TITEL, -WORTMARKE, -APPICON,
 * -ART-UNBEKANNT, -DETAILROUTEN, -FAVICON-BASEPFAD and -KONVENTION-V15 closed
 * the backlog one commit at a time, and the run has reported `conform: true`
 * since. With the last violation the reason not to gate lapsed — and nobody
 * noticed, because a reason that lapses leaves no trace anywhere. It took a
 * sweep across all six products to find it (BEFUND-CHECK-LAEUFT-NIRGENDS): the
 * check ran in no gate, no CI workflow and no hook in any of them. A guarantee
 * that is never asked for is a comment, and a check that has been green for a
 * day while nothing calls it is the largest comment in the repository.
 *
 * So since LOCAL-CK-CHECK-INS-GATE it is asked: the last stage of
 * `npm run verify`, after the fast ones and after `validate:cockpit`, which is
 * what builds the bundle it reads; and a step of the `cockpit-e2e` job in
 * .github/workflows/ci.yml, the one CI job that already has a browser and a
 * fresh build. Both, because `verify` is not what CI runs — putting it only in
 * `verify` would leave AK-CK-G.1's "Prüfweg: CI-Gate" claiming more than is
 * held, which is the same defect one level up.
 *
 * WHAT A GATE STAGE OWES, AND WHAT HAD TO CHANGE FIRST
 *
 * A gate hangs on an exit code, so a check that reports red and returns 0 is
 * worse as a mandatory stage than no stage at all. Three things were measured
 * and, where they did not hold, repaired before this file was allowed to carry
 * one (LOCAL-CK-CHECK-INS-GATE):
 *
 * - Every class of violation exits non-zero. It always did; re-measured against
 *   a broken wordmark, a broken tab title and a favicon pointing nowhere.
 * - A run that could not MEASURE is no longer green. `nichtGeprueft` used to be
 *   printed ABOVE a `conform: true` and an exit code of 0 — the report said "I
 *   did not look here" while the gate read "sound", which is the §12 failure the
 *   list was built to end. An unmeasured place now ends the run red and no
 *   `conform: true` is written while one exists. It is still not counted as a
 *   violation: "unchecked" is its own answer, and a gate has to refuse it just
 *   as firmly as a breach. Two sibling products were carrying the same illness
 *   on the same day.
 * - A crash reports what was already found. Rule 15 is measured before the
 *   fixture starts, so a missing or unusable `assets/cockpit` used to end the
 *   run in a stacktrace and take that finding with it. The stand is now started
 *   inside the same try as the sweep, and a stand that cannot be built is an
 *   unmeasured entry with a sentence, not a stack trace where the report goes.
 *
 * AND THE TRAP THAT IS SPECIFIC TO THIS PRODUCT
 *
 * This check measures the BUILT `assets/cockpit`, not the source (the siblings
 * measure a dev server or `vite preview`). As a mandatory stage that is the
 * likeliest way to be lied to: with a stale bundle it certifies a state that is
 * not the source, in green, at speed. Measured rather than assumed — with
 * `app.name` set to "CONTENTKIT" in the catalogue and no rebuild, the run
 * reported `conform: true` and exit 0 over a §6 breach sitting in the source.
 * So the age of the bundle is now part of the measurement: sources newer than
 * `assets/cockpit/index.html` end the run as unmeasured, red, naming the file.
 *
 * Run it with `npm run konvention:check`; build the console first, or it will
 * tell you to: `npm run cockpit:build`.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { startFixture } from './cockpit-fixture.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * German, because the convention is written about a German-language surface:
 * §5 requires "Deutsch auf oberster Ebene" and every label §6 and §8 fix by name
 * — "Installation", "Entscheidungen", "Administrator", "Liegt schon länger" —
 * is a German string. Checking the English catalogue would check a different
 * contract.
 */
const LOCALE = 'de'

/** Wide and tall enough that no rule below is measured against a folded layout. */
const VIEWPORT = { width: 1280, height: 900 }

/** The site the fixture serves; the console carries it in `?site=`. */
const SITE = 'canary'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

// ─────────────────────────────────────────────────────────────────────────────
// The version of the standard, twice — once as a label, once as a claim.
//
// These look redundant and are not, and getting them confused is how this file
// spent a day reporting against a document that no longer existed.
//
// The LABEL is every line this file prints: "measured against v1.5". Until this
// commit it was a literal in two places at the bottom and it went stale exactly
// the way a literal does — the repo's copy moved on, the report kept announcing
// the old number, green. A verdict that misnames its standard is not a weaker
// verdict, it is a different one. So the label is read out of the copy's header
// line and cannot be forgotten.
//
// But a label read out of the file can never CONTRADICT the file. Leave a v1.3
// copy lying in this repo and the run cheerfully says "measured against v1.3"
// and passes; it cannot notice that it is measuring against a superseded
// agreement, because the two agree by construction. §7 makes the per-repo copy
// the mechanism against drift, and a mechanism that cannot disagree is
// decoration. WikiKit found this in AK-WI-G.1 — an acceptance criterion naming
// "v1.4" in prose would have been satisfied by an outdated copy.
//
// So the CLAIM sits beside it: the version this checker was written against,
// typed out by hand, and asserted against the header (rule 15). Hand-typed on
// purpose — derive it and the assert proves nothing. This file rose from v1.4
// to v1.5 by hand and the places that said "v1.4" were found by grep; that is
// the drift a machine should catch. Construction copied from CodeKit's
// `checkKonventionVersion`, in this file's own idiom — not imported.
// ─────────────────────────────────────────────────────────────────────────────

/** The version this checker was written against. Typed, never derived. */
const KONVENTION_VERSION = '1.5'

const conventionSource = await readFile(join(root, 'COCKPIT-KONVENTION.md'), 'utf8')
const CONVENTION_HEADER = /^Version (\d+\.\d+) · /m.exec(conventionSource)?.[1] ?? null
const CONVENTION = CONVENTION_HEADER
  ? `COCKPIT-KONVENTION.md v${CONVENTION_HEADER}`
  : 'COCKPIT-KONVENTION.md (Kopfzeile ohne lesbare Version)'

// ─────────────────────────────────────────────────────────────────────────────
// The routes, read from the router rather than written down.
//
// Rules 4, 7 and 8 are prohibitions ("nowhere", "no visible button", "no UUID"),
// and a prohibition checked on two pages is not the rule it claims to be. A
// hand-kept list is how a route silently loses its coverage, so the router's own
// table is the source — the same reasoning as scripts/validate-cockpit-browser.mjs.
// ─────────────────────────────────────────────────────────────────────────────

const routerSource = await readFile(join(root, 'apps/cockpit/src/router.tsx'), 'utf8')
const ROUTES = [...routerSource.matchAll(/^\s*\['(\/[^']*)',\s*(\w+)\],?\s*$/gm)].map((entry) => entry[1])
if (ROUTES.length < 16) {
  throw new Error(
    `Read ${ROUTES.length} routes out of apps/cockpit/src/router.tsx; the console has more than that. The table's shape changed and this parser has to change with it.`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// …and checked against the navigation, which is a DIFFERENT list.
//
// The obvious mistake — and a sibling console made it — is to derive the sweep
// from the navigation instead. The navigation is not the console: `/profile`
// here is a full route reached from the account menu and is not in `NAV` at all,
// and ContentKit's navigation is additionally SCOPE-FILTERED, so an entry an
// operator lacks the permission for is not in the DOM to be derived from. Either
// way a page would be structurally invisible to this file while being one click
// away for an operator.
//
// So the router stays the source and the navigation is only asserted AGAINST it:
// every navigation target must be a route. That catches the other direction — a
// menu entry pointing at a path the router does not serve — which the router
// list alone cannot see.
// ─────────────────────────────────────────────────────────────────────────────

const shellSource = await readFile(join(root, 'apps/cockpit/src/app/shell.tsx'), 'utf8')
const NAV_TARGETS = [...shellSource.matchAll(/^\s*to: '(\/[^']*)',\s*$/gm)].map((entry) => entry[1])
if (NAV_TARGETS.length < 16) {
  throw new Error(
    `Read ${NAV_TARGETS.length} navigation targets out of apps/cockpit/src/app/shell.tsx; NAV has more than that. The constant's shape changed and this parser has to change with it.`,
  )
}
const ORPHAN_NAV = [...new Set(NAV_TARGETS)].filter((target) => !ROUTES.includes(target))
if (ORPHAN_NAV.length > 0) {
  throw new Error(
    `NAV in apps/cockpit/src/app/shell.tsx points at ${ORPHAN_NAV.join(', ')}, which router.tsx does not serve.`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The catalogue's own keys, so a key on screen can be recognised as one.
//
// WHY A CHECK LIKE THIS EXISTS AT ALL
//
// A sibling console shipped three buttons in English that already had German
// catalogue entries: its translation helper only descended into a single string
// child, and putting an icon beside the word turned the children into an array
// it walked past. ContentKit cannot fail that way — `t()` takes a key and returns
// a string, so nothing about a component's children can reach it — but it has a
// failure of the same SHAPE, and this run created it deliberately: `translate()`
// degrades a key it cannot resolve to the key itself rather than throwing
// (LOCAL-CK-ART-UNBEKANNT). That is the right trade and a silent one, because a
// dotted identifier in a table cell looks like data.
//
// So the rule is the sibling's rule in this console's spelling: a catalogue key
// visible on screen PROVES the sentence never came out of the catalogue. It needs
// no word list — the catalogue is the list — and it catches every future
// occurrence of the class rather than the one that was noticed.
// ─────────────────────────────────────────────────────────────────────────────

const i18nSource = await readFile(join(root, 'apps/cockpit/src/lib/i18n.ts'), 'utf8')
const englishCatalogue = i18nSource.slice(
  i18nSource.indexOf('const EN = {'),
  i18nSource.indexOf('\nexport type TranslationKey'),
)
const CATALOGUE_KEYS = [...englishCatalogue.matchAll(/^\s{2}'([a-zA-Z][\w.]*)':/gm)].map((entry) => entry[1])
if (CATALOGUE_KEYS.length < 500) {
  throw new Error(
    `Read ${CATALOGUE_KEYS.length} keys out of the EN catalogue in apps/cockpit/src/lib/i18n.ts; it holds far more. The catalogue's shape changed and this parser has to change with it.`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// The detail surfaces — the half of the console this file could not see.
//
// WHY THIS EXISTS
//
// The sweep below used to visit the eighteen ROUTES and stop there, and the
// prohibitions it carries — no visible UUID, no bare "OK", no "Unbekannt" — were
// therefore statements about list pages only. Every surface that shows ONE
// record was structurally out of reach, and in this family that is exactly where
// the breaches were found: a sibling console had a full field table in English
// with an undisguised UUID on a detail page, and another had a whole English
// services page, and both were found by a human looking at a screenshot rather
// than by a check (LOCAL-CK-DETAILROUTEN).
//
// WHY IT IS A TABLE OF CLICKS AND NOT A LIST OF ROUTES
//
// Because ContentKit's console has NO detail routes. `router.tsx` is eighteen
// static paths and not one `$id` among them: a document, a published entry, a
// pattern, a webhook endpoint, an audit event and a contact submission are all
// opened WITHIN their list page, as a dialog, an expanding row or a full-page
// swap that never moves the URL. "Visit the detail route" is not a thing that
// can be done here; opening the surface is. So each entry names the collection,
// the route it lives on, the handles to click in order, and the handle the
// surface itself carries — and the surface has to actually appear, or the entry
// is reported as unmeasured rather than passed over.
//
// Index-based handles (`content-row-0-open`) are used deliberately: every row
// trigger in this console is templated on the row INDEX, not on the record id,
// so `-0-` means "the first row, whatever it is" and survives a fixture whose
// ids change.
// ─────────────────────────────────────────────────────────────────────────────

const DETAILS = [
  { collection: 'Dokument', route: '/content', steps: ['content-row-0-open'], surface: 'content-tabs' },
  {
    collection: 'Dokument › Fassungen',
    route: '/content',
    steps: ['content-row-0-open', 'content-tabs-revisions'],
    surface: 'content-tab-revisions',
  },
  {
    collection: 'Veröffentlichtes',
    route: '/published',
    steps: ['published-row-0-inspect'],
    surface: 'published-dialog',
  },
  {
    collection: 'Komposition › Muster',
    route: '/compositions',
    steps: ['composition-tabs-patterns', 'pattern-0-open'],
    surface: 'pattern-dialog',
  },
  {
    collection: 'Komposition › Leitfaden',
    route: '/compositions',
    steps: ['composition-tabs-guides', 'guide-0-open'],
    surface: 'guide-dialog',
  },
  { collection: 'Webhook › Endpunkt', route: '/webhooks', steps: ['ck-webhook-0-edit'], surface: 'ck-webhook-dialog' },
  {
    collection: 'Webhook › Zustellung',
    route: '/webhooks',
    steps: ['ck-webhook-tabs-deliveries', 'ck-delivery-0-expand'],
    surface: 'ck-delivery-0-detail',
  },
  { collection: 'Audit-Ereignis', route: '/audit', steps: ['ck-audit-row-0-expand'], surface: 'ck-audit-detail-0' },
  { collection: 'Zugang › Leser', route: '/access', steps: ['ck-reader-0-edit'], surface: 'ck-reader-dialog' },
  { collection: 'Zugang › Pfadregel', route: '/access', steps: ['ck-rule-0-edit'], surface: 'ck-rule-dialog' },
  { collection: 'Zugang › Gruppe', route: '/access', steps: ['ck-group-0-edit'], surface: 'ck-group-dialog' },
  {
    collection: 'Zugangsdaten › Identität',
    route: '/credentials',
    steps: ['ck-credentials-tabs-grants', ['ck-grant-0-edit', 'ck-grant-0-restore']],
    surface: 'ck-grant-dialog',
  },
  {
    collection: 'Zugangsdaten › API-Schlüssel',
    route: '/credentials',
    steps: ['ck-api-key-new'],
    surface: 'ck-api-key-dialog',
  },
  {
    collection: 'Moderation › Kontaktanfrage',
    route: '/moderation',
    steps: ['ck-moderation-tabs-contact', 'ck-contact-0-expand'],
    surface: 'ck-contact-0-body',
  },
  {
    collection: 'Website › Abschnitt',
    route: '/settings',
    steps: ['ck-site-sections-identity'],
    surface: 'ck-site-sections',
  },
  { collection: 'Website › Anlegen', route: '/sites', steps: ['site-new'], surface: 'ck-site-wizard' },
  { collection: 'Release › Vorschau', route: '/releases', steps: ['ck-preview-new'], surface: 'ck-preview-dialog' },
]

/**
 * The collections that have NO detail surface, written down rather than omitted.
 *
 * §12 again: an empty row in the table above and a collection that genuinely has
 * nothing to open look identical from the outside, and only one of them is a
 * gap in this file. Naming them costs three lines and turns "we did not check
 * Präsentationen" into "there is nothing there to check".
 */
const WITHOUT_DETAIL = [
  {
    collection: 'Präsentation',
    route: '/decks',
    why: 'one editor and a registry of chips; a deck has no per-record surface',
  },
  { collection: 'Audio', route: '/audio', why: 'the job rows carry a retry and nothing to open' },
  {
    collection: 'Release',
    route: '/releases',
    why: 'a release row has an action menu, not a detail; the promotion review arrives by ?promotion_review= and is driven by scripts/validate-cockpit-browser.mjs',
  },
  {
    collection: 'Website',
    route: '/sites',
    why: 'the row LINKS to /settings, which is a swept route in its own right',
  },
  { collection: 'System', route: '/system', why: 'read-only status rows with nothing below them' },
  { collection: 'Übersicht', route: '/', why: 'every item is a link to another page' },
  { collection: 'Profil', route: '/profile', why: "the page is one record already — the operator's own session" },
  { collection: 'Assistent', route: '/assistant', why: 'a conversation, not a collection' },
]

// ─────────────────────────────────────────────────────────────────────────────
// The decision queue, made coherent.
//
// The shape is DecisionList from docs/openapi.json, so nothing here can describe
// a body the console does not expect. The *contents* answer UEBERGABE.md's
// AK-CK-1.1 — five waiting drafts, two moderation cases, one open promotion —
// with three of them opened more than three days ago so that §8.2's aging
// rubric has something to render, and one past its deadline so §8.1's counter
// has a reason to turn red.
//
// Timestamps are stamped against the run rather than frozen: the queue splits
// "current" from "waiting longer" against `Date.now()`, so a fixed instant would
// drift every position into the aging rubric and the split would stop being
// observable.
// ─────────────────────────────────────────────────────────────────────────────

function decisionId(index) {
  const digits = String(index + 1).padStart(2, '0')
  return `d${digits}00000-0000-4000-8000-00000000${digits}00`
}

function sourceId(index) {
  const digits = String(index + 1).padStart(2, '0')
  return `50${digits}0000-0000-4000-8000-00000000${digits}50`
}

function openQueue(now = Date.now()) {
  const positions = [
    ...Array.from({ length: 5 }, (_, index) => ({
      kind: 'draft_capture',
      openedAgo: 21 * MINUTE,
      dueIn: 3 * DAY,
      title: `Entwurf ${index + 1}: Notiz aus der Erfassung`,
      summary: 'Ein erfasster Entwurf ohne Metadaten. Die Redaktions-Triage entscheidet, was daraus wird.',
      source: { text: `# Entwurf ${index + 1}\n\nEin erfasster Gedanke, der eine Entscheidung braucht.` },
    })),
    {
      kind: 'comment',
      openedAgo: 5 * DAY,
      dueIn: 2 * DAY,
      title: 'Kommentar zu „Erste Schritte" wartet auf Freigabe',
      summary: 'Ein Besucherkommentar, der seit fünf Tagen unmoderiert ist.',
      source: { body: 'Danke für die Anleitung — ein Schritt fehlt aber.' },
    },
    {
      kind: 'contact',
      openedAgo: 4 * DAY,
      dueIn: 1 * DAY,
      title: 'Kontaktanfrage zur Lizenzierung',
      summary: 'Eine Kontaktanfrage, die noch niemand gelesen hat.',
      source: { message: 'Wir möchten ContentKit im Konzern einsetzen.' },
    },
    {
      kind: 'promotion',
      openedAgo: 9 * DAY,
      // Deliberately past: §8.1 turns the counter red on an expired position,
      // and §8.7 counts a missed deadline as an open gate.
      dueIn: -2 * DAY,
      title: 'Preview-Promotion „Redaktions-Review" wartet auf Aktivierung',
      summary: 'Drei geänderte Dokumente warten seit neun Tagen auf die menschliche Freigabe.',
      source: { preview_url: 'https://canary.example.test/previews/editorial-review/' },
    },
  ]

  const items = positions.map((position, index) => ({
    id: decisionId(index),
    site_id: '11111111-1111-4111-8111-111111111111',
    kind: position.kind,
    source_id: sourceId(index),
    source_version: '1',
    state: 'open',
    version: 1,
    opened_at: new Date(now - position.openedAgo).toISOString(),
    due_at: new Date(now + position.dueIn).toISOString(),
    remind_at: null,
    decided_at: null,
    outcome: null,
    reason: '',
    title: position.title,
    summary: position.summary,
    source: position.source,
  }))

  const byKind = {}
  for (const item of items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1

  return {
    items,
    next_cursor: null,
    counts: {
      open: items.length,
      overdue: items.filter((item) => Date.parse(item.due_at) <= now).length,
      by_kind: byKind,
    },
  }
}

/** The other half of §8.7: nothing is waiting, so nothing may be announced. */
const QUIET_QUEUE = { items: [], next_cursor: null, counts: { open: 0, overdue: 0, by_kind: {} } }

/**
 * The kind this build has no name for.
 *
 * Deliberately not one of the five. `docs/openapi.json` fixes the enum at five
 * kinds, so nothing in the fixture can produce a sixth by accident — and a sixth
 * is exactly the thing CK-R1 will ship: a new kind is introduced server-side and
 * every console already in a browser meets it before it meets a new bundle.
 * `spam_review` is a plausible next one rather than nonsense, because the rule is
 * about the console's behaviour towards a newer server, not towards a corrupted
 * response.
 */
const UNNAMED_KIND = 'spam_review'

/**
 * A queue with one position of a kind this build cannot name.
 *
 * Built from the coherent queue rather than beside it, so the assertion below
 * reads "one unknown position among eight known ones" — which is the shape of
 * the failure. The whole page came down over that one position; the point of the
 * rule is that eight of nine still stand.
 */
function queueWithUnnamedKind(now = Date.now()) {
  const base = openQueue(now)
  const stranger = {
    ...base.items[0],
    id: 'd9900000-0000-4000-8000-000000009900',
    source_id: '59900000-0000-4000-8000-000000009950',
    kind: UNNAMED_KIND,
    opened_at: new Date(now - 11 * MINUTE).toISOString(),
    due_at: new Date(now + 3 * DAY).toISOString(),
    title: 'Ein Vorgang einer Art, die diese Fassung nicht kennt',
    summary: 'Der Server hat eine Art gemeldet, für die dieses Bundle kein Wort hat.',
    source: { note: 'Der Server ist neuer als diese Konsole.' },
  }
  const items = [...base.items, stranger]
  const byKind = {}
  for (const item of items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1
  return {
    items,
    next_cursor: null,
    counts: { open: items.length, overdue: base.counts.overdue, by_kind: byKind },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting.
//
// Every violation carries three things, because a report without them is a mood
// rather than a finding: the paragraph of COCKPIT-KONVENTION.md it breaks, the
// place in the console it was read at, and the value that was actually there.
// Nothing throws on the first one — a console that is three rules away from the
// convention has to be able to say so in one run.
// ─────────────────────────────────────────────────────────────────────────────

const violations = []

function violate({ rule, paragraph, where, expected, found }) {
  violations.push({ rule, paragraph, where, expected, found })
}

function check(condition, entry) {
  if (!condition) violate(entry)
  return Boolean(condition)
}

// ─────────────────────────────────────────────────────────────────────────────
// In-page measurement.
//
// Passed to page.evaluate as source, so each function has to be self-contained:
// nothing from this module's scope exists inside the browser.
// ─────────────────────────────────────────────────────────────────────────────

/** The sidebar: account role, group headings, and the entry §8.1 fixes by name. */
const readShell = () => {
  const label = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()

  // Anchors only: `[data-testid^="nav-"]` also matches the group wrappers and
  // their toggles, and the order this rule is about is the order of the links.
  const links = [...document.querySelectorAll('a[data-testid^="nav-"]')]
  const order = links.map((element) => element.getAttribute('data-testid'))

  const decisions = document.querySelector('a[data-testid="nav-decisions"]')
  const group = decisions?.closest('[data-testid^="nav-group-"]') ?? null
  // A collapsible block carries its heading on the toggle, a plain one on the
  // label element; either is a heading, and "ungrouped" means neither exists.
  const groupHeading =
    group?.querySelector('[data-testid$="-toggle"]') ??
    group?.querySelector('[data-slot="sidebar-group-label"]') ??
    null
  const badge = decisions?.closest('[data-slot="sidebar-menu-item"]')?.querySelector('[data-slot="sidebar-menu-badge"]')

  const installation = document.querySelector('[data-testid="nav-group-installation"]')
  const installationHeading =
    installation?.querySelector('[data-testid$="-toggle"]') ??
    installation?.querySelector('[data-slot="sidebar-group-label"]') ??
    null

  // The admin block by structure rather than by name: `data-context` is what the
  // shell itself uses to say "this block is installation-wide", so a block that
  // was renamed is still found and still reported under its new name.
  const adminBlocks = [...document.querySelectorAll('[data-context="installation"][data-testid^="nav-group-"]')].map(
    (element) => ({
      testId: element.getAttribute('data-testid'),
      heading: label(
        element.querySelector('[data-testid$="-toggle"]') ?? element.querySelector('[data-slot="sidebar-group-label"]'),
      ),
    }),
  )

  return {
    role: document.querySelector('[data-testid="operator-role"]')
      ? label(document.querySelector('[data-testid="operator-role"]'))
      : null,
    navOrder: order,
    decisionsPresent: Boolean(decisions),
    decisionsLabel: decisions ? label(decisions) : null,
    decisionsIndex: decisions ? order.indexOf(decisions.getAttribute('data-testid')) : -1,
    overviewIndex: order.indexOf('nav-overview'),
    decisionsGroup: group?.getAttribute('data-testid') ?? null,
    decisionsGroupHeading: groupHeading ? label(groupHeading) : null,
    badgePresent: Boolean(badge),
    badgeText: badge ? label(badge) : null,
    installationHeading: installationHeading ? label(installationHeading) : null,
    installationPresent: Boolean(installation),
    adminBlocks,
  }
}

/**
 * §6's wordmark, read the way an operator sees it.
 *
 * The name is read as RENDERED, not as authored. `textContent` on its own cannot
 * see `text-transform: uppercase`: the DOM keeps saying "ContentKit" while the
 * sidebar draws "CONTENTKIT", and those are different words — the capital in the
 * middle is part of the name, not styling. So the computed transform is applied
 * here and the string handed back is the string on screen. Without this half the
 * cheapest way to break §6 is also the one way to break it invisibly.
 *
 * The name element is found structurally — "the deepest element inside the mark
 * that owns text of its own" — rather than by a handle of its own. §6 fixes ONE
 * handle for the family, `cockpit-wordmark` on the container; inventing a second
 * one here would make this check pass or fail on a detail the convention never
 * settled, and the next product would spell it differently.
 *
 * The icon is reported apart from the name, with its own box and its own
 * position, because "an icon stands beside the name" is a claim about two
 * visible things and about their order.
 */
const readWordmark = () => {
  const shown = (element) => {
    if (!element) return false
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }

  const mark = document.querySelector('[data-testid="cockpit-wordmark"]')
  if (!mark) {
    const header = document.querySelector('[data-slot="sidebar-header"]')
    return { present: false, header: (header?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) }
  }

  const holders = [mark, ...mark.querySelectorAll('*')].filter((element) =>
    [...element.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? '').trim()),
  )
  const named = holders[holders.length - 1] ?? null
  const authored = (named?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const transform = named ? getComputedStyle(named).textTransform : 'none'
  const rendered =
    transform === 'uppercase'
      ? authored.toUpperCase()
      : transform === 'lowercase'
        ? authored.toLowerCase()
        : transform === 'capitalize'
          ? authored.replace(/(^|\s)(\S)/g, (all, lead, first) => `${lead}${first.toUpperCase()}`)
          : authored

  const glyph = mark.querySelector('svg')
  return {
    present: true,
    authored,
    rendered,
    transform,
    nameVisible: shown(named),
    glyphPresent: Boolean(glyph),
    glyphVisible: shown(glyph),
    // Node.DOCUMENT_POSITION_FOLLOWING — the name comes after the icon.
    glyphBeforeName: Boolean(glyph && named && glyph.compareDocumentPosition(named) & 4),
  }
}

/**
 * §8.7 read as a position, not as a presence.
 *
 * "oberhalb aller Kacheln" is a statement about document order, so the page's
 * top-level blocks are collected in order — cards, sections, empty states and
 * alerts that are not nested inside one another — and the banner has to be the
 * first of them. The statistics block's own refusal alert is excluded: a failed
 * stats read is a different fact with its own surface, and counting it as the
 * incident banner would let a broken page pass this rule.
 */
const readOverviewBanner = () => {
  const page = document.querySelector('[data-testid="page"]')
  if (!page) return null
  const selector = '[data-slot="card"], [data-slot="empty"], section, [role="alert"]'
  const all = [...page.querySelectorAll(selector)]
  const blocks = all.filter((element) => !all.some((other) => other !== element && other.contains(element)))
  const describe = (element) =>
    element.getAttribute('data-testid') ??
    `<${element.tagName.toLowerCase()} data-slot="${element.getAttribute('data-slot') ?? ''}">`

  const banners = [...page.querySelectorAll('[role="alert"]')].filter(
    (element) => !element.closest('[data-testid="ck-overview-statistics"]'),
  )
  const banner = banners[0] ?? null
  const links = banner ? [...banner.querySelectorAll('a[href]')] : []

  return {
    blocks: blocks.map(describe),
    bannerCount: banners.length,
    banner: banner ? describe(banner) : null,
    bannerIndex: banner ? blocks.findIndex((block) => block === banner || block.contains(banner)) : -1,
    bannerIsBlock: banner ? blocks.includes(banner) : false,
    bannerText: banner ? (banner.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) : null,
    linkCount: links.length,
    linkHrefs: links.map((link) => link.getAttribute('href') ?? ''),
  }
}

/**
 * §8.6, read as two surfaces rather than as one sentence with a ternary in it.
 *
 * The paragraph asks for a *pair*: "nothing is open" is good news and gets the
 * green tick, "everything is filtered away" is a fact about the filter and gets
 * a smaller, self-explaining line with the way back. The cheapest way to satisfy
 * the words and lose the rule is one empty state that swaps its title, which is
 * why both are read by their own handle, why the colour of the tick is measured
 * rather than assumed, and why the two heights are compared: "kompakter" is a
 * measurement, and a check that only counts elements cannot see it.
 */
const readDecisionEmpty = () => {
  const page = document.querySelector('[data-testid="page"]')
  if (!page) return null
  const label = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const cleared = page.querySelector('[data-testid="decisions-empty-cleared"]')
  const filtered = page.querySelector('[data-testid="decisions-empty-filtered"]')
  const glyph = cleared?.querySelector('[data-slot="empty-icon"]') ?? null
  const colour = glyph ? getComputedStyle(glyph).color : null
  const channels = colour ? (colour.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number) : null

  return {
    clearedPresent: Boolean(cleared),
    clearedText: label(cleared),
    clearedHeight: cleared ? Math.round(cleared.getBoundingClientRect().height) : 0,
    // The tick is decoration beside the word, never instead of it (§2), so both
    // halves are reported and both are asserted.
    tickPresent: Boolean(glyph?.querySelector('svg')),
    tickColour: colour,
    tickIsGreen: Boolean(channels && channels.length === 3 && channels[1] > channels[0] && channels[1] > channels[2]),
    filteredPresent: Boolean(filtered),
    filteredText: label(filtered),
    filteredHeight: filtered ? Math.round(filtered.getBoundingClientRect().height) : 0,
    resetPresent: Boolean(page.querySelector('[data-testid="decisions-reset-filter"]')),
  }
}

/**
 * What a position of an unnameable kind does to the page around it.
 *
 * Read as three separate facts, because "the page is fine" is not one:
 *
 * - the page frame exists at all — the failure this rule is about replaced the
 *   whole route with the router's default error screen, so `[data-testid="page"]`
 *   being absent IS the defect;
 * - the console's own crash screen is not up either. It is a better screen than
 *   the router's, and a rule that only banned the English one would be satisfied
 *   by a German page that still lost the queue;
 * - the queue below it is complete. A console that "survived" by dropping the
 *   position it could not name would pass a mere "did it render" check and would
 *   be lying about the queue (§1) — the count is what makes the difference
 *   between degrading and hiding.
 *
 * The badge is read by handle rather than by scanning for the words, so a second
 * element somewhere else on the page carrying the same phrase cannot make this
 * rule pass for the wrong position.
 */
const readUnnamedKind = () => {
  const label = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const rows = [...document.querySelectorAll('[data-testid^="decision-"]')].filter((element) =>
    /^decision-(current|waiting)-\d+$/.test(element.getAttribute('data-testid') ?? ''),
  )
  const badges = rows.map((row) => row.querySelector('[data-testid$="-kind"]')).filter((badge) => badge !== null)
  const unnamed = badges.filter((badge) => badge.getAttribute('data-kind-unnamed') === 'true')
  return {
    pagePresent: Boolean(document.querySelector('[data-testid="page"]')),
    crashPresent: Boolean(document.querySelector('[data-testid="route-error"]')),
    // The router's own screen has no handle of its own; its words are the handle.
    routerErrorPresent: /Something went wrong!/.test(document.body.textContent ?? ''),
    cards: rows.length,
    badges: badges.length,
    unnamedCount: unnamed.length,
    unnamedText: unnamed.map(label),
    namedTexts: badges.filter((badge) => badge.getAttribute('data-kind-unnamed') !== 'true').map(label),
  }
}

/**
 * §8.2's aging rubric, and §8.1's counter measured against the queue under it.
 *
 * A position is its card and nothing else. Every control inside a card carries a
 * handle derived from the card's own — `decision-current-0-age`,
 * `-actions`, `-triage` — so a prefix selector counts five positions as
 * twenty-five and turns the counter rule into a count of buttons. The exact
 * `decision-<bucket>-<n>` shape is what a row is.
 */
const readQueue = () => {
  const label = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const rows = (bucket) =>
    [...document.querySelectorAll(`[data-testid^="decision-${bucket}-"]`)].filter((element) =>
      new RegExp(`^decision-${bucket}-\\d+$`).test(element.getAttribute('data-testid') ?? ''),
    )
  const current = rows('current')
  const aging = rows('waiting')
  const section = aging[0]?.closest('section') ?? null
  const badge = document
    .querySelector('a[data-testid="nav-decisions"]')
    ?.closest('[data-slot="sidebar-menu-item"]')
    ?.querySelector('[data-slot="sidebar-menu-badge"]')

  return {
    cards: current.length + aging.length,
    current: current.length,
    aging: aging.length,
    agingHeading: section ? label(section.querySelector('h1, h2, h3, h4')) : null,
    badgeText: badge ? label(badge) : null,
  }
}

/**
 * The three prohibitions, read off whatever page is open.
 *
 * §2 ("Unbekannt" is forbidden as a state) is read from visible text *and* from
 * the accessible names, because a state announced only to a screen reader is
 * still the state the console claims.
 *
 * The word is matched standing alone, not as a stem. The German catalogue also
 * carries "Unbekannte Website" and "Unbekannte lesende Person" — fallbacks for a
 * *reference* that did not resolve, which is §2-adjacent but is not one of the
 * six states the paragraph is about. It is also not measurable here: those
 * fallbacks appear against this fixture because `site_ids` is synthesized from
 * the schema and points at sites that do not exist, so a stem match would report
 * the fixture rather than the console. If the console is to be held to them too,
 * that is a second rule with its own fixture, not a wider regular expression.
 *
 * §5's identifier rule and §8.3's button rule are about what is on screen, so
 * both are read from visible text only; a hidden dialog's markup is not a label
 * anybody is shown.
 */
const readProhibitions = (catalogueKeys) => {
  const visible = (element) => {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }

  const text = document.body.innerText ?? ''
  const lines = text.split('\n').map((line) => line.trim())

  const unknownState = lines.filter((line) => /Unbekannt\b/.test(line)).slice(0, 6)
  for (const element of document.querySelectorAll('[aria-label], [title]')) {
    const value = `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''}`
    if (/Unbekannt\b/.test(value)) unknownState.push(value.trim().slice(0, 80))
  }

  /*
   * A cell that reads "undefined" — the shape a missed table lookup takes once
   * `translate()` stops throwing over one.
   *
   * The net under the compiler (lib/i18n.ts) turns a page-killing crash into a
   * visible wrong word, which is the right trade and a WORSE thing to leave
   * unasserted: a crash announces itself, "undefined" in the role column of a
   * table does not. §2 is about the console admitting what it does not know, and
   * a JavaScript sentinel printed at an operator admits nothing. Read as whole
   * words so that prose containing them is not caught.
   */
  const sentinels = lines.filter((line) => /\b(undefined|null|NaN|\[object Object\])\b/.test(line)).slice(0, 6)

  // A key is only a defect when it is ON SCREEN, so the search is over the same
  // rendered lines as everything else here, and `Set` membership is exact: a
  // sentence that merely mentions a dotted word is not a key, and a key is never
  // a substring of a longer word because the line is split on whitespace first.
  const catalogue = new Set(catalogueKeys)
  const rawKeys = [
    ...new Set(lines.flatMap((line) => line.split(/[\s|,;()[\]"']+/)).filter((word) => catalogue.has(word))),
  ].slice(0, 6)

  const identifiers = []
  for (const line of lines) {
    const hit = /[0-9a-f]{8}-[0-9a-f]{4}-/i.exec(line)
    if (hit) identifiers.push(line.slice(Math.max(0, hit.index - 20), hit.index + 60))
  }

  const bareButtons = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
    .filter(visible)
    .map((element) => ({
      testId: element.getAttribute('data-testid'),
      text: (element.value ?? element.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((entry) => /^(ok|submit)$/i.test(entry.text))

  return {
    unknownState: [...new Set(unknownState)].slice(0, 6),
    sentinels: [...new Set(sentinels)].slice(0, 6),
    rawKeys,
    identifiers: [...new Set(identifiers)].slice(0, 6),
    bareButtons: bareButtons.slice(0, 6),
    // A page that threw is not a page with no violations on it, and until this
    // was read the two were indistinguishable here: `readProhibitions` scans the
    // body, an error screen has no "Unbekannt", no bare "OK" and no UUID on it,
    // and every prohibition therefore PASSED on a route that had unmounted. The
    // Zugangsdaten page was in exactly that state for as long as the fixture
    // session held `identity:admin`.
    pagePresent: Boolean(document.querySelector('[data-testid="page"]')),
    crashPresent: Boolean(document.querySelector('[data-testid="route-error"]')),
    routerErrorPresent: /Something went wrong!/.test(text),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Driving the console.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Answers the decision queue with a coherent body.
 *
 * Only the collection GET is taken over. `/v1/sites/{site}/decisions/{decision}`
 * and everything else keeps going to the fixture server, which is what makes
 * this an override of one fact rather than a second, competing API.
 */
async function mockQueue(page, payload) {
  await page.route('**/v1/sites/*/decisions*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() !== 'GET' || !/^\/v1\/sites\/[^/]+\/decisions$/.test(url.pathname)) return route.fallback()
    // The page narrows by state and by kind, and §8.6's second empty state only
    // exists behind a narrowing that matches nothing. A mock that answered the
    // same body to every query could not produce it, so the two parameters the
    // console actually sends are honoured here. `counts` deliberately is not
    // narrowed: rule 9 reads the sidebar counter against the UNFILTERED queue,
    // which is what §8.1 says a counter is.
    const state = url.searchParams.get('state') ?? 'open'
    const kind = url.searchParams.get('kind')
    const items = payload.items.filter((item) => item.state === state && (!kind || item.kind === kind))
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ...payload, items }),
    })
  })
}

/**
 * Everything this run could not measure, and why.
 *
 * §12: a gap has to appear as a gap. Two things used to disappear into a
 * `.catch(() => {})` here — a skeleton that never resolved, and a surface with
 * no fixture behind it — and both came out the far end as a clean report. A
 * route measured while it was still loading is not a route that passed; it is a
 * route nobody looked at, and saying so is the only honest answer.
 */
const notMeasured = []

function unmeasured(where, why) {
  notMeasured.push({ where, why })
}

/** Opens a route and waits for it to have rendered — never on a fixed delay. */
async function open(page, route, origin) {
  const path = route === '/' ? '/cockpit/' : `/cockpit${route}`
  // Not `networkidle`: the assistant page holds a stream open, so "idle" never
  // arrives there and this would hang on one route out of eighteen.
  await page.goto(`${origin}${path}?site=${SITE}`)
  await page.waitForSelector('[data-testid="page"]', { timeout: 15_000 })
  // A skeleton on screen means a query is still in flight, and a label that has
  // not arrived yet is not a label that is wrong. Absence of one is the
  // condition, not a duration.
  //
  // The timeout used to be swallowed whole. It is reported now: if the skeletons
  // are still up after fifteen seconds, every prohibition below was read off a
  // loading state and the answer "no violations on this route" means nothing.
  const settled = await page
    .waitForFunction(() => !document.querySelector('[data-slot="skeleton"]'), null, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  if (!settled) {
    unmeasured(
      `route ${route}`,
      'skeletons were still on screen after 15s, so this route was read while it was still loading',
    )
  }
  await page.evaluate(
    () => new Promise((done) => window.requestAnimationFrame(() => window.requestAnimationFrame(done))),
  )
  return settled
}

/**
 * Opens one detail surface and says whether it is really on screen.
 *
 * Returns `false` — and files an unmeasured entry naming the exact step that
 * failed — rather than throwing or, worse, quietly carrying on. A step that
 * cannot be clicked usually means the fixture produced no rows for that list or
 * the fixture session lacks the scope that reveals the tab, and either way the
 * prohibitions below would then be measured against the list page a second time
 * and reported as a clean detail surface. That is the §12 failure this whole
 * table exists to end, so it is the one thing this function may not do.
 */
async function openDetail(page, entry, origin) {
  await open(page, entry.route, origin)
  for (const step of entry.steps) {
    // A step may name several handles. That is not a fallback for a handle that
    // was renamed — it is for a row that legitimately wears one of two openers
    // depending on its own state: a live identity grant carries `-edit`, a
    // revoked one carries `-restore`, and both open the same dialog. Naming only
    // one would make the sweep's reach depend on which rows the fixture happened
    // to synthesize.
    const handles = Array.isArray(step) ? step : [step]
    let clicked = false
    for (const handle of handles) {
      clicked = await page
        .locator(`[data-testid="${handle}"]`)
        .first()
        .click({ timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
      if (clicked) break
    }
    if (!clicked) {
      unmeasured(
        `${entry.collection} (route ${entry.route})`,
        `none of ${handles.map((handle) => `"${handle}"`).join(' / ')} could be clicked — no row, no tab, or no permission to reveal it, so the detail surface was never reached`,
      )
      return false
    }
    // Radix animates dialogs and accordions in; a click on the next handle in a
    // chain has to land after the previous surface exists.
    await page.waitForTimeout(250)
  }
  const shown = await page
    .waitForSelector(`[data-testid="${entry.surface}"]`, { state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false)
  if (!shown) {
    unmeasured(
      `${entry.collection} (route ${entry.route})`,
      `the handles were clicked but [data-testid="${entry.surface}"] never became visible`,
    )
    return false
  }
  await page
    .waitForFunction(() => !document.querySelector('[data-slot="skeleton"]'), null, { timeout: 10_000 })
    .catch(() =>
      unmeasured(
        `${entry.collection} (route ${entry.route})`,
        'the detail surface was still loading after 10s, so it was read as a skeleton',
      ),
    )
  await page.evaluate(
    () => new Promise((done) => window.requestAnimationFrame(() => window.requestAnimationFrame(done))),
  )
  return true
}

async function contextFor(browser, payload) {
  const context = await browser.newContext({ viewport: VIEWPORT })
  await context.addInitScript((preference) => {
    window.localStorage.setItem('ck-cockpit-locale', preference)
  }, LOCALE)
  const page = await context.newPage()
  await mockQueue(page, payload)
  return { context, page }
}

const started = Date.now()

// ── Rule 15 (§7). The copy in this repo and this checker name the same version.
//
//    The only rule here that needs neither a browser nor a server, and the only
//    one about the checker itself, so it is measured first: everything below it
//    is worth reading only if this holds. §7 makes the versioned copy per repo
//    the mechanism against drift — a copy that has moved on while this file
//    still quotes the previous number ends the run with "no violations against
//    v1.4" and reads like a clean bill of health for an agreement that is no
//    longer in force.
if (
  check(CONVENTION_HEADER !== null, {
    rule: 15,
    paragraph: '§7',
    where: 'COCKPIT-KONVENTION.md › header line',
    expected: 'a header line reading "Version x.y · …"',
    found: `the copy in the repository root begins "${conventionSource.split('\n').slice(0, 3).join(' ').trim().slice(0, 80)}"`,
  })
) {
  check(CONVENTION_HEADER === KONVENTION_VERSION, {
    rule: 15,
    paragraph: '§7',
    where: 'COCKPIT-KONVENTION.md › header line',
    expected: `version ${KONVENTION_VERSION}, the one this checker was written against`,
    found: `version ${CONVENTION_HEADER} — one of the two moved without the other; read the diff before touching either number`,
  })
}

/**
 * Whether `assets/cockpit` is older than the sources it was built from.
 *
 * The one precondition that is specific to ContentKit. Every rule below except
 * 15 is read off the BUILT console, so a bundle that predates a source change is
 * a checker measuring a build nobody is shipping — and answering green about it,
 * fast, which is the most convincing way to be wrong. The header records the
 * measurement: a §6 breach written into the catalogue and left unbuilt passed
 * this check without a word.
 *
 * Modification times rather than a content stamp, deliberately. A stamp means
 * scripts/build-cockpit.sh has to write one and every path that produces a
 * bundle has to remember to — a second thing to keep in sync, for a question
 * that has a cheap conservative answer. This one errs towards a rebuild: a file
 * restored to its identical content still counts as newer. That is a minute of
 * `npm run cockpit:build`, against a green verdict about the wrong bytes.
 *
 * `apps/cockpit/node_modules` and `dist` are excluded because they are not
 * sources, and dotted entries because `.vite` is a build cache that is written
 * DURING the build and would make every bundle stale the moment it was made.
 */
async function bundleOlderThanSource() {
  const built = await stat(join(root, 'assets', 'cockpit', 'index.html')).catch(() => null)
  // No bundle at all is a different sentence, and cockpit-fixture.mjs already
  // says it better than a second one here would.
  if (!built) return null

  const app = join(root, 'apps', 'cockpit')
  const skipped = new Set(['node_modules', 'dist'])
  let newest = null
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || skipped.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      const info = await stat(path)
      if (!newest || info.mtimeMs > newest.mtimeMs) newest = { path, mtimeMs: info.mtimeMs }
    }
  }
  await walk(app)

  if (!newest || newest.mtimeMs <= built.mtimeMs) return null
  const minutes = Math.round((newest.mtimeMs - built.mtimeMs) / 60_000)
  return (
    `assets/cockpit/index.html was built at ${new Date(built.mtimeMs).toISOString()}, but ` +
    `${newest.path.slice(root.length + 1)} changed ${minutes} minute(s) later. Every rule but 15 is read off ` +
    `the built console, so this run would report on a bundle that is not the source. Build it: npm run cockpit:build`
  )
}

let fixture = null
let browser = null
/** The stand could not be built or fell over mid-run; reported, never thrown away. */
let standFailure = null

try {
  const stale = await bundleOlderThanSource()
  if (stale) throw new Error(stale)

  fixture = await startFixture()
  browser = await chromium.launch({ headless: true })

  // ───────────────────────────────────────────────────────────────────────────
  // With a gate open: the shell's labels, the banner, the queue and the counter.
  // ───────────────────────────────────────────────────────────────────────────
  const queue = openQueue()
  const { context, page } = await contextFor(browser, queue)

  await open(page, '/', fixture.origin)
  // The counter is a page-level query of its own, so it arrives after the route
  // does. Waiting for it here keeps a slow answer from being reported as a
  // missing badge — and if it never arrives, rule 3 says so below.
  await page.waitForSelector('[data-slot="sidebar-menu-badge"]', { timeout: 10_000 }).catch(() => {})

  const shell = await page.evaluate(readShell)

  // ── Rule 1 (§5, §6). The role in the account block is spelled "Administrator".
  check(shell.role === 'Administrator', {
    rule: 1,
    paragraph: '§5 / §6',
    where: 'Sidebar › account block › [data-testid="operator-role"] (route /)',
    expected: '"Administrator"',
    found: shell.role === null ? 'no role is rendered in the account block at all' : `"${shell.role}"`,
  })

  // ── Rule 2 (§6). The admin block is called "Installation", never anything else.
  if (
    check(shell.installationPresent, {
      rule: 2,
      paragraph: '§6',
      where: 'Sidebar › admin navigation block (route /)',
      expected: 'a block named "Installation"',
      found:
        shell.adminBlocks.length > 0
          ? `installation-wide blocks: ${shell.adminBlocks.map((block) => `${block.testId} "${block.heading}"`).join(', ')}`
          : 'no installation-wide navigation block is rendered',
    })
  ) {
    check(shell.installationHeading === 'Installation', {
      rule: 2,
      paragraph: '§6',
      where: 'Sidebar › [data-testid="nav-group-installation"] › heading (route /)',
      expected: '"Installation"',
      found: `"${shell.installationHeading}"`,
    })
  }

  // ── Rule 3 (§8.1). "Entscheidungen", ungrouped, directly under the overview,
  //    carrying a counter.
  if (
    check(shell.decisionsPresent, {
      rule: 3,
      paragraph: '§8.1',
      where: 'Sidebar › navigation (route /)',
      expected: 'a navigation entry [data-testid="nav-decisions"]',
      found: `entries: ${shell.navOrder.join(', ')}`,
    })
  ) {
    check(shell.decisionsLabel === 'Entscheidungen', {
      rule: 3,
      paragraph: '§8.1',
      where: 'Sidebar › [data-testid="nav-decisions"] (route /)',
      expected: '"Entscheidungen"',
      found: `"${shell.decisionsLabel}"`,
    })
    check(shell.decisionsGroupHeading === null, {
      rule: 3,
      paragraph: '§8.1',
      where: `Sidebar › ${shell.decisionsGroup} › heading (route /)`,
      expected: 'no heading — the entry is ungrouped',
      found: `"${shell.decisionsGroupHeading}"`,
    })
    check(shell.overviewIndex >= 0 && shell.decisionsIndex === shell.overviewIndex + 1, {
      rule: 3,
      paragraph: '§8.1',
      where: 'Sidebar › navigation order (route /)',
      expected: '"Entscheidungen" immediately after the overview entry',
      found: `overview at ${shell.overviewIndex}, Entscheidungen at ${shell.decisionsIndex}; order: ${shell.navOrder.join(', ')}`,
    })
    check(shell.badgePresent && /^\d+$/.test(shell.badgeText ?? ''), {
      rule: 3,
      paragraph: '§8.1',
      where: 'Sidebar › [data-testid="nav-decisions"] › [data-slot="sidebar-menu-badge"] (route /)',
      expected: `a counter badge reading ${queue.counts.open}`,
      found: shell.badgePresent ? `"${shell.badgeText}"` : 'no badge is rendered beside the entry',
    })
  }

  // ── Rule 11 (§6). The console says which product it is.
  //
  //    Three assertions on the sidebar rather than one, because they fail for
  //    three unrelated reasons and a single verdict would hide two of them: a
  //    wrong spelling, a shouted one, and a wordmark with nothing to look at.
  const wordmark = await page.evaluate(readWordmark)
  if (
    check(wordmark.present, {
      rule: 11,
      paragraph: '§6',
      where: 'Sidebar › [data-testid="cockpit-wordmark"] (route /)',
      expected: 'a wordmark naming the product',
      found: `no wordmark in the sidebar header — it reads "${wordmark.header}"`,
    })
  ) {
    // The name, character for character, and on screen while it says it.
    check(wordmark.rendered === 'ContentKit' && wordmark.nameVisible, {
      rule: 11,
      paragraph: '§6',
      where: 'Sidebar › [data-testid="cockpit-wordmark"] › name (route /)',
      expected: '"ContentKit", spelled exactly so',
      found: wordmark.nameVisible
        ? `"${wordmark.rendered}"${wordmark.transform === 'none' ? '' : ` (text-transform: ${wordmark.transform}, authored "${wordmark.authored}")`}`
        : `"${wordmark.rendered}" — but none of it has a visible box`,
    })

    // …and it is neither shouted nor whispered. Kept apart from the comparison
    // above so a transformed name reports the transform rather than a mismatched
    // string, and so the rule survives a future rename it should not care about.
    const letters = wordmark.rendered.replace(/[^A-Za-zÄÖÜäöüß]/g, '')
    check(letters.length > 0 && letters !== letters.toUpperCase() && letters !== letters.toLowerCase(), {
      rule: 11,
      paragraph: '§6',
      where: 'Sidebar › [data-testid="cockpit-wordmark"] › name (route /)',
      expected: 'mixed case — the capital inside the name is part of the name',
      found:
        letters.length === 0
          ? 'the wordmark renders no letters at all'
          : `"${wordmark.rendered}" is written entirely in ${letters === letters.toUpperCase() ? 'capitals' : 'lower case'}${wordmark.transform === 'none' ? '' : `, by text-transform: ${wordmark.transform}`}`,
    })

    // An icon stands beside the name, before it, and can actually be seen.
    check(wordmark.glyphVisible && wordmark.glyphBeforeName, {
      rule: 11,
      paragraph: '§6',
      where: 'Sidebar › [data-testid="cockpit-wordmark"] › icon (route /)',
      expected: 'a visible icon standing before the name',
      found: !wordmark.glyphPresent
        ? 'the wordmark contains no icon at all'
        : !wordmark.glyphVisible
          ? 'the icon is in the markup but has no visible box'
          : 'the icon is drawn after the name rather than before it',
    })
  }

  // ── Rule 11 (§6). The browser tab names the product.
  //
  //    Read off the SERVED document rather than out of apps/cockpit/index.html,
  //    which is the whole reason this rule lives here and not in a unit test: the
  //    file is a template, `transformIndexHtml` plugins rewrite it on the way
  //    through the build, and a router that sets a per-route title would overwrite
  //    it again in the browser. What an operator reads on the tab is the last of
  //    those, and that is what §6 fixes: "<Produktname> Cockpit", exactly.
  //
  //    Compared character for character, and deliberately not case-insensitively —
  //    "Contentkit Cockpit" and "CONTENTKIT COCKPIT" are precisely the two spellings
  //    the paragraph exists to rule out, and a loose comparison would wave both
  //    through.
  const title = await page.evaluate(() => document.title)
  check(title === 'ContentKit Cockpit', {
    rule: 11,
    paragraph: '§6',
    where: 'the served document › <title> (route /)',
    expected: '"ContentKit Cockpit"',
    found: `"${title}"`,
  })

  // ── Rule 11 (§6). The app icon is declared, and the file behind it exists.
  //
  //    Two assertions, and the second is the one that matters. §6: "ein Verweis
  //    ins Leere ist schlimmer als keiner, weil er wie Erfüllung aussieht." This
  //    fixture makes that failure mode concrete — it answers every unmatched path
  //    under /cockpit/ with index.html, so a <link rel="icon"> pointing at a file
  //    nobody built comes back 200 with a web page in it, and a check that only
  //    read the status would be green over a blank tab. Hence the content type:
  //    an icon is bytes, not markup.
  //
  //    And hence the third condition, which cost a screenshot to learn: the
  //    browser has to be able to DECODE those bytes. The first version of this
  //    favicon carried the token names in an XML comment, two hyphens in a row
  //    made the document unparseable, and it still answered 200 with
  //    `image/svg+xml` — status and content type both saying yes over a broken
  //    image in every tab. `Image.decode()` is the only one of the three that
  //    asks the question an operator asks.
  //
  //    The href is resolved against the document's own base rather than pasted
  //    together, because this console is served under /cockpit/ and the base path
  //    is exactly what a favicon reference gets wrong.
  const appIcon = await page.evaluate(() => {
    const link = document.querySelector('link[rel~="icon"]')
    return link
      ? {
          href: new URL(link.getAttribute('href') ?? '', document.baseURI).href,
          // The attribute as WRITTEN, beside the resolved URL. The rule below is
          // about the string in the document, and `new URL()` has already thrown
          // that string away.
          authored: link.getAttribute('href') ?? '',
        }
      : null
  })
  if (
    check(appIcon !== null, {
      rule: 11,
      paragraph: '§6',
      where: 'the served document › <link rel="icon"> (route /)',
      expected: 'the document declares an app icon',
      found: 'no <link rel="icon"> — the tab falls back to a blank sheet',
    })
  ) {
    // ── Rule 11 (§6). The built href is exactly `base` + the source href.
    //
    //    The other half of the same rule; `test/contract/cockpit-bundle.test.mjs`
    //    holds the first, which is that the SOURCE href must not already carry the
    //    base. Together the two catch both ways this has gone wrong in the family
    //    with one construction: doubling the prefix (a sibling built
    //    /cockpit/cockpit/favicon.svg) and accepting a hand-written one in
    //    silence (here — Vite leaves an unresolvable path alone, so the prefixed
    //    spelling builds to the identical string and looks correct while being
    //    uncoupled from `base`).
    //
    //    This half lives here because it needs the BUILT document, which only
    //    exists after `npm run cockpit:build`; the contract test may not depend on
    //    build output that is not in the repository. Nothing is repeated between
    //    them: `base` is read out of vite.config.ts in both places rather than
    //    written down in either.
    const viteConfig = await readFile(join(root, 'apps/cockpit/vite.config.ts'), 'utf8')
    const base = /^\s*base: '([^']+)',/m.exec(viteConfig)?.[1]
    const indexHtml = await readFile(join(root, 'apps/cockpit/index.html'), 'utf8')
    const sourceHref = /<link[^>]+rel="icon"[^>]+href="([^"]+)"/.exec(indexHtml)?.[1]
    if (
      check(Boolean(base) && Boolean(sourceHref), {
        rule: 11,
        paragraph: '§6',
        where: 'apps/cockpit/vite.config.ts › base, apps/cockpit/index.html › <link rel="icon">',
        expected: 'both a declared base and a declared icon href to compare',
        found: `base ${base ? `"${base}"` : 'not found'}, source href ${sourceHref ? `"${sourceHref}"` : 'not found'}`,
      })
    ) {
      //    The arithmetic below only means anything for an absolute source href.
      //    A relative one ("./favicon.svg") is a third failure mode with its own
      //    sentence — Vite leaves it alone, so the built document carries it
      //    verbatim and it resolves against whatever route is open: right on
      //    /cockpit/, dead on every deeper path. Reporting it as "expected
      //    /cockpit./favicon.svg" would be a correct verdict wrapped in a
      //    nonsense instruction. `test/contract/cockpit-bundle.test.mjs` refuses
      //    the relative spelling at the source; this says the same thing about
      //    the served document.
      check(sourceHref.startsWith('/') && appIcon.authored === `${base.replace(/\/$/, '')}${sourceHref}`, {
        rule: 11,
        paragraph: '§6',
        where: 'the served document › <link rel="icon"> › href',
        expected: sourceHref.startsWith('/')
          ? `"${base.replace(/\/$/, '')}${sourceHref}" — the base from vite.config.ts, prepended by the build to the source href`
          : 'an href written from the site root, so the build can prepend the base to it — a relative one resolves against the open route and is dead on every path below /cockpit/',
        found: `"${appIcon.authored}" (source "${sourceHref}", base "${base}")`,
      })
    }

    const answer = await fetch(appIcon.href).then(
      async (response) => ({
        status: response.status,
        type: response.headers.get('content-type') ?? '',
        body: (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 120),
      }),
      (error) => ({ status: 0, type: '', body: String(error) }),
    )
    const drawn = await page.evaluate(
      (href) =>
        new Promise((done) => {
          const image = new window.Image()
          image.addEventListener('load', () => done({ ok: image.naturalWidth > 0, width: image.naturalWidth }))
          image.addEventListener('error', () => done({ ok: false, width: 0 }))
          image.src = href
        }),
      appIcon.href,
    )
    check(answer.status === 200 && /^image\//.test(answer.type) && drawn.ok, {
      rule: 11,
      paragraph: '§6',
      where: `the app icon at ${appIcon.href}`,
      expected: '200, an image behind it, and a browser able to draw it',
      found:
        answer.status !== 200
          ? `${answer.status || 'the request failed'} — ${answer.body}`
          : !/^image\//.test(answer.type)
            ? `200 but content-type "${answer.type}" — the file was never built, the server answered with the console itself, and the tab shows nothing: "${answer.body}"`
            : `200 and ${answer.type}, but the browser could not decode it — the tab draws a broken image: "${answer.body}"`,
    })
  }

  // ── Rule 5a (§8.7). A gate is open, so the overview carries the banner —
  //    above every tile, with exactly one link, and that link is the queue.
  const banner = await page.evaluate(readOverviewBanner)
  if (
    check(banner !== null && banner.bannerCount > 0, {
      rule: 5,
      paragraph: '§8.7',
      where: 'Overview (route /) with 8 open decisions, 1 of them past its deadline',
      expected: 'a non-dismissable incident banner above the tiles',
      found: banner === null ? 'the page did not render' : `no banner; top-level blocks: ${banner.blocks.join(' → ')}`,
    })
  ) {
    check(banner.bannerIsBlock && banner.bannerIndex === 0, {
      rule: 5,
      paragraph: '§8.7',
      where: 'Overview (route /) › document order',
      expected: 'the banner is the first block on the page, before every tile',
      found: banner.bannerIsBlock
        ? `banner at position ${banner.bannerIndex + 1} of ${banner.blocks.length}; blocks: ${banner.blocks.join(' → ')}`
        : `the banner is nested inside "${banner.blocks[banner.bannerIndex] ?? 'an unknown block'}" rather than standing above the tiles; blocks: ${banner.blocks.join(' → ')}`,
    })
    check(banner.linkCount === 1 && /\/decisions/.test(banner.linkHrefs[0] ?? ''), {
      rule: 5,
      paragraph: '§8.7',
      where: `Overview (route /) › incident banner (${banner.banner})`,
      expected: 'exactly one link, pointing at the decisions page',
      found: `${banner.linkCount} link(s): ${banner.linkHrefs.join(', ') || 'none'} — banner text: "${banner.bannerText}"`,
    })
  }

  // ── Rules 6 and 9 (§8.2, §8.1), read on the queue itself.
  await open(page, '/decisions', fixture.origin)
  await page.waitForSelector('[data-testid^="decision-"]', { timeout: 10_000 }).catch(() => {})
  const seen = await page.evaluate(readQueue)

  if (
    check(seen.aging > 0, {
      rule: 6,
      paragraph: '§8.2',
      where: 'Decisions (route /decisions) › aging section',
      expected: 'positions older than three days stand in their own section',
      found: `${seen.cards} position(s) rendered, none of them in an aging section, though 3 of the 8 were opened 4–9 days ago`,
    })
  ) {
    check(seen.agingHeading === 'Liegt schon länger', {
      rule: 6,
      paragraph: '§8.2',
      where: 'Decisions (route /decisions) › aging section › heading',
      expected: '"Liegt schon länger"',
      found: seen.agingHeading === null ? 'the section carries no heading at all' : `"${seen.agingHeading}"`,
    })
  }

  check(seen.badgeText !== null && Number(seen.badgeText) === seen.cards, {
    rule: 9,
    paragraph: '§1 / §8.1',
    where: 'Sidebar counter vs. queue (route /decisions)',
    expected: 'the counter equals the number of positions in the queue',
    found:
      seen.badgeText === null
        ? `no counter is rendered, while the queue lists ${seen.cards} position(s)`
        : `counter "${seen.badgeText}", queue ${seen.cards} position(s) (${seen.current} current + ${seen.aging} aging)`,
  })

  // ── Rules 4, 7 and 8 (§2, §8.3, §5) — prohibitions, so every route.
  for (const route of ROUTES) {
    await open(page, route, fixture.origin)
    const found = await page.evaluate(readProhibitions, CATALOGUE_KEYS)

    check(found.pagePresent && !found.crashPresent && !found.routerErrorPresent, {
      rule: 13,
      paragraph: '§4',
      where: `route ${route}`,
      expected: 'the route renders its page — a console that throws has no convention to measure',
      found: found.routerErrorPresent
        ? 'the router\'s own English error screen ("Something went wrong!") is on screen'
        : found.crashPresent
          ? "the console's crash screen is on screen; this route threw while rendering"
          : 'no [data-testid="page"] rendered at all',
    })
    check(found.unknownState.length === 0, {
      rule: 4,
      paragraph: '§2',
      where: `route ${route}`,
      expected:
        '"Unbekannt" appears nowhere — a state is resolved, or it says "nicht ermittelbar seit X" with a reason',
      found: found.unknownState.map((entry) => `"${entry}"`).join(' | '),
    })
    check(found.rawKeys.length === 0, {
      rule: 14,
      paragraph: '§5',
      where: `route ${route}`,
      expected: 'no catalogue key is visible — a key on screen proves the sentence never came out of the catalogue',
      found: found.rawKeys.map((key) => `"${key}"`).join(', '),
    })
    check(found.sentinels.length === 0, {
      rule: 4,
      paragraph: '§2',
      where: `route ${route}`,
      expected: 'no JavaScript sentinel ("undefined", "null", "NaN") is printed at an operator',
      found: found.sentinels.map((line) => `"${line}"`).join(' | '),
    })
    check(found.bareButtons.length === 0, {
      rule: 7,
      paragraph: '§8.3',
      where: `route ${route}`,
      expected: 'every button names the action it performs',
      found: found.bareButtons.map((entry) => `"${entry.text}" (${entry.testId ?? 'no data-testid'})`).join(', '),
    })
    check(found.identifiers.length === 0, {
      rule: 8,
      paragraph: '§5',
      where: `route ${route}`,
      expected: 'no identifier-shaped text is visible to the operator',
      found: found.identifiers.map((entry) => `…${entry.trim()}…`).join(' | '),
    })
  }

  // ── Rules 4, 7 and 8 again, on the surfaces a list page hides.
  //
  // Same three prohibitions, deliberately not a fourth rule of their own: §2,
  // §8.3 and §5 do not stop applying because a record was opened, and giving the
  // detail surfaces their own rule numbers would invite the reading that the
  // list pages are held to one standard and the detail views to another.
  // Only `where` changes, so a violation says which surface it was read on.
  for (const entry of DETAILS) {
    if (!(await openDetail(page, entry, fixture.origin))) continue
    const seen = await page.evaluate(readProhibitions, CATALOGUE_KEYS)
    const where = `${entry.collection} › [data-testid="${entry.surface}"] (route ${entry.route})`

    check(seen.pagePresent && !seen.crashPresent && !seen.routerErrorPresent, {
      rule: 13,
      paragraph: '§4',
      where,
      expected: 'opening the record leaves the page standing',
      found: seen.routerErrorPresent
        ? 'the router\'s own English error screen ("Something went wrong!") is on screen'
        : seen.crashPresent
          ? "the console's crash screen is on screen; this surface threw while rendering"
          : 'no [data-testid="page"] rendered at all',
    })
    check(seen.unknownState.length === 0, {
      rule: 4,
      paragraph: '§2',
      where,
      expected:
        '"Unbekannt" appears nowhere — a state is resolved, or it says "nicht ermittelbar seit X" with a reason',
      found: seen.unknownState.map((line) => `"${line}"`).join(' | '),
    })
    check(seen.rawKeys.length === 0, {
      rule: 14,
      paragraph: '§5',
      where,
      expected: 'no catalogue key is visible — a key on screen proves the sentence never came out of the catalogue',
      found: seen.rawKeys.map((key) => `"${key}"`).join(', '),
    })
    check(seen.sentinels.length === 0, {
      rule: 4,
      paragraph: '§2',
      where,
      expected: 'no JavaScript sentinel ("undefined", "null", "NaN") is printed at an operator',
      found: seen.sentinels.map((line) => `"${line}"`).join(' | '),
    })
    check(seen.bareButtons.length === 0, {
      rule: 7,
      paragraph: '§8.3',
      where,
      expected: 'every button names the action it performs',
      found: seen.bareButtons.map((button) => `"${button.text}" (${button.testId ?? 'no data-testid'})`).join(', '),
    })
    check(seen.identifiers.length === 0, {
      rule: 8,
      paragraph: '§5',
      where,
      expected: 'no identifier-shaped text is visible to the operator',
      found: seen.identifiers.map((line) => `…${line.trim()}…`).join(' | '),
    })
  }

  await context.close()

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 5b (§8.7), the other half: nothing is waiting, so nothing is announced.
  //
  // Asserted separately because "no banner yet" and "no banner ever" look
  // identical on one screenshot, and only one of them is the convention.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const quiet = await contextFor(browser, QUIET_QUEUE)
    await open(quiet.page, '/', fixture.origin)
    const calm = await quiet.page.evaluate(readOverviewBanner)
    check(calm !== null && calm.bannerCount === 0, {
      rule: 5,
      paragraph: '§8.7',
      where: 'Overview (route /) with an empty decision queue',
      expected: 'no incident banner — a banner is what an open gate looks like',
      found:
        calm === null ? 'the page did not render' : `${calm.bannerCount} banner(s); first reads "${calm.bannerText}"`,
    })
    // ── Rule 10a (§8.6). Nothing is open, so the queue says so as good news.
    await open(quiet.page, '/decisions', fixture.origin)
    const cleared = await quiet.page.evaluate(readDecisionEmpty)
    if (
      check(cleared !== null && cleared.clearedPresent, {
        rule: 10,
        paragraph: '§8.6',
        where: 'Entscheidungen (route /decisions) with an empty, unfiltered queue',
        expected: 'the "nothing is open" empty state [data-testid="decisions-empty-cleared"]',
        found: cleared === null ? 'the page did not render' : `filtered state present: ${cleared.filteredPresent}`,
      })
    ) {
      check(/Alles erledigt/.test(cleared.clearedText), {
        rule: 10,
        paragraph: '§8.6',
        where: 'Entscheidungen › [data-testid="decisions-empty-cleared"] › title',
        expected: '"Alles erledigt"',
        found: `"${cleared.clearedText}"`,
      })
      check(/Gerade wartet keine Entscheidung auf dich\./.test(cleared.clearedText), {
        rule: 10,
        paragraph: '§8.6',
        where: 'Entscheidungen › [data-testid="decisions-empty-cleared"] › description',
        expected: '"Gerade wartet keine Entscheidung auf dich."',
        found: `"${cleared.clearedText}"`,
      })
      check(cleared.tickPresent && cleared.tickIsGreen, {
        rule: 10,
        paragraph: '§8.6',
        where: 'Entscheidungen › [data-testid="decisions-empty-cleared"] › [data-slot="empty-icon"]',
        expected: 'a green check glyph beside the words',
        found: cleared.tickPresent ? `a glyph coloured ${cleared.tickColour}, which is not green` : 'no glyph at all',
      })
      check(!cleared.filteredPresent, {
        rule: 10,
        paragraph: '§8.6',
        where: 'Entscheidungen (route /decisions) with an empty, unfiltered queue',
        expected: 'only the "nothing is open" state — the filtered message belongs to a filter',
        found: `"${cleared.filteredText}"`,
      })
    }
    await quiet.context.close()

    // ── Rule 10b (§8.6 / §10). The same emptiness behind a filter is a different
    //    surface: compacter, naming the filter, carrying the way back.
    const narrowed = await contextFor(browser, queue)
    await open(narrowed.page, '/decisions', fixture.origin)
    // "Feedback" is the one kind the fixture's eight positions do not contain, so
    // the chip narrows a full queue to nothing without emptying it.
    await narrowed.page.click('[data-testid="decisions-kind-feedback"]').catch(() => {})
    await narrowed.page.waitForSelector('[data-testid="decisions-empty-filtered"]', { timeout: 10_000 }).catch(() => {})
    const filtered = await narrowed.page.evaluate(readDecisionEmpty)
    if (
      check(filtered !== null && filtered.filteredPresent, {
        rule: 10,
        paragraph: '§8.6',
        where: 'Entscheidungen (route /decisions) with the "Feedback" kind chip active',
        expected: 'the filtered empty state [data-testid="decisions-empty-filtered"]',
        found:
          filtered === null
            ? 'the page did not render'
            : filtered.clearedPresent
              ? `the "Alles erledigt" state — a console congratulating itself for what the filter hid: "${filtered.clearedText}"`
              : 'neither empty state is on screen',
      })
    ) {
      check(!filtered.clearedPresent, {
        rule: 10,
        paragraph: '§8.6',
        where: 'Entscheidungen (route /decisions) with the "Feedback" kind chip active',
        expected: 'no "Alles erledigt" — nothing was decided, something was hidden',
        found: `"${filtered.clearedText}"`,
      })
      check(/Feedback/.test(filtered.filteredText), {
        rule: 10,
        paragraph: '§10',
        where: 'Entscheidungen › [data-testid="decisions-empty-filtered"]',
        expected: 'the active filter is named',
        found: `"${filtered.filteredText}"`,
      })
      check(filtered.resetPresent, {
        rule: 10,
        paragraph: '§10',
        where: 'Entscheidungen › [data-testid="decisions-reset-filter"]',
        expected: 'a way back to the unfiltered queue',
        found: 'no reset control beside the filtered message',
      })
      check(cleared !== null && filtered.filteredHeight < cleared.clearedHeight, {
        rule: 10,
        paragraph: '§8.6',
        where: 'Entscheidungen › the two empty states, measured',
        expected: 'the filtered message is the compacter of the two',
        found: `filtered ${filtered.filteredHeight}px vs. cleared ${cleared?.clearedHeight ?? 0}px`,
      })
    }
    await narrowed.context.close()
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Rule 12 (§2 / §4 / §5). A kind this build cannot name costs its own badge
  // and nothing else.
  //
  // This is the assertion for LOCAL-CK-ART-UNBEKANNT, and it is written as a
  // property of the PAGE rather than of the label: the defect it stands against
  // was not a wrong word, it was the Entscheidungen route unmounting into an
  // English, unstyled `Something went wrong!` with no sidebar and no way back —
  // over one position out of nine. §2 asks the console to say what it does not
  // know; leaving is not one of the permitted answers.
  //
  // It matters beyond the label because it is a delivery rule: CK-R1 introduces a
  // new decision kind on the server, and every console already open in a browser
  // meets that kind before it meets a new bundle.
  // ───────────────────────────────────────────────────────────────────────────
  {
    const stranger = await contextFor(browser, queueWithUnnamedKind())
    await open(stranger.page, '/decisions', fixture.origin)
    const seenStranger = await stranger.page.evaluate(readUnnamedKind)

    check(seenStranger.pagePresent && !seenStranger.routerErrorPresent && !seenStranger.crashPresent, {
      rule: 12,
      paragraph: '§2 / §4',
      where: `Entscheidungen (route /decisions) with one position of kind "${UNNAMED_KIND}"`,
      expected: 'the page still stands — an unnameable kind may not unmount the route',
      found: seenStranger.routerErrorPresent
        ? 'the router\'s own English error screen ("Something went wrong!") replaced the page'
        : seenStranger.crashPresent
          ? "the console's crash screen replaced the page; the queue was lost over one position"
          : 'no [data-testid="page"] rendered at all',
    })

    check(seenStranger.cards === 9 && seenStranger.badges === 9, {
      rule: 12,
      paragraph: '§1 / §2',
      where: 'Entscheidungen › the queue below the unnameable position',
      expected: 'all nine positions are listed, each with a kind badge — degrade the row, never drop it',
      found: `${seenStranger.cards} position(s), ${seenStranger.badges} kind badge(s)`,
    })

    if (
      check(seenStranger.unnamedCount === 1, {
        rule: 12,
        paragraph: '§2',
        where: 'Entscheidungen › the badge of the unnameable position',
        expected: 'exactly one badge marks itself as unnameable ([data-kind-unnamed="true"])',
        found: `${seenStranger.unnamedCount} such badge(s); the named ones read ${seenStranger.namedTexts.map((entry) => `"${entry}"`).join(', ')}`,
      })
    ) {
      const text = seenStranger.unnamedText[0]
      check(/Art nicht ermittelbar/.test(text), {
        rule: 12,
        paragraph: '§2 / §5',
        where: 'Entscheidungen › [data-kind-unnamed="true"]',
        expected: '"Art nicht ermittelbar" — German, and honest about what is missing',
        found: `"${text}"`,
      })
      // The machine value stays beside the words for the same reason the overview
      // keeps `release.promote` beside its sentence (CK-F3): it is the string an
      // operator greps the server log for.
      check(text.includes(UNNAMED_KIND), {
        rule: 12,
        paragraph: '§5',
        where: 'Entscheidungen › [data-kind-unnamed="true"]',
        expected: `the raw kind "${UNNAMED_KIND}" stays visible beside the words`,
        found: `"${text}"`,
      })
    }
    await stranger.context.close()
  }
} catch (error) {
  // Caught rather than allowed to escape, because rule 15 has already been
  // measured by this point and an escaping error prints a stack trace where the
  // report belongs — taking every finding collected before it with it. A sibling
  // lost a real finding exactly this way on the same day the check became
  // mandatory here. The run still ends red; it ends red WITH its report.
  standFailure = error
  unmeasured(
    'the test stand',
    `it could not be built or did not survive the run, so nothing below rule 15 was measured — ${error instanceof Error ? error.message : String(error)}`,
  )
} finally {
  await browser?.close().catch(() => {})
  await fixture?.close().catch(() => {})
}

// A page that rendered against a 501 rendered against nothing, and every
// prohibition read off it is a prohibition read off an empty screen. The sibling
// script scripts/validate-cockpit-browser.mjs has asserted this for a while;
// this one used to let it pass in silence, which is the §12 failure in its
// purest form — the check was quietest exactly where it saw least.
for (const entry of [...new Set(fixture?.unanswered ?? [])]) {
  unmeasured('the fixture', `the console asked for ${entry}, so some surface rendered against nothing`)
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)

// ─────────────────────────────────────────────────────────────────────────────
// The gap that is not a gap in the run, but in the file.
//
// `nichtGeprueft` above lists what this run TRIED and failed to reach — a hung
// skeleton, a handle that would not click, a fixture that answered 501. Those
// are accidents of one run and they go away when the cause does. This is a
// different animal: LOCALE is fixed to 'de', so the English catalogue is never
// measured at all, by construction, in every run there has ever been. It cannot
// go in the same list — a permanent gap parked among transient ones is a
// permanent gap nobody ever sees again (LOCAL-CK-EINE-SPRACHE-GEPRUEFT).
//
// It matters more now than it did yesterday: as a mandatory stage this report is
// read as a certificate, and a certificate has to name what it did not examine.
//
// The numbers below are measured, not estimated. Running this same file with
// LOCALE = 'en' on 20.08.2026 produced 5 violations across four rules, all of
// them false: those four compare against German literals, so on the English
// catalogue they do not fall silent, they report the wrong thing. Fixing that —
// teaching the rules which catalogue they are reading — is
// LOCAL-CK-ABRUFSATZ-ROUTENTIEFE's neighbour and is deliberately not done here.
// This sentence only ends the state where the gap did not appear as one.
// ─────────────────────────────────────────────────────────────────────────────

const STRUCTURALLY_NOT_MEASURED = [
  `Katalog en — dieser Lauf misst nur ${LOCALE} (LOCALE ist fest verdrahtet). Gemessen mit LOCALE = 'en': ` +
    '5 Verstöße über vier Regeln — 3 (§8.1, „Entscheidungen" → „Decisions"), 6 (§8.2, „Liegt schon länger" → ' +
    '„Waiting longer"), 10 (§8.6, beide Sätze des geleerten Zustands) und 12 (§2/§5, „Art nicht ermittelbar" → ' +
    '„Kind not determinable"). Diese vier vergleichen gegen deutsche Literale und schlagen auf en falsch an — ' +
    'sie schweigen nicht, sie melden Falsches. Die übrigen elf Regeln blieben dabei grün, sind auf en aber ' +
    'ebenso ungemessen wie diese vier. Das ist eine dauerhafte strukturelle Lücke, kein gescheiterter ' +
    'Messversuch, und steht deshalb nicht in nichtGeprueft.',
]

// Standing, in both outcomes, above the run's own gaps and above the verdict —
// for the same reason `nichtGeprueft` is printed there: a certificate has to
// carry what it did not look at where the eye lands, not only in its JSON.
console.error(`ℹ nicht gemessen — ${STRUCTURALLY_NOT_MEASURED.length} dauerhafte Lücke(n) dieses Prüfskripts:`)
for (const entry of STRUCTURALLY_NOT_MEASURED) console.error(`    ${entry}`)
console.error('')

// Printed before the verdict and in both outcomes. A gap reported underneath a
// green "conform: true" is a gap nobody reads; §12 wants it where the eye lands
// first, and the JSON below carries it too so a machine sees the same thing.
if (notMeasured.length > 0) {
  console.error(`⚠ nicht geprüft — ${notMeasured.length} Stelle(n), die dieser Lauf NICHT gemessen hat:`)
  for (const entry of notMeasured) console.error(`    ${entry.where}: ${entry.why}`)
  console.error('  Diese Stellen sind weder konform noch nicht-konform. Sie sind ungeprüft.\n')
}

// A run that could not look is not a run that found nothing. Both endings are
// red and they are kept apart in the wording, because "the console breaches §6"
// and "this run never saw the console" call for opposite next steps: fix the
// console, or fix the stand and run again.
if (violations.length > 0 || notMeasured.length > 0) {
  for (const entry of violations) {
    console.error(`✗ Regel ${entry.rule} · ${entry.paragraph} · ${entry.where}`)
    console.error(`    erwartet: ${entry.expected}`)
    console.error(`    ist:      ${entry.found}`)
  }
  if (violations.length > 0) {
    console.error(`\nKonvention-Check failed: ${violations.length} violation(s) against ${CONVENTION} in ${seconds}s.`)
    console.error('Fix the console — never the assertion. Every rule quotes the paragraph it comes from.')
  }
  if (notMeasured.length > 0) {
    console.error(
      `\nKonvention-Check inconclusive: ${notMeasured.length} place(s) went unmeasured against ${CONVENTION} in ${seconds}s.`,
    )
    console.error(
      standFailure
        ? 'The test stand never carried a measurement; nothing below rule 15 was looked at. Repair the stand and run again — this is not a verdict about the console.'
        : 'A gate cannot pass on "unchecked". Repair what could not be reached and run again — this is not a verdict about the console.',
    )
  }
  process.exitCode = 1
} else {
  process.stdout.write(
    `${JSON.stringify(
      {
        conform: true,
        convention: CONVENTION,
        seconds: Number(seconds),
        locale: LOCALE,
        nichtGemessen: STRUCTURALLY_NOT_MEASURED,
        routes: ROUTES.length,
        detailflaechen: DETAILS.map((entry) => `${entry.collection} (${entry.route})`),
        ohneDetailflaeche: WITHOUT_DETAIL.map((entry) => `${entry.collection} (${entry.route}) — ${entry.why}`),
        nichtGeprueft: notMeasured,
        rules: [
          '1 · §5/§6 — the account block spells the role "Administrator"',
          '2 · §6 — the admin navigation block is called "Installation"',
          '3 · §8.1 — "Entscheidungen" stands ungrouped under the overview and carries a counter',
          '4 · §2 — neither "Unbekannt" nor a JavaScript sentinel ("undefined", "null", "NaN") is anywhere in the console',
          '5 · §8.7 — an open gate puts one banner with one link above all tiles, and a quiet queue puts none',
          '6 · §8.2 — the aging section of the queue is called "Liegt schon länger"',
          '7 · §8.3 — no visible button is labelled "OK" or "Submit"',
          '8 · §5 — no identifier-shaped text is visible',
          '9 · §1/§8.1 — the counter equals the number of positions in the queue',
          '10 · §8.6/§10 — an empty queue is a green "Alles erledigt", a filtered-away queue is a compacter line that names the filter and offers the way back',
          '11 · §6 — the sidebar draws "ContentKit" beside a visible icon, the browser tab reads "ContentKit Cockpit", the declared app icon actually loads, and its href in the served document is exactly `base` + the href in apps/cockpit/index.html',
          '12 · §2/§4 — a decision of a kind this build cannot name degrades to its own badge ("Art nicht ermittelbar" plus the raw value) and never unmounts the page',
          '13 · §4 — no route and no detail surface answers with an error screen; a page that threw is not a page that passed',
          '14 · §5 — no catalogue key is rendered as if it were a sentence; the key list is the catalogue itself, so the rule needs no word list',
          `15 · §7 — the convention copy in the repository root is version ${KONVENTION_VERSION}, the one this checker was written against`,
        ],
      },
      null,
      2,
    )}\n`,
  )
}
