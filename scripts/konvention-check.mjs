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
 * It does not soften. Red is a legitimate answer here — this file was written
 * before the console was brought to the convention, and an assertion relaxed to
 * make the output green is the one change that makes it worthless. Every rule
 * below quotes the paragraph it comes from, so a disagreement is settled against
 * COCKPIT-KONVENTION.md rather than against this script.
 *
 * It is also not wired into `verify`, `test`, `validate:*` or any CI workflow,
 * and must not be. It reports where the console stands against the family
 * convention; the repo's own gates report whether the repo is sound. Mixing the
 * two turns a roadmap into a broken build.
 *
 * Run it with `npm run konvention:check` (build the console first if
 * `assets/cockpit` is stale: `npm run cockpit:build`).
 */
import { readFile } from 'node:fs/promises'
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
const readProhibitions = () => {
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
    identifiers: [...new Set(identifiers)].slice(0, 6),
    bareButtons: bareButtons.slice(0, 6),
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
  await page
    .waitForFunction(() => !document.querySelector('[data-slot="skeleton"]'), null, { timeout: 15_000 })
    .catch(() => {})
  await page.evaluate(
    () => new Promise((done) => window.requestAnimationFrame(() => window.requestAnimationFrame(done))),
  )
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
const fixture = await startFixture()
const browser = await chromium.launch({ headless: true })

try {
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
  //    The href is resolved against the document's own base rather than pasted
  //    together, because this console is served under /cockpit/ and the base path
  //    is exactly what a favicon reference gets wrong.
  const appIcon = await page.evaluate(() => {
    const link = document.querySelector('link[rel~="icon"]')
    return link ? { href: new URL(link.getAttribute('href') ?? '', document.baseURI).href } : null
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
    const answer = await fetch(appIcon.href).then(
      async (response) => ({
        status: response.status,
        type: response.headers.get('content-type') ?? '',
        body: (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 120),
      }),
      (error) => ({ status: 0, type: '', body: String(error) }),
    )
    check(answer.status === 200 && /^image\//.test(answer.type), {
      rule: 11,
      paragraph: '§6',
      where: `the app icon at ${appIcon.href}`,
      expected: '200, and an image behind it',
      found:
        answer.status !== 200
          ? `${answer.status || 'the request failed'} — ${answer.body}`
          : `200 but content-type "${answer.type}" — the file was never built, the server answered with the console itself, and the tab shows nothing: "${answer.body}"`,
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
    const found = await page.evaluate(readProhibitions)

    check(found.unknownState.length === 0, {
      rule: 4,
      paragraph: '§2',
      where: `route ${route}`,
      expected:
        '"Unbekannt" appears nowhere — a state is resolved, or it says "nicht ermittelbar seit X" with a reason',
      found: found.unknownState.map((entry) => `"${entry}"`).join(' | '),
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
} finally {
  await browser.close().catch(() => {})
  await fixture.close().catch(() => {})
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)

if (violations.length > 0) {
  for (const entry of violations) {
    console.error(`✗ Regel ${entry.rule} · ${entry.paragraph} · ${entry.where}`)
    console.error(`    erwartet: ${entry.expected}`)
    console.error(`    ist:      ${entry.found}`)
  }
  console.error(
    `\nKonvention-Check failed: ${violations.length} violation(s) against COCKPIT-KONVENTION.md v1.4 in ${seconds}s.`,
  )
  console.error(
    'These are findings, not a broken build. Fix the console — never the assertion — and never wire this check into a gate.',
  )
  process.exitCode = 1
} else {
  process.stdout.write(
    `${JSON.stringify(
      {
        conform: true,
        convention: 'COCKPIT-KONVENTION.md v1.4',
        seconds: Number(seconds),
        locale: LOCALE,
        routes: ROUTES.length,
        rules: [
          '1 · §5/§6 — the account block spells the role "Administrator"',
          '2 · §6 — the admin navigation block is called "Installation"',
          '3 · §8.1 — "Entscheidungen" stands ungrouped under the overview and carries a counter',
          '4 · §2 — "Unbekannt" is nowhere in the console',
          '5 · §8.7 — an open gate puts one banner with one link above all tiles, and a quiet queue puts none',
          '6 · §8.2 — the aging section of the queue is called "Liegt schon länger"',
          '7 · §8.3 — no visible button is labelled "OK" or "Submit"',
          '8 · §5 — no identifier-shaped text is visible',
          '9 · §1/§8.1 — the counter equals the number of positions in the queue',
          '10 · §8.6/§10 — an empty queue is a green "Alles erledigt", a filtered-away queue is a compacter line that names the filter and offers the way back',
          '11 · §6 — the sidebar draws "ContentKit" beside a visible icon, the browser tab reads "ContentKit Cockpit", and the declared app icon actually loads',
        ],
      },
      null,
      2,
    )}\n`,
  )
}
