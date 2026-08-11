# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 4.19.0 — 2026-08-11

### Added

- Localize the complete ContentKit Cockpit in English and German, selecting the
  browser language automatically by default and persisting an explicit language
  choice from the operator account menu. Dates, numbers and relative times now
  follow the active locale as well.
- Add compact, reusable context help to dense forms and tables so field meaning,
  write semantics and operational consequences stay available without crowding
  the primary task.
- Enrich audit events with safe human-readable actor, resource and site labels.
  The Cockpit uses those labels and deliberately keeps opaque identifiers and
  email-shaped values out of routine list and detail views.

### Changed

- Consolidate profile, language, theme and sign-out controls in one operator
  menu with a stable avatar and explicit in-progress sign-out state.
- Rework Cockpit tables, filters, pagination, empty states and responsive form
  layouts around the shared localized primitives, including a denser audit log
  and clearer site/release workflows.

## 4.18.3 — 2026-08-07

### Fixed

- A drain that reaches its 30-second deadline now severs the remaining
  connections and exits 0 instead of exiting 1. Reaching the deadline is the
  designed outcome of a bounded drain, not a crash — and under
  `Restart=on-failure` an exit code 1 lets systemd reinterpret a deliberate
  stop. Idle keep-alive sockets (Caddy pools upstream connections) are closed
  as draining begins, so they no longer pin `close()` until they time out on
  their own.
- The changelog entries for 4.10.0, 4.11.0, 4.11.2 and 4.12.0 were never
  written; they are backfilled below from the release commits.

## 4.18.2 — 2026-08-07

4.18.1 moved the renderer warm-up behind `listen()` and the production probes
answered the theory precisely: one health probe arrived 0.4s after the socket
opened and starved for ten seconds against an open-but-unresponsive listener.
The warm-up — Shiki's full language bundle — monopolizes the event loop
wherever it is placed; there is no ordering that hides a ten-second
monopolization from a ten-second probe.

### Removed

- The boot-time renderer warm-up. Release builds already pay Shiki's
  initialization inside their own Worker (`build-runner.mjs`), published sites
  are static and never touch the renderer, and the one in-process caller — the
  console's preview — now pays the cold cost on its first render, exactly what
  a failed warm-up always implied. The deploy restart window becomes the Node
  module import alone (~6s on the production droplet), inside every probe's
  budget.

## 4.18.1 — 2026-08-07

4.18.0 cut the deploy restart window from 30–60s to ~15s; measuring that boot
showed the renderer warm-up, not storage, holding the remaining ten seconds:
`warmRenderer()` fired during app construction and chewed the event loop while
the bucket check waited behind it, all before the listener opened.

### Changed

- The renderer warm-up now runs after `listen()` instead of gating it. The
  restart window drops to roughly the Node module import (~5s on the
  production droplet) — inside every probe's budget, so a deploy can no longer
  produce a probe timeout at all. A reader whose request beats the warm-up
  pays the cold render, exactly as a failed warm-up always has.

## 4.18.0 — 2026-08-07

Every ContentKit probe timeout in the three days to 2026-08-07 — eighteen of
eighteen — was a deploy restart, not a slow service: each `systemctl restart`
spent 30–60 seconds unpacking the runtime and sweeping stale deck builds before
the listener opened, and the monitor's ten-second probes ran out inside that
window. This release makes the window small enough that a deploy is invisible
to a probe.

### Added

- **`--prepare`** on the launcher unpacks the runtime cache and exits without
  serving, printing the payload's version. A deployment runs it as the service
  user before restarting the unit, so the ~20s unpack happens while the old
  version is still serving. `--prepare` deliberately skips the cache GC — the
  running version may still be lazily reading assets out of its own entry.

### Changed

- Superseded runtime caches are now collected on every real start rather than
  only in the unpack branch, so a pre-warmed boot still removes the previous
  version's entry.
- The stale deck build sweep no longer gates the listener. It is cleanup, not a
  serving precondition, and recursively removing leftover Slidev work trees
  held every boot — and every deploy's restart window — for about ten seconds.
  The bucket check alone now decides `storageReady`; the sweep runs in the
  background and logs a warning if it fails.

## 4.17.0 — 2026-08-07

Contract coverage: **46 of 48 enforced, 2 not applicable, 0 open.** Every clause
is now either held by a test or explicitly parked with the change that would
revive it.

### Changed — the conformance map has three states, not two

A rule can be *enforced*, *unenforced*, or **not applicable**, and the third
requires a `trigger` naming what would make it bite. Counting "does not apply
here" with "nobody has got to it" made the number lie in the pessimistic
direction.

The two AI clauses parked here were already described as not-applicable in
prose; they now say it structurally and carry their triggers. CUI-AI-3 applies
as soon as this console renders model output that is not the conversation
itself — a generated summary, a suggested rewrite presented outside the thread.
CUI-AI-4 applies with the first accept/reject control the console renders
itself rather than through an elicitation.

### Added

- **Colour is never alone** (CUI-A11Y-5). No badge or alert conveys its state by
  colour with no word, and `StatusBadge` still attaches a glyph for warnings.

### Fixed

- One destructive alert carried its severity in colour alone — the site
  switcher's error. Every other destructive alert in this console leads with a
  triangle; that one did not, because the registry `Alert` draws no glyph of its
  own and the icon is a call-site responsibility here.

## 4.16.0 — 2026-08-07

Seven contract clauses this console did not hold. Coverage goes from **38 of 48
to 45**.

### Added

- **The console declares which contract it implements** (CUI-MARK-1/2). The
  served document carries the contract name and a digest computed at build time
  from `contract/cockpit-ui.css`, and the shell carries `data-cockpit-ui`.
  Derived, not typed: a hand-written version number cannot notice when two
  products' bytes drift apart. The digest here matches the sibling's exactly,
  which is the contract working.

- **The assistant says which model answers** (CUI-AI-1/2). This console streamed
  a model's prose on a whole page and attributed it to nobody — it could not,
  because the model is deployment configuration and the stream carries text.
  `OPTIONS /v1/assistant/messages`, the probe the console already makes to learn
  whether the assistant is enabled, now answers with the model name.

  The identity renders in the outline variant, never a success one: the
  assistant's answers are the one thing here nobody measured, and every other
  number on screen came from a count of rows or a duration.

### Added — enforcement

- Tests for CUI-THEME-3 (the pre-paint script and the store resolve the scheme
  by the same rule), CUI-THEME-5 (signing out does not reset the theme — the
  login page is the next paint) and CUI-LOAD-4 (no page hand-rolls the error
  branch `TableState` owns).

  These arrived as a group for one reason: the sibling closed its own contract
  gap and, doing so, wrote tests for rules BOTH consoles carry. The family
  document is byte-identical in both repositories; the enforcement was not.

## 4.15.1 — 2026-08-07

### Fixed

- The operator menu printed the display name twice — once on the trigger and
  again in the header directly below it. Two elements saying one thing is the
  defect the menu was built to remove, arriving from the other side. The header
  now carries the email and nothing else, and only when the trigger is not
  already showing it; the email is the part that is genuinely additional,
  because it tells two people with the same display name apart.

  The same defect was reported and fixed in the sibling console first. It was
  present here and went unfixed, which is what a report about one product of a
  family is worth remembering for.

## 4.15.0 — 2026-08-07

### Added

- **Uptime on the System page**, and the start time behind it. The service
  descriptor did not report one at all, so this needed the server as well as the
  console: `started_at` is stamped when the app is constructed — not when the
  socket opens, because the difference is the boot itself, and an installation
  that took ninety seconds to become ready spent ninety seconds not serving.

  A value that reset is a process that restarted, and a restart nobody ordered
  is the first thing worth knowing about an installation. The sibling console
  has shown this reading for a while; it had no equivalent here.

  The reading is deliberately **neutral**: there is no uptime that is good news
  or bad news on its own. Three minutes is alarming after a quiet week and
  unremarkable during a deploy, and only the operator knows which one it is.
  `StatusReading` had narrowed away the neutral tone `StatusBadge` already
  supported, which forced every row to claim a verdict — that narrowing is
  lifted.

  Absent is `—`, never `0s`. An installation that does not report a start time
  has not been up for zero seconds.

## 4.14.1 — 2026-08-06

### Fixed

- The operator menu no longer prints the session subject. It is a 36-character
  UUID, and a menu is where somebody confirms they are the right person before
  acting — an identifier nobody can read answers no question at that moment. The
  email takes its place where there is one, and the subject remains on Profile,
  one item below, where there is room to say what it is for.

## 4.14.0 — 2026-08-06

### Added

- **A Profile page.** The console had no account surface at all: the footer
  printed a name and a role, and that was it. There was no way to see the
  subject an audit line is keyed by, no way to see which scopes the session
  actually holds, and no sight of either session clock — so a tab left open
  overnight could not say when it stops working and found out mid-save.
  `/v1/identity/session` has returned both `expires_at` and
  `absolute_expires_at` all along.

  The scope block shows held AND not-held, because "why is that page missing"
  is the question an operator actually arrives with, and a list of what you
  can do does not answer it.

- **The operator menu.** The identity in the footer became a control instead of
  three inert lines with Sign out floating above them. The subject moved inside
  the menu — it was reachable only through a tooltip before, which on a phone
  means not reachable.

  The sibling console grew the same page and the same menu in the same places.
  Two separate implementations over two different authorization models —
  ContentKit stores a role, watchkit derives a label from scopes — because what
  should be shared is where an operator looks, not the code.

### Fixed

- **Two tabs of the console now agree on the theme.** Each tab holds its own
  copy of the theme store over one shared storage, and nothing subscribed to
  `storage` — so a theme chosen in one tab never reached the other, and the
  stale tab went on claiming a value that was no longer stored anywhere.

## 4.13.0 — 2026-08-06

### Added

- The theme an operator picks in the console now reaches the login page it hands
  over to. The sign-in funnel is server-rendered under a CSP that allows no
  script, so it could never read `localStorage`; its stylesheet has carried
  `.scheme-light` / `.scheme-dark` override classes that nothing set. The
  console now mirrors an **explicit** choice into a `ck-cockpit-theme` cookie —
  same name as the storage key — and the server reads it and puts the class on
  `<html>`. Choosing dark and signing out no longer ends in a white page.

  `system` is the absence of the cookie, exactly as it is the absence of the
  storage key, so anyone who never chose still follows `prefers-color-scheme`.
  A value that is neither `light` nor `dark` is treated as absent: the cookie is
  user-editable and carries no authority, so garbage costs a colour and never an
  error page. Funnel responses now send `vary: cookie`.

  The cookie is reconciled with the stored choice once at start-up, in both
  directions — that is what reaches an operator who chose dark before this
  release and would otherwise keep meeting a white login page.

- `<meta name="color-scheme" content="light dark">` in the console. Without it
  the browser painted a white canvas and light-scheme form controls before the
  stylesheet landed, partly defeating the pre-paint script.

### Fixed

- The theme control could not express what the store holds. It read the
  *resolved* scheme and wrote its opposite, so for anyone on `system` the first
  click stored an explicit choice and no path led back to key-absence: "follow
  the OS" was destroyed, for the life of the browser profile, by the one control
  that claimed to manage it. It is a three-item radio menu now.

- The theme store touched `localStorage` and `matchMedia` unguarded at import
  time, so a tab with site data blocked threw during module evaluation and took
  the whole console down. It is now an injected-environment factory with every
  access guarded, which also lets it be tested without a browser — three
  `CUI-THEME` contract clauses move out of `enforced_by: []` as a result. An
  unrecognised stored value falls back to `system` instead of being cast
  straight to a theme.

- `apps/cockpit/vite.config.ts` declared no `@/` alias, so `npm run dev` failed
  on the first import in `main.tsx`. `vite build` resolves tsconfig paths itself
  and `vitest.config.ts` declares the alias, so every build and every test
  stayed green while the documented dev workflow did not start.

## 4.12.0 — 2026-08-06

*Backfilled 2026-08-07 from the release commits; this entry and the two below
were missing when the versions shipped.*

### Added

- The family's dark login funnel. The auth pages declared `color-scheme:light`
  and nothing else, so an operator working in dark crossed a white login page on
  the way into a dark console. The funnel now declares both schemes in the
  cockpit's own token vocabulary — `prefers-color-scheme` as the floor, an
  optional `.scheme-*` class as the override — byte-identical across ContentKit,
  WatchKit, WikiKit and SubKit, with the CSP unchanged and still script-free.
- The shared cockpit palette became a contract instead of a coincidence:
  `contract/cockpit-ui.css`, `contract/COCKPIT-UI.md` and `contract/RITUAL.md`,
  byte-identical with the sibling products. Two consoles had duplicated
  seventy-five custom properties by paste; a drifted token renders perfectly and
  says nothing, which is why the bytes now have a register and a ledger.

### Removed

- The hand-typed contract version numbers (`mcp-auth-v2`, `cockpit-ui-v1`).
  Four repositories all claimed `content="2"` while nothing compared the bytes;
  the served marker is now derived from the token bytes at module load, so two
  products serving different CSS announce different strings in the DOM.

## 4.11.2 — 2026-08-05

### Added

- `GET /.well-known/service-descriptor.json` — the version plus a sha256 per
  self-description artifact in one small response, so a monitor asking "has
  anything changed" no longer downloads ~112 KB of `llms-full.txt` per poll.
  Hashes are computed per request from the bytes actually served: a cached hash
  gone stale would make the endpoint lie in exactly the situation it exists to
  report. A document missing from the build is omitted rather than listed.

### Fixed

- The descriptor's `operationId` collided with `GET /`, the route was missing
  from the llms-full endpoint table, and the Cockpit's generated API types were
  stale — all three caught by the drift gates, which is what they are for.
  (4.11.1 was never tagged; 4.11.2 is the release that shipped these fixes.)

## 4.11.0 — 2026-08-05

### Removed

- **The command palette.** The ⌘K trigger and its panel were proposed and built
  on analysis; the person operating this console found them unhelpful, and use
  beats analysis. The palette was a closed island, so this is a deletion —
  five files and the `cmdk` dependency. The sidebar keeps the site switcher.
  The palette-versus-sidebar scope-gate cross-check goes with it; the sidebar's
  own gate keeps its independent test, and only the agreement check between two
  implementations is lost, because there is no second implementation left.

### Fixed

- `SidebarInset` refused to shrink horizontally — flex-child `min-width:auto`,
  the horizontal twin of the 4.8.0 defect. macOS overlay scrollbars hid it;
  the browser job's first Linux run surfaced fourteen route/viewport overflows
  that one `min-w-0` takes to zero.

## 4.10.0 — 2026-08-04

### Changed

- **Release builds leave the request thread.** Site builds run in a worker
  thread; the worst `/health` reading during a 1000-document publish went from
  10.2 seconds to 4.7 milliseconds. The load harness that proves it is wired
  into an npm script and a CI job, so the claim stays checked.

### Added

- The console is driven in a real browser at three viewports in CI — which is
  what makes its layout and mobile claims checkable, and what found the defects
  below.
- Counts on the four tab strips that carried none, with three distinct
  readings: a number, an em dash for asked-and-refused, and nothing for not
  asked yet. A failed query no longer borrows the silence that means "empty".

### Fixed

- A build queued behind a worker that died was never served: a worker killed
  mid-job never reaches the check-in that shifts the queue. The capacity freed
  by the death is now spent on the queue, proven by a test that drives a real
  worker death under a 40 MB heap limit.
- One malformed directive no longer suppresses a whole assistant reply.
- The console is usable at 390 px, from what a browser measured rather than
  what a viewport simulation claimed.

## 4.9.0 — 2026-08-04

### Changed

- The console has a shape, and it is written down in `apps/cockpit/UI-UX.md`. It was
  called inconsistent, correctly: a link and two buttons in one row doing three
  different kinds of thing, nine tiles each carrying its own paragraph saying nothing
  was measured, and two modules that were really ten pages in a bucket. Every one of
  those was a defensible local choice; together they read as a console nobody decided.
  The document decides — the container ladder, link for navigation and button for
  change, where a sentence lives depending on when it is needed, which token carries
  which severity, the four states of anything that loads — and marks each rule as
  enforced by a named test or not enforced at all.
- `authoring.tsx` and `governance.tsx` were each five routes in one module, already
  mounted at five paths. They are ten focused pages now, and the rule that would have
  caught them before anyone measured them — one module exports one page — is a test.
  Five of those pages use tabs where they hold parallel concerns; the two whose panels
  write into each other deliberately do not, because a control whose whole effect is
  off screen describes itself falsely.
- Actions follow one grammar. A link navigates and nothing else changes; a button
  changes something; `destructive` means irreversible. The releases table offered
  Details as a link beside Activate and Delete as buttons — three meanings in one
  visual grammar — and rows like it are consistent now, with a test behind the rule.
- The site switcher's menu is as wide as the names in it. It truncated every site name
  while the column beside it had room.

### Fixed

- A compile refusal raised on one tab could be rendered into a hidden panel and
  announced by nothing. Tab panels stay mounted, so a result the reader did not ask to
  see now reaches them.

## 4.8.1 — 2026-08-04

### Fixed

- The console could not be scrolled. `body` is `overflow: hidden` on purpose — the
  panes scroll and the document stays put, which is what keeps the sidebar still
  while a list moves — and that only works while every element between `body` and
  the scrolling pane is bounded to the viewport. shadcn's sidebar wrapper is
  `min-h-svh`: at least the viewport, growing with its content. So the shell grew
  past the fold, the pane's `overflow-y-auto` never overflowed because its parent
  had grown instead, and `overflow: hidden` cut off the remainder without a
  scrollbar to say so. Measured on the releases page: an 827px viewport, a 9073px
  shell, and nine tenths of the page unreachable.

  Nothing caught it because nothing measures layout: jsdom performs none, so
  `clientHeight` is zero there and the rendering suite is blind to the whole class.
  A source guard now holds the pairing together — while the document refuses to
  scroll, the shell must bound itself — and says in writing that it is the cheap
  half of the answer.

## 4.8.0 — 2026-07-31

### Changed

- The console runs on shadcn/ui. It was built on hand-written lookalikes —
  components named after shadcn, styled like shadcn, with none of the behaviour
  underneath — and that is why the navigation was sixteen flat labels, why every
  explanation became prose beneath a field, why the publication date was a raw
  control reading `tt.mm.jjjj`, and why the dialog every destructive action passes
  through was a `div` carrying `aria-modal` it did not enforce. There is one
  component stack now, with Radix underneath and no hand-rolled twin.
- The sidebar is a navigation rather than a list: the site switcher sits at the
  top, the pages it governs are grouped beneath it, the installation-wide pages are
  their own block, and the whole rail collapses to icons. The command palette is
  cmdk, reachable with ⌘K, and offers only what the session's exact scopes permit.
- shadcn's variable names carry ContentKit's values from `src/design-system.mjs`,
  compared token by token in both modes, so the console and the sites it publishes
  still read as one product. `--warning` and `--success` join `--destructive`, all
  derived from the same palette, because a severity spelled `bg-chart-3` is a chart
  series' name doing a warning's job.

### Added

- A test suite that can see behaviour. Everything above was previously graded by
  reading source text, which cannot tell a trapped focus from the word
  `AlertDialogContent`. A rendering suite now drives the console in CI: focus
  trapped and returned in all three shapes a trigger can be in, a server refusal
  announced rather than tinted, a progress bar that exposes no fraction the API did
  not report. A floor test names every contract, so a case cannot be deleted
  quietly, and writes down what is still graded by grep — a runner sitting in a
  repository looks like coverage from a distance.

### Fixed

- The unsaved-changes guard discarded an operator's work when a save failed. It
  awaited the save inside a `try`/`catch` and left unless something was thrown, and
  neither caller throws: both report failure by returning `false`. So a failed save
  was indistinguishable from a successful one and the guard navigated away with the
  edits, in the content editor and the site settings page. The comment above it
  asserted the opposite in as many words.
- No dialog that owns a mutation can be dismissed while the request is in the air —
  not by Escape, not by the backdrop, not by the close button, which says so by
  being disabled.

## 4.7.1 — 2026-07-30

### Fixed

- The Languages editor withheld the one locale a site with no rows actually needs.
  The add menu filtered against what the site *builds*, and those two lists differ
  on exactly that site: it builds its default locale through the documented
  fallback while carrying no row for it, so the console offered every locale except
  the only one worth adding. Found on production, where a site in that state could
  not be repaired through the console the editor was added for. A 409 is about a
  row that exists, so the filter reads the rows.
- Statistics tiles and plain tables said "Loading…" in one line. Twelve tiles load
  at once, so the grid settled at twelve short cards and jolted to full height when
  the data landed; a table collapsed to a single centred cell under a header that
  was already on screen. Both now hold their own shape while loading.

## 4.7.0 — 2026-07-30

### Added

- A site's locales are writable: `POST /v1/sites/{site}/locales`,
  `DELETE /v1/sites/{site}/locales/{locale}` and `GET /v1/sites/{site}/locales`.
  Until now `createSite` stored the rows once and nothing could add one, so a
  multilingual site could not be created or evolved through any door. The writes
  share a row lock, because two select-then-write pairs still commit under READ
  COMMITTED: without it a `PATCH {default_locale}` racing a `DELETE` left a site
  pointing its root redirect and its 404 page at a locale the build no longer
  emits. The default locale cannot be removed, and a locale is refused while it
  still holds published *or scheduled* content — a scheduled revision sets no
  `published_revision_id`, so it counted as a harmless draft until the scheduler
  published it into a locale with no page.
- Content may no longer enter or be published into a locale the site does not
  build. The removal refusal was a point-in-time check on the past: ingest took
  `meta.locale` verbatim and publish never looked, so the same orphan was
  reachable a second later from the other side.
- The console has a site-creation wizard in place of three free-text fields. The
  locale was typed by hand although the server has a closed set; the preset — the
  decision that settles layouts and URL shapes — was not asked at all; and the
  consequence of each choice now stands where the choice is made.
- A command palette, cursor pagination and sorting for the content list, date
  pickers, progress, skeletons, relative times, a locale editor and a release-chain
  state. Twelve components, no new dependency: +18 kB gzip, and all 87 vendor
  chunks byte-identical.

### Changed

- The sidebar separates what the site switcher governs from what it does not.
  It was a flat list of fifteen entries with the switcher above all of them, while
  Moderation, Credentials and Audit answer on installation-wide endpoints. A test
  measures each entry's declared surface against `docs/openapi.json`, so the
  separation cannot rot quietly, and the pages that genuinely straddle the line
  declare which paths cross and why.
- `/sites` is split. It was titled as a registry but read the switcher, edited the
  selected site's nine setting sections and hosted its delete button — while the
  breadcrumb read `Installation · Site` and the switcher was captioned as a filter,
  over the control that chooses which site gets deleted.
- `POST /v1/sites` validates locale shape like the locale endpoint does. The two
  doors disagreed: `{"default_locale":"Deutsch"}` created a site whose only locale
  row could never hold a document and could never be removed.

### Fixed

- The release chain no longer says "everything published is in the build this site
  serves" without checking. A revision published after the active release was built
  is counted nowhere — the exact state the product exists to make visible.
- A site with drafts and no release read as the loudest state in the chain, with the
  alert card, permanently. Severity graded on whether the site holds *any* content;
  it now grades on whether anything is published, because nothing published means
  nothing an activation could be serving.
- `{active.file_count ?? 0} files` drew an unreported count as zero — on the one
  fact the chain refuses to guess, because a build of zero files is an active
  release that serves nothing, which is how a site once came to answer empty pages
  while every status read green.
- A date-only frontmatter value showed and wrote back the previous day west of
  Greenwich, and the previous year across a year boundary. `date: 2026-07-30` parses
  as UTC midnight, and the control shifted it to the local day regardless.
- The publication date offered 30/90/365-day offsets and "Never" — semantics carried
  over from credential expiry. One click dated a post a month into the future, which
  is what the field sorts by.
- A usage metric the server reported as `missing` was dropped from its tile rather
  than shown as unmeasured, and a tile of missing values claimed "nothing recorded
  in this window".

## 4.6.4 — 2026-07-30

### Fixed

- The console rendered content unstyled. Every typography rule the site has is
  written under `.prose` — templates.mjs puts each document body inside
  `<div class="prose">` — and scoping turned those into `.ck-content .prose …`,
  a descendant selector. The surface carried both classes on one element and so
  matched none of them: no paragraph rhythm, no inline-code chip, no blockquote
  rule, no table borders. Tailwind's preflight additionally removed the list
  markers and heading sizes a published page inherits from the user agent, which
  is why `site.css` never states them; they are handed back with `revert` rather
  than reinvented.
- A site could be created with zero locale rows: `locales: []` is truthy, so
  nothing was stored, and page emission iterates locales. The release then
  contained assets and no pages at all while every build and preview kept
  answering `201`, and the 404 surfaced much later on a page that was never
  emitted. No endpoint could add the locale afterwards. The default locale is
  now always stored, and snapshot builds fall back to it, which repairs the
  sites already in that state without touching them.
- An access rule authored on a directory did not match its own `index.html`, so
  the builder could treat a page as public — leaking its title into navigation,
  sitemap and search index — while serving it `403`. Build time asks about a
  page URL and serve time about the release object behind it; both now reach the
  same rule.
- `POST /v1/api-keys` and the MCP tool disagreed on the default: an omitted
  `scopes` minted a one-scope key through one door and a five-scope key through
  the other. The narrow default wins, because a key minted wider than intended
  cannot be un-issued.

### Changed

- The credential and identity administration rules are stated once and called by
  both doors, instead of a copy each in the HTTP router and the MCP tool
  registry. The MCP tool gains `restore` and the seed source, which is the
  consistency that was the point.
- The integration suite can be run repeatedly against one database. It could
  not: hardcoded slugs collided on the second run, a fixed migration tag made
  the concurrency probe silently stop testing the race, and three tables
  accumulated fixtures.

## 4.6.3 — 2026-07-29

### Fixed

- Content authoring was broken outright: creating and editing both answered
  `422 frontmatter title is required`. The console's HTTP client
  JSON-stringified every body it was given, so Markdown left as a quoted string
  with no frontmatter fence — the endpoint saw exactly what it complained about.
- Dialogs stole focus on every keystroke, because the focus effect listed the
  close handler among its dependencies and every caller passes a fresh one.
- Deck rendering did nothing: the console never asked for the asynchronous form,
  so the server returned the compiled deck and the page had nowhere to put it.
- The theme toggle never re-rendered already-rendered content, because the theme
  was per-hook state and only the shell's copy changed.
- `content.delete_draft` wrote an audit row the check constraint rejects, and
  operator sessions were recorded as `api_key` actors.
- The liveness probe answers plain text on purpose; the console parsed it as
  JSON and reported the service unreachable.

### Changed

- A release now refuses a tag whose commit has no green CI run. The three
  releases before this one were each cut from a red commit and each reached
  production within half an hour, because the release workflow triggers on the
  tag alone and runs a strict subset of CI. A tag is not evidence.
- CI builds and type-checks the console. It had none, which left type-checking
  the generated client as the only mechanism that would notice a handler and its
  specification disagreeing — and it never ran. Its first run found two real
  defects.

## 4.6.2 — 2026-07-29

### Fixed

- The assistant still produced unrenderable directives after being told which
  attributes they require. Naming the attributes was not enough: the rule never
  showed the shape, so the model guessed a form the parser does not accept. Its
  instructions now carry literal, copyable examples taken from the pattern
  gallery.

## 4.6.1 — 2026-07-29

### Fixed

- When a reply could not be rendered as published, the console's placeholders
  still read "rendered when the message is finished" — a promise it already knew
  to be false. They now say the message could not be rendered, and the
  diagnostic below it says why.
- The assistant was told which semantic directives to use but not what they
  require, so it wrote a `:::metric` without a label and the whole reply became
  unrenderable. The required attributes are now part of its instructions.

## 4.6.0 — 2026-07-29

### Added

- `POST /v1/sites/{site}/render` renders arbitrary Markdown through the site's own
  publishing pipeline and persists nothing. The console needed authored Markdown
  shown with ContentKit's semantics — directives, charts, math, highlighting —
  and a second renderer in the browser would have drifted from what is actually
  published the first time either side changed. `compositions/compile` could not
  serve it: it demands `content:write` and rejects Markdown that is not a
  composition.
- The verbs that made "view, create, edit and delete work everywhere" impossible:
  `DELETE /v1/sites/{site}` (409 with the counts of what it would destroy;
  `?purge=true` is the acknowledgement), `GET /v1/content/{item}`,
  `DELETE /v1/comments/{comment}`, `DELETE /v1/contact-submissions/{id}`,
  `DELETE /v1/feedback/{item}`, `POST /v1/content/{item}/audio`,
  `POST /v1/sites/{site}/audio/jobs/{job}/retry`,
  `DELETE /v1/sites/{site}/releases/{release}` (409 for the active one), and
  optimistic concurrency on the site row via `ETag` / `If-Match` → 412.
- Webhook event filters are validated against the nine known event types, so an
  unknown entry is a 422 on create instead of an endpoint that silently never
  fires.

### Changed

- ContentKit Cockpit renders content through that endpoint everywhere it shows
  authored Markdown: the assistant, the content editor preview and the published
  inspector. While a reply streams, the console shows a typographic draft that
  deliberately knows no ContentKit semantics; the finished message is rendered
  once by the server.
- Every configuration parameter is edited through a typed form. The raw JSON
  textarea is gone — site settings, content frontmatter, access rules, webhooks,
  API keys and identity grants all have real controls, and two tests keep it
  that way.
- The selected site lives in the URL as `?site=<slug>`. A selection that existed
  only in React state made every shared link mean something different for the
  person who received it, and the four cross-site lists could forget to filter
  by site at all.
- `assets/composition.js` is callable on a subtree, so the console runs the
  published site's own enhancement rather than a React reimplementation of it.
  The published page keeps its behaviour through a one-line module entry.

## 4.5.7 — 2026-07-29

### Fixed

- Every authoring-assistant turn that called a tool died with "the messages do
  not match the ModelMessage[] schema" — after the tool had already run and its
  effect had already happened. A tool result becomes a model message, where
  only JSON values are valid, and `pg` returns `timestamptz` columns as Date
  instances, so almost every tool that returns a row produced an invalid
  message. Results are now normalised on the way out, which is what the MCP
  transport has always done implicitly by serializing them.

## 4.5.6 — 2026-07-29

### Fixed

- The authoring assistant answered 403 to every message. The chat stream is
  driven by the AI SDK's own transport, which never passes through the API
  client that attaches the CSRF header, so the gate rejected each turn before
  it reached the model. The approval card had the same defect and tried to read
  the token from `document.cookie` — impossible, because that cookie is
  HttpOnly by design. Both now take the token from the session.
- The Credentials and Audit pages crashed outright with "c.map is not a
  function". `GET /v1/api-keys`, `GET /v1/identity-grants` and
  `GET /v1/audit-events` answer with an `api_keys` / `identities` / `events`
  envelope rather than a bare array; the console had assumed arrays because
  those responses were documented in prose only.
- Audio jobs showed an empty title, an empty character count and an empty
  duration: the fields are `item_id`, `chars` and `attempts`, and there is no
  duration. Contact submissions showed an empty message column — the column is
  `body`.

### Added

- Response schemas for `GET /v1/api-keys`, `GET /v1/identity-grants` and
  `GET /v1/audit-events`, so the generated client derives these shapes instead
  of a consumer having to guess them. Guessing is what produced the two
  crashes above.

## 4.5.5 — 2026-07-29

### Changed

- Every interactive and identifying element in ContentKit Cockpit carries a
  `data-testid`, and rows additionally carry their record id. Browser
  automation had to select by coordinates, visible text or the accessibility
  tree, all of which break on any layout or wording change.

## 4.5.4 — 2026-07-29

### Changed

- `GET /v1/sites/{site}/content` now merges each item with its newest revision,
  so `title`, `slug`, `summary` and `tags` come back without a second call, and
  documents the response shape it always had plus these fields. Title and slug
  live on the revision, never on the item, so the bare list identified a
  document only by its `translation_key` — in the Cockpit that meant a Title
  column full of slugs and a Slug column that was empty on every row. One extra
  query per page, not one per item; `kind` and `locale` are now documented as
  filters. `latest_revision_status` describes that revision and is a different
  question from `published_revision_id`, which is what says whether the item is
  live.

### Fixed

- The Cockpit's content list shows real titles and slugs, and marks a published
  item whose newest revision is still a draft as having unreleased work.

## 4.5.3 — 2026-07-29

### Fixed

- The archive page stayed in `sitemap.xml` on presets where 4.5.1 had stopped
  writing it, so those sites advertised a 404 to search engines. Its sitemap
  entry now follows the same condition as the page itself.

## 4.5.2 — 2026-07-29

### Fixed

- The Cockpit's overview reported "No data in this window" for every metric on
  a site with years of releases and content. Its parser had been written from
  a guess rather than from the schema and looked for `series[0].buckets`, which
  neither stats shape has: ProductStats puts numeric metrics directly on each
  bucket alongside a flat `totals` object, and UsageStats nests `UsageMetric`
  records under `buckets[].metrics` with an array of `totals`. Both are now
  read as documented, and a `value_state` of `missing` stays a gap in the chart
  instead of being flattened into a zero.

## 4.5.1 — 2026-07-29

### Fixed

- Sites on a non-portfolio preset no longer publish empty `/blog/`, `/archive/`
  and `/projects/` indexes. The footer already withheld those links on an empty
  wiki or product site, but the builder wrote the pages and listed them in
  `sitemap.xml` anyway, handing search engines empty portfolio pages. They are
  now emitted once the corresponding content exists; the portfolio preset keeps
  them unconditionally because its header navigation links all three by design.
  The `llms.txt` archive entry follows the same condition.

## 4.5.0 — 2026-07-29

### Added

- `GET /v1/sites` lists the sites a credential may read, ordered by name.
  Without it a caller could only address a site whose slug it already knew:
  `site_ids: []` on a grant means "every site", not "none", so an unrestricted
  administrator had no way to discover what exists. The MCP surface has always
  been able to list them; this is the same query and the same per-site
  `authorize()` filter, over HTTP.
- `DELETE /v1/content/{item}` discards a draft item and all of its revisions.
  It refuses with 409 once the item has a published revision — unpublishing is
  a release operation with its own endpoint, and conflating the two would let a
  single call remove live content together with its whole history. This closes
  the last capability that existed on MCP but not over HTTP.

### Fixed

- ContentKit Cockpit showed "choose a site" on every page for an unrestricted
  administrator. The site switcher derived its list from the grant's
  `site_ids`, which is empty precisely when the operator may reach everything,
  so the most common credential produced an empty console. It now lists what
  `GET /v1/sites` reports and preselects the first, remembering a deliberate
  choice across reloads.

## 4.4.2 — 2026-07-29

### Fixed

- The Cockpit told a first-time visitor "Your session has ended." A 401 means
  "no session", which covers a first visit as much as an expired one, and the
  console cannot tell them apart because the cookie is HttpOnly. It now says
  the one thing that is true either way.
- The sign-in chooser told operators they were authenticating "this
  authorization request" when they were simply opening their own console. The
  page is shared with the MCP consent funnel and now names the purpose it is
  actually serving.

## 4.4.1 — 2026-07-29

### Fixed

- `GET /v1/identity/cockpit-login` and `GET /v1/identity/session` answered 404
  in a running server. Both are served by the OAuth mount, but `createApp`
  dispatches to that mount from an explicit path allowlist and neither route
  was in it, so they fell through to the main handler. The console could be
  loaded but never signed into. Both are now dispatched, and independently of
  `CONTENTKIT_MCP_ENABLED`: the Cockpit is not MCP, and gating its sign-in on
  that flag would lock every operator out of the console when MCP is turned
  off. The regression test drives the assembled app rather than the mount,
  which is the gap that let this reach production.

## 4.4.0 — 2026-07-29

### Added

- **ContentKit Cockpit**, a first-party operator console served by ContentKit
  itself under `/cockpit/` on the API host. It covers the full API surface:
  sites and settings, content and revisions, compositions, decks, releases and
  previews, published documents and search, reader access, webhooks and
  deliveries, moderation, credentials, audit, audio and system maintenance.
  Same origin as the API it drives, so no CORS is opened, no second process is
  deployed and no credential is held in the browser. The console ships inside
  the self-contained binary and costs 652 kB.
- `GET /v1/identity/cockpit-login` signs an operator into the console through
  the existing OIDC or API-key funnel, issuing only the HttpOnly operator
  session cookie. It is not an OAuth client: no registration, no consent screen
  for the operator's own console, and no authorization codes minted to be
  discarded.
- `GET /v1/identity/session` returns the signed-in identity, the live
  product-scope ceiling that decides which parts of the console exist, and the
  CSRF token every cookie-authenticated mutation must echo.
- An authoring assistant behind `CONTENTKIT_ANTHROPIC_API_KEY`
  (`POST /v1/assistant/messages`). Credential = enabled: with no key the routes
  answer 404 and the console hides the tab. It calls ContentKit's own MCP tools
  through the same scope filter and the same schema validation, so it can never
  exceed what the caller's credential already permits. Publication, activation
  and credential changes still require a human decision, delivered as an
  approval card; declining, ignoring or dropping the connection changes
  nothing.

### Changed

- Authentication accepts the operator session cookie as a third credential
  source alongside `Authorization: Bearer` and `x-api-key`, resolving to the
  same live grant ceiling as an OAuth access token. A request that carries an
  explicit key is still judged by that key alone.
- Cookie-authenticated mutations must send a matching `X-Contentkit-Csrf`
  header. The gate sits where every secured route resolves its principal, so a
  new route cannot omit it. Key- and token-authenticated clients are
  unaffected.
- Every operation in the OpenAPI document now carries a unique `operationId`,
  enforced by a contract test, so generated clients get stable method names
  instead of path-derived ones that shift whenever a path does.

## 4.3.4 — 2026-07-29

### Fixed

- `POST /v1/api-keys` no longer returns `key_hash`. The listing endpoints
  already stripped the stored verifier; creation returned the whole inserted
  row, so every caller received the peppered hash alongside the raw key. The
  one-time raw key remains the only secret a caller ever sees.
- Credential logging now identifies the key that was actually presented.
  Authentication accepts `Authorization: Bearer` and `x-api-key`, but the
  `unauthorized` and `insufficient scope` warnings fingerprinted the
  Authorization header alone — an `x-api-key` caller was logged as
  `key: "none"`, leaving no way to attribute a 403 without correlating
  `ck_api_keys.last_used_at` by timestamp. Both paths share one extractor,
  which also strips the `Bearer` prefix before hashing, so a single key yields
  a single fingerprint regardless of the header that carried it.

## 4.3.3 — 2026-07-24

### Fixed

- MCP `tools/list` no longer serializes discriminated-union tool inputs with
  a `oneOf` root: strict clients (e.g. Claude Code) reject the entire tool
  listing when any `inputSchema` root is not `type: "object"` (regression
  introduced with the domain-driven MCP OAuth API in 1.23.0). Union roots are
  flattened into one object schema for discovery, with the discriminator
  described per action; runtime validation still runs the exact zod union.
- A confirmation-form cancel arriving faster than any human could have read
  the form (< 2 s) is treated as a client auto-cancel, not a human decision:
  the form is retried once silently, then the tool fails with reason
  `elicitation_auto_cancelled` ("The MCP client auto-cancelled the
  confirmation form without presenting it; no change was made."). A genuine
  human decline keeps the byte-identical "Operation cancelled; no change was
  made." error.
- Elicitation failures now return cause-specific errors with
  `next_best_actions`: `elicitation_unsupported` carries client guidance
  (Claude Code >= 2.1.76 with a fresh session; Codex `approval_policy =
  { granular = { mcp_elicitations = true } }` plus `approvals_reviewer =
  "user"` in `~/.codex/config.toml`), and a timeout reports "Human
  confirmation timed out; no change was made." as `elicitation_timeout`.
  New log lines `mcp elicitation requested/resolved/timeout` trace the
  elicitation lifecycle without recording form content.

## 4.3.2 — 2026-07-24

### Fixed

- `POST /v1/identity-grants` and the MCP `contentkit_manage_identities`
  create action now answer a duplicate identity (unique constraint
  `ck_oauth_identity_grants_provider_id_issuer_subject_key`, revoked rows
  included) with `409` instead of `500`. The conflict body/message carries
  the existing grant id and a hint to `PATCH /v1/identity-grants/{id}`
  (`restore: true` when the existing grant is revoked).
- The MCP `contentkit_manage_identities` tool now follows the same
  scope-ceiling contract as the REST admin surface: `role` XOR
  `product_scopes` on create and update (both set → error), scopes-only
  create works without a role, the stored `role` is always derived from the
  product-scope ceiling via `roleForProductScopes` (previously the create
  action stored the caller's role verbatim, diverging from the ceiling), and
  every create/update stamps `grant_source: "admin"`. The list action gains
  the `provider_id`/`subject` exact-match filters REST already had.

### Removed

- Legacy role-derived OAuth tier mapping `roleOauthScopes`/`ROLE_SCOPES` in
  `src/oauth/policy.mjs` — dead since 4.3.0 derived consent tiers from the
  stored product-scope ceiling (`oauthTiersForCeiling`). The operator-session
  lookup no longer selects the unused denormalized `g.role` column.

## 4.3.1 — 2026-07-24

### Fixed

- OAuth authorize requests without a `scope` parameter (RFC 6749 §3.3, e.g.
  ChatGPT) were pinned to `mcp:read` forever because the requested scopes
  hard-defaulted to `mcp:read` and consent only offers requested ∩ ceiling.
  Scope-less requests now default to the full configured scope set; the
  identity-grant ceiling and the consent checkboxes remain the actual gate.
  (This fix shipped in 4.3.1 but was previously documented only in the
  release commit message.)

## 4.3.0 — 2026-07-23

### Added

- Canonical grant contract v1: `product_scopes` is now the only stored truth
  of an identity grant (the scope ceiling). Named roles (`reader`, `author`,
  `admin`) remain as pure server-side shorthands that expand into scope sets
  on write; the `role` column is degraded to a nullable, denormalized display
  value (migration `0014`) and is never read for authorization. It will be
  removed in v5.0.0 once the rolling auto-deploy window no longer carries a
  v4.2 binary.
- New `grant_source` column (`admin`, `seed`, `signup`, `api-key`; migration
  `0014` backfills `api-key` rows and marks all existing SSO rows `seed`).
  Every manual write stamps `admin` so the reconcile seeder can skip
  operator-managed rows; the seeder marks its rows with `source: "seed"`.
- `POST /v1/identity-grants` accepts exactly one of `role` or
  `product_scopes` (both set → 422); legacy role-only bodies keep working
  unchanged. A new optional `source` body field accepts only `"seed"`.
- `GET /v1/identity-grants` gains optional `provider_id` and `subject`
  exact-match query filters and exposes `grant_source`.
- `PATCH /v1/identity-grants/{id}` learns `restore: true` — the only way to
  clear `revoked_at` on a revoked grant (audited as `identity.restore`). A
  PATCH without `restore` keeps matching non-revoked grants only, so a
  revoked identity stays revoked until an explicit admin act.
- New policy function `oauthTiersForCeiling(product_scopes)`: the offered
  `mcp:read`/`mcp:authoring`/`mcp:admin` consent tiers are derived from the
  stored product-scope ceiling — `mcp:read` for read scopes, `mcp:authoring`
  for authoring scopes, `mcp:admin` for any scope outside the authoring
  bundle.

### Fixed

- OAuth consent, token issuance and the per-request bearer-token
  authentication path previously derived the mcp tiers from the stored `role`
  while product access used `product_scopes` — two truths that could diverge.
  All three now read only the `product_scopes` ceiling;
  a grant whose role said `reader` but whose ceiling carried admin scopes is
  now offered `mcp:admin` (and vice versa a stale `admin` role without admin
  scopes no longer unlocks the admin tier). The double truth was the bug.

## 4.2.0 — 2026-07-23

### Added

- `CONTENTKIT_OAUTH_ENABLE_SIGNUP` (default `false`): opt-in self-signup for
  the browser SSO funnel and the headless `POST /v1/identity/sessions`
  exchange. When enabled, an OIDC identity that authenticated at the provider
  but has no ContentKit grant is provisioned automatically in
  `ck_oauth_identity_grants` with the minimal `reader` role and its product
  scopes (`content:read`, `stats:read`); the display name comes from the `name`
  claim, the verified email or the subject, and the email is stored only when
  `email_verified=true`. The switch controls first-time creation only: existing
  grants are never modified and a revoked grant keeps being denied. With the
  switch off, unknown identities keep receiving the styled `Sign-in failed`
  page or the RFC 6749 `error=access_denied` redirect exactly as before.

## 4.1.0 - 2026-07-23

### Added

- Render a human-readable `Sign-in failed` browser error page — in the same
  shared page template and design tokens — for GET failures inside the browser
  login funnel: rejected identity grants at the OIDC callback, unknown,
  expired or already-used login states, and OIDC code-exchange failures. Every
  page offers a `Sign in again` entry point.
- Redirect the waiting OAuth client with an RFC 6749 `error=access_denied`
  response when the login state carries a validated registered client and
  redirect URI, so MCP clients no longer hang on rejected browser sign-ins.
  JSON `{error,error_description}` bodies remain for the token, registration
  and API endpoints and for requests preferring `application/json`.

### Changed

- Align the common auth UI action tokens with the shared product design
  (`--primary:#1f2328`, `--primary-hover:#000`).
- Start a fresh single-use login state for every `Continue with SSO` click
  instead of overwriting the pending state's nonce and PKCE code verifier;
  earlier attempts stay valid until the original authorization TTL, so the
  browser back button keeps working.
- Include `mcp:admin` in the default `CONTENTKIT_OAUTH_ALLOWED_SCOPES`
  (`mcp:read,mcp:authoring,mcp:admin`), matching the documented deployment
  configuration.

## 4.0.0 - 2026-07-23

### Changed

- Make OIDC identity subject-first: `sub` is mandatory and continues to require
  an exact pre-provisioned provider/issuer/subject grant; email is optional,
  and only a provider-verified claim may refresh the grant.

### Removed

- Stop fabricating a required email value for subject-only identities. The
  common identity-session response now exposes `email` as `string | null`.

## 3.0.0 - 2026-07-22

### Changed

- Make API-key and direct OIDC the complete ContentKit-owned MCP
  authentication model. ContentKit owns its OIDC clients, callbacks, secrets,
  sessions and exact identity/site grants.
- Preserve the common SSO-first UI and route/schema contract while keeping all
  authentication runtime and configuration inside this product.
- Update README, MCP/deployment docs, OpenAPI and both LLM documents to the
  corrected independent-product architecture.

### Removed

- Remove the hosted assertion-adapter protocol and its POST callback surface.

## 2.1.0 - 2026-07-22

### Added

- Add the common provider discovery and assertion exchange boundary, including
  `POST /v1/identity/sessions` with the shared
  `{api_key,principal_id,context_id,email}` response and ContentKit's exact
  pre-provisioned identity/site ceiling.
- Publish the full common MCP-auth route and schema set in OpenAPI.

### Changed

- Upgrade every ContentKit login and consent page to `mcp-auth-v2`, the exact
  shared style hash, an opaque `login_state` handoff and fixed
  `Continue with SSO` then `Continue with API key` actions.
- Cache standards-based OIDC discovery keys for assertion exchange while
  retaining exact issuer, audience and identity-grant verification.
- Update README, MCP/deployment docs, OpenAPI and both LLM documents to the
  same provider-neutral contract as the other independent products.

### Removed

- Retain no provider-named routes, payload aliases or compatibility parsing.

## 2.0.2 - 2026-07-22

### Changed

- Make the MCP auth example provider-neutral and keep product storage
  configuration explicitly outside the identity-provider contract.
- Add a regression gate that rejects concrete provider products in browser
  auth implementation and documentation.

## 2.0.1 - 2026-07-22

### Fixed

- Dispatch the shared `POST /v1/identity/logout` route through the public
  server boundary so the implemented session revocation is reachable on the
  canonical API host, matching WikiKit and SubKit.
- Cover the outer HTTP mount with a regression test instead of testing only
  the OAuth handler in isolation.

## 2.0.0 - 2026-07-22

### Added

- Add one provider-neutral MCP browser-auth list for one scoped API key plus
  multiple named direct OIDC adapters; provider products are
  configuration values rather than ContentKit modes.
- Apply verified-email and exact identity-grant policy to OIDC adapters without
  adding provider-specific branches.
- Add the shared `mcp-auth-v1` card with the ContentKit `ck` badge, verified
  external identity assertions, account switching/logout and OAuth 2.1
  OpenAPI metadata.

### Changed

- Replace every provider-specific login route and config branch with the
  generic start/callback/logout contract and the `protocol` discriminator. No
  legacy provider shape or route is accepted.

- Bound operator sessions to an eight-hour idle and 24-hour absolute lifetime,
  with live source-grant revalidation on every authorization step.
- Constrain consent to the exact client request and live role/product/site
  ceiling. `mcp:read` is mandatory and is never added to a request that omitted
  it.

### Removed

- Remove the former provider-specific configuration and login endpoints with
  no runtime compatibility parser. Deployments must supply the canonical
  `protocol` records before starting 2.0.0.

### Security

- Keep authorization state, tokens and sessions opaque or hashed at rest;
  require verified allow-listed identities from every configured adapter and
  retain exact callback, issuer, audience, PKCE and resource binding.

## 1.23.3 - 2026-07-21

### Fixed

- Advertise every enabled MCP capability tier in the initial
  `WWW-Authenticate` scope challenge so standards-compliant clients such as
  Claude request the authoring and administration tiers instead of discovering
  only the six read-only tools.
- Keep consent downscoping strict: the operator may select only scopes the
  client requested and the live identity, product-scope and site ceiling
  permits; the token response reports the actual granted scope set.

## 1.23.2 - 2026-07-21

### Fixed

- Allow the SubKit-style OAuth consent page to redirect to registered
  cross-origin MCP client callbacks, use an explicit POST/Redirect/GET `303`,
  and replay duplicate consent submissions idempotently for a short window.
- Keep the replayed authorization response encrypted at rest, mint exactly one
  single-use authorization code and record duplicate handling without logging
  state, code, callback or credential values.

## 1.23.1 - 2026-07-21

### Fixed

- Include the root-level MCP agent guide in every single-binary payload so
  `contentkit://system/agent-guide` is discoverable and readable in packaged
  production deployments, with a binary-level MCP regression test.

## 1.23.0 - 2026-07-21

### Added

- Add a domain-driven MCP 2025-11-25 Streamable HTTP API with scope-filtered
  tools, code-versioned resources, reusable prompts, per-principal session
  servers, bounded leases, SSE lifetime tracking and graceful shutdown.
- Add OAuth 2.1 authorization-code/PKCE discovery, RFC 8707 resource binding,
  public-client registration, opaque short-lived access tokens, rotating
  refresh-token families and exact pre-provisioned OIDC subject grants.
- Add the SubKit-inspired sign-in/consent UI plus native MCP form elicitation
  for live/destructive changes and one-time URL elicitation handoffs for API-key
  secrets.
- Add append-only redacted audit events, idempotent live publication boundaries,
  identity/API-key administration, MCP usage telemetry and site-scoped
  `/stats/mcp` aggregates.

### Changed

- Extend the REST/OpenAPI surface with identity-grant CRUD, API-key list/revoke,
  audit queries and MCP statistics; update README, deployment, analytics,
  `llms.txt`, `llms-full.txt` and the dedicated MCP guide consistently.
- Expand the scope model into explicit read, authoring and bounded
  administrative aggregates while preserving API-key authentication and the
  backwards-compatible `content:read` statistics grant.

### Security

- Bind every MCP session to its initializing credential without treating the
  session ID as authentication; reject foreign/unknown sessions identically,
  validate browser Origin and protocol revision, and cap bodies/sessions/time.
- Keep OAuth codes/tokens/operator sessions hashed at rest, intersect live grant
  ceilings during token authentication, revoke token families on refresh replay
  and keep credentials, prompts, arguments, results and content out of telemetry
  and audit metadata.

## 1.21.0 - 2026-07-20

### Added

- Add explicit opt-in, append-only HTTP and semantic-composition usage events
  with canonical dimensions, independent product-local HMAC actors/sessions and
  a 90-day default retention task.
- Add `stats/http` and `stats/compositions` APIs with organic/synthetic/internal
  traffic separation, bounded two-dimension grouping, exact full-window unique
  counts, percentile latency and explicit ratio evidence.
- Add typed semantic metric evidence through `value_state`, `value_kind`, sample
  size, numerator/denominator, period boundaries and provenance, including
  distinct HTML/SVG/report projection for missing and estimated evidence.

### Changed

- Extend README, deployment/architecture/analytics/report authoring guides,
  `llms.txt`, `llms-full.txt` and OpenAPI with the complete usage and semantic
  metric contracts.
- Canonicalize request route labels before telemetry or structured logging so
  dynamic content/site/resource identifiers never become usage dimensions.

### Security

- Never persist content, prompts, bodies, tool inputs, raw URL/query values,
  network fingerprints, OAuth details or credentials; anonymous HTTP remains
  deliberately unidentifiable and internal collectors are isolated from organic
  product usage.

## 1.20.0 - 2026-07-20

### Added

- Add generic configured report series with the report-only `reportSeries`
  frontmatter field, snake-case Read API projection and per-locale series pages.
- Add series-aware product overview cards, exact lead-cadence selection, other
  current cadences, bounded history and explicit empty states.

### Changed

- Validate report-series registries in site settings and reject unregistered
  series during preview/release while retaining legacy unassigned reports.
- Document report series consistently in README, guides, LLM documentation and
  the typed OpenAPI read contract.

### Security

- Keep access grants, noindex behavior, private discovery and reader sessions
  unchanged for the new generated series routes.

## 1.19.1 - 2026-07-20

### Fixed

- Keep the reusable English deck example free of tenant production-domain
  references so tenant dogfooding remains deployment configuration.

## 1.19.0 - 2026-07-20

### Added

- Add a first-class, machine-readable deck-template registry with reusable
  narrative contracts for editorial stories, decision briefs, technical
  explainers and status reports.
- Publish tenant-resolved design tokens and design-system guidance with every
  site release for browsers, design tools, automation and language models.
- Add an English production showcase and a real-browser pixel and geometry
  release gate across desktop, laptop, mobile and dark-mode viewports.

### Changed

- Resolve deck typography, colors, branding and visual composition through
  tenant site configuration while keeping all product defaults tenant-neutral.
- Strengthen semantic-deck narrative validation, accessible contrast, offline
  font delivery and responsive visual safe areas.

### Fixed

- Keep requested composition patterns through viewport re-resolution.
- Prevent deck visuals, connectors and labels from leaving their canvas,
  overlapping content or inheriting unintended opacity.
- Prevent per-slide narrative metadata from leaking into rendered slide copy.

## 1.18.1 - 2026-07-20

### Added

- Add a production-shaped German semantic-deck example and document its
  permanent public ContentKit URL.

### Changed

- Present semantic decks solely as a native ContentKit capability and remove
  obsolete one-time conversion tooling and retirement documentation.

## 1.18.0 - 2026-07-20

### Added

- Add a first-class `deck` content kind with a deterministic,
  source-addressed DeckPlan, information architecture, narrative roles and
  immutable release artifacts.
- Compile semantic slide regions through ContentKit's controlled Composition
  pipeline into accessible light/dark SVG and PNG representations before a
  bounded Slidev build produces one self-contained, presenter-capable deck.
- Add synchronous and bounded asynchronous plan, validate and compile APIs,
  deck theme discovery, released deck listings, Markdown twins and Read API
  metadata under the dedicated `deck:render` trust scope.
- Add deck build telemetry, site-scoped aggregate statistics, Prometheus
  counters/gauges, readiness queue state and publication/failure webhooks
  without retaining source Markdown or author identity in telemetry.
- Add the ordered PostgreSQL deck migration, production canary procedure,
  authoring reference, example deck and binary lifecycle verification.

### Changed

- Integrate slide collections into generated navigation, sitemap, search,
  `llms.txt`, `llms-full.txt`, OpenAPI and the unified CMS documentation.
- Package the Slidev renderer, controlled offline themes and all semantic deck
  assets in the self-contained ContentKit binary.

### Security

- Run trusted deck compilation with bounded concurrency, queue and process
  timeouts, process-tree termination, ephemeral workspaces and a sanitized
  child environment; published decks receive a path-specific offline CSP.

## 1.15.8 - 2026-07-19

### Added

- Project primary report metrics from the current report's Semantic AST onto
  product-report home pages without maintaining a second metric payload.
- Render authored metric units, periods, and statuses consistently in semantic
  HTML output.

### Changed

- Refine report catalogue spacing and responsive primary-metric presentation
  for compact desktop and mobile reading.
- Document the shared Semantic AST projection contract for humans and agents.

## 1.15.7 - 2026-07-19

### Added

- Let normal pages and posts embed bounded semantic information blocks inside
  editorial prose without changing the whole document to a composition layout.
- Classify every Semantic AST as `prose`, `embedded`, or `document` so humans
  and external agents can distinguish plain articles, semantic information
  islands, and complete visual compositions deterministically.

### Changed

- Document embedded-block authoring, output boundaries, responsive behavior,
  and the selective editorial rule consistently in the README, visual guides,
  LLM documentation, and OpenAPI contract.

## 1.15.6 - 2026-07-19

### Fixed

- Refine responsive report presentation with concise overview navigation and
  bounded report cards across desktop and mobile layouts.

## 1.15.5 - 2026-07-19

### Fixed

- Preserve missing chart cells as missing evidence instead of coercing them to
  zero in dashboard SVGs.
- Replace empty dashboard plot scaffolds with a compact, authored empty state
  so reports without a completed input interval do not imply measured data.
- Preserve authored bar-chart geometry in dashboard compositions and label all
  readable categories instead of connecting unrelated categories with a line.
- Remove duplicative composition overviews and end-user export controls from
  report pages while retaining headless SVG assets; semantic charts remain
  embedded only where they add information.
- Expose overview plus current-report navigation in product report sites.
- Emit compact mobile variants for ordinary report charts so labels remain
  readable instead of scaling a 960 px desktop chart into a narrow card.

## 1.15.4 - 2026-07-19

### Fixed

- Reflow the product report-period navigation into a bounded responsive grid
  instead of widening 320 px and 390 px pages beyond the viewport.
- Embed the report composition's responsive light/dark SVG as a visual summary
  while retaining semantic HTML and explicit export links.
- Remove fabricated live-state, fixed-period and sparkline decorations from
  dashboard SVGs; only authored reporting periods and measured values render.
- Replace the duplicate cadence link row on report-catalog homes with concise
  overview navigation and limit the visible immutable history to six reports.

## 1.15.3 - 2026-07-19

### Fixed

- Keep additive composition-site releases bounded by emitting responsive HTML
  and standalone SVG without eagerly rasterizing every historical composition.
  PNG remains available as an explicit headless compile or published-content
  representation.
- Rasterize PNG only when a compile or published representation request asks
  for it; ordinary semantic document reads no longer pay the raster cost.

## 1.15.2 - 2026-07-19

### Fixed

- Keep report section navigation within narrow containers and wrap its links on
  mobile instead of widening the page.
- Let semantic data tables span the full composition grid so evidence remains
  readable rather than occupying a single narrow column.
- Localize the chart source-data disclosure label for German reports.

## 1.15.1 - 2026-07-19

### Fixed

- Include the declarative publishing-guide registry in standalone binary
  payloads so report, diagram and code-story guidance is available after the
  runtime is extracted.

## 1.15.0 - 2026-07-19

### Added

- Semantic visual composition pipeline: Markdown → Semantic AST → Narrative →
  Composition → deterministic responsive HTML and standalone light/dark SVG/PNG.
- 81 repository-owned declarative Markdown+YAML Pattern Packages with semantic
  and narrative contracts, content budgets, typed input and unit rules,
  selection metadata, responsive fallbacks, accessibility contracts, examples,
  counterexamples, and agent guidance. Public registry and site-scoped
  recommend, validate, and headless compile APIs make the decision process
  usable by external AI agents.
- Published composition models, diagnostics, accessible text and authorized
  ETag-cached SVG/PNG representation endpoints.
- Formal resolved Layout Tree and Render Tree models that separate semantic
  interpretation and geometry from HTML/SVG serialization.
- Semantic FAQ, code example, pricing, gallery, data table, dashboard section,
  and application shell families with controlled Markdown authoring.
- Declarative publishing guides for decision, status and analytical reports;
  process, sequence, architecture, state and data-model diagrams; and
  reproducible code walkthroughs.
- A generated neutral review gallery covering every pattern at six container
  widths in both schemes: 972 real SVG/PNG cases, 1,097 semantic HTML cases,
  and 12 complete responsive gallery scenarios with deterministic browser
  validation.
- Fifteen typed data shapes for range, change, divergence, Likert, XY,
  boxplots, matrices, waterfalls, hierarchies, flows, uncertainty, calendars,
  geographic points, equal-area regional tiles and sample distributions. The
  same semantic SVG geometry is used by headless compositions and report HTML.

### Changed

- Reports now prefer `layout: composition` with `composition.format: report`;
  existing `layout: report`, `report-grid` and `report-card` documents are
  normalized to the same semantic pipeline for compatibility.
- Contentkit remains a headless Markdown mini-CMS and adds semantic visual
  composition with controlled, executable-code-free information Pattern Packages.
- Composition narratives now preserve audience, question, communication goal,
  thesis, conclusion, action, limitations and disclosure. Chart and technical
  diagram instances expose their own question, insight, action and limitation
  for human and machine interpretation.
- Visual resolution now uses the actual embedding container in addition to the
  viewport and reports structured fallback, degradation and content-budget
  diagnostics.

## 1.14.5

### Added

- **Product report sites derive a cadence-aware catalog.** Report pages can
  declare the generic `reportCadence` field as hourly, daily, weekly, monthly,
  quarterly or yearly. A product home then renders one current report per
  available period, localized period navigation and a bounded immutable
  history. Reports without the field remain compatible, and protected catalogs
  still contain only exact same-grant pages.

## 1.14.4

### Added

- **Reports derive a responsive local section navigation.** A report with at
  least two level-two headings now exposes those major areas as localized,
  same-page navigation pills. Level-three detail stays out of the navigation;
  the navigation needs no browser JavaScript and is omitted from print.

## 1.14.3

### Fixed

- **Chronological ordering is stable across PostgreSQL and frontmatter
  values.** ContentKit now normalizes driver-returned `Date` instances and
  authored ISO strings to epoch time before sorting reports, product-page
  cards, posts and audio backfills. This closes the production-only case where
  a legacy report could sort above a newer semantic reporting period.

## 1.14.2

### Fixed

- **Report navigation follows the semantic reporting period.** An authored
  `date` now overrides the database activation time while undated legacy
  documents retain their repository timestamps. Latest-report sorting compares
  timestamps separately from its deterministic title tie-breaker, so a
  historical weekly, monthly or yearly report published later cannot displace
  the newest hourly report.

## 1.14.1

### Fixed

- **Site gateway handlers terminate after sending a response.** A completed
  host response no longer falls through into later middleware and attempts a
  second write.
- **Managed webhooks can be the only production delivery mechanism.** The
  optional global environment endpoint is no longer incorrectly required in
  production. If the legacy fallback is used, its URL and secret must still be
  configured as a pair; managed per-site endpoints remain independently
  filtered and encrypted at rest.
- **Fully private sites now have a useful home and navigation after login.** A
  protected static page renders public pages plus protected pages carrying the
  exact same release-scoped group/user grant. Product sites with report pages
  show the newest report in header/footer navigation and render same-grant
  report cards newest-first on the home page. Public discovery remains empty,
  anonymous delivery remains gated, and a different reader group cannot leak
  through the prebuilt HTML.
- **Binary builds work with macOS Bash 3.2 under `set -u`.** Native builds no
  longer expand an unset/empty target-argument array; cross-builds still pass
  the requested Bun target explicitly.

## 1.14.0

### Added

- **Generic site-scoped product analytics.** Six bounded read-only endpoints
  expose dense UTC aggregates for releases, content, reader authentication,
  webhooks, audio and engagement using the existing `content:read` scope. The
  data remains in ContentKit's PostgreSQL database and the API has no reporting
  consumer or workflow dependency. Reader-auth facts are identity-free and
  retention-bounded. OpenAPI, LLM docs, indexes, unit/contract/real-PostgreSQL
  tests and W3C trace propagation cover the surface.

## 1.13.1

### Fixed

- **The footer navigation column now follows the preset.** Non-portfolio sites
  (wiki, product-docs, knowledge-base, changelog) previously showed the
  portfolio links (Blog, Projects, Archive, Tags) in the footer even though the
  header already led with the preset's own hub. The footer now leads with the
  preset's section — Wiki, Docs, Help or Changelog — and appends the blog,
  projects, archive and tag links only when the site actually has that content.
  Portfolio sites with posts are unchanged. Header and footer now share one
  preset-to-section definition so they cannot drift apart.

## 1.13.0

### Added

- **Visual reports and dashboards from Markdown.** Pages can select the
  controlled `report` layout and compose responsive metric cards, badges,
  progress, cards and grids. `bar`, `line`, `area` and `donut` charts use an
  ordinary GFM table as their complete data contract; the server renders
  deterministic, accessible light/dark SVG release assets, so no
  chart runtime or executable specification reaches the browser. The existing
  shadcn-style token contract now includes `chart_1` through `chart_5`, and
  report pages retain their source tables, print cleanly and receive Markdown
  twins. Unit, contract, real-document smoke, integration, compiled-binary E2E
  and a 200-chart benchmark cover the feature.

## 1.12.0

### Added

- **Controlled site presets and page layouts.** Sites can select `portfolio`,
  `product-docs`, `wiki`, `knowledge-base`, `product` or `changelog` through
  `settings.presentation.preset`; existing sites remain `portfolio`. Pages can
  override the preset with `standard`, `docs`, `wiki`, `knowledge`, `landing`
  or `changelog`. Documentation, wiki and knowledge layouts add validated
  hierarchies, sidebars, breadcrumbs and heading tables of contents; product
  documentation supports one current and multiple archived versions. Landing
  pages gain controlled `hero`, `features`, `steps` and `cta` directives.
- **Reader access control.** Site administrators can create personal readers,
  salted-scrypt passwords, groups, memberships and exact/prefix path rules.
  A Markdown document can grant groups with `access`. Successful site-host
  login creates a hashed, revocable session with idle and absolute expiry;
  anonymous page requests redirect to login and wrong-group readers receive
  403. Access policy and protected navigation/search are snapshotted per
  immutable release, so rollback restores content and authorization together.
- **Private discovery projection.** Protected documents and protected-only
  media are removed from public navigation, search indexes, sitemaps, feeds,
  Markdown twins, LLM files and structured discovery. Authenticated readers get
  a same-origin private navigation and search projection with
  `Cache-Control: private,no-store`.
- **Real-document verification and benchmarks.** English product docs, wiki,
  knowledge-base, product landing and changelog examples are exercised by a
  smoke build and the compiled-binary E2E flow. A deterministic 1,000-document
  benchmark measures build throughput, memory, access-rule resolution and
  password verification; CI enforces broad regression budgets and uploads the
  JSON report.

### Security

- Production requires an independent `CONTENTKIT_SESSION_SECRET`. Reader
  cookies are HttpOnly and SameSite=Lax (Secure on HTTPS); login uses a signed
  CSRF token, validates same-origin return paths and limits attempts to five per
  15 minutes per IP and normalized username.
- Reader passwords are 12–256 characters and stored with salted scrypt
  (`N=32768`, `r=8`, `p=1`, 64-byte output). Session tokens are random and only
  their HMAC is stored. Password resets, account disabling and explicit session
  revocation invalidate active sessions.

## 1.11.0

### Added

- **Content lifecycle webhook events.** Release activation now emits
  `contentkit.content.published` (per item whose published revision actually
  changed — no-op republishes stay silent), `contentkit.content.unpublished`
  (per retired item that was published) and one `contentkit.release.published`
  per activation, enqueued in the same database transaction as the pointer
  switch. Rollbacks and empty releases move no item pointers and emit only
  `release.published`. No new settings or scopes — the per-endpoint `events`
  filter is the opt-in.
- **Content modeling light.** Frontmatter gains an author-owned `extra:` map
  of custom fields (max 32 keys `[a-z][a-z0-9_]{0,63}`, scalar/list/flat-map
  values, 16 KiB, validated with a 422 on write) stored verbatim in the
  revision metadata, and `related: [slug, …]` references to same-locale posts
  (max 8, no duplicates or self-reference, stored as `related_slugs`).
  Authored references lead the related-posts block in the author's order, tag
  similarity fills up to three, and a broken reference is dropped with a
  warning instead of failing the release. The new
  `settings.content.show_extra` setting (default off, validated on
  create/PATCH) renders the extra fields as a definition list on the page and
  as a bullet block in the Markdown twin and per-site `llms-full.txt`;
  JSON-LD and the search index never carry them. Deliberately no custom
  content kinds: a dedicated collection is `kind: post` + a dedicated tag +
  `extra` fields.
- **JSON read API ("optional headless").** `GET /v1/sites/{site}/published`
  lists currently published content as JSON — filters `kind`, `locale`, exact
  `tag` and `updated_since` (strictly greater than the item's `updated_at`),
  keyset pagination via an opaque `cursor` (default 50 entries, cap 200) —
  and `GET /v1/sites/{site}/published/{kind}/{locale}/{slug}` returns one
  document plus the immutable Markdown source verbatim and on-demand rendered
  HTML (never stored). Revision `metadata` is served verbatim, so `extra`
  fields ride along automatically. Both routes live on the management API
  behind `content:read` scoped keys — no anonymous delivery path, static site
  delivery unchanged — and honour `If-None-Match`/304: the list with a weak
  ETag over the site's publish epoch, the document with a strong ETag over
  the revision source hash and service version.
- **Server-side full-text search.** `GET /v1/sites/{site}/search?q=` runs
  PostgreSQL full-text search over currently published content (`content:read`
  scope): locale-aware stemming (de → german, en → english, otherwise simple),
  title/summary/tags weighted above body text, relevance `rank` and a
  `headline` snippet with `<mark>` highlights. Search vectors are filled by an
  insert trigger on the immutable revisions (migration
  `0006_contentkit_search`, backfill included) and queried only through the
  whitelisted `ck_search_published` function joining over
  `published_revision_id`, so drafts stay invisible. The frontmatter block is
  stripped before indexing — author-owned `extra` fields never land in the
  index. Published sites keep their static client-side search; no anonymous
  search path appears.
- **Theming as design tokens.** `settings.theme.tokens` generalizes the
  single-token accent injection: every allowlisted token (`background`,
  `foreground`, `muted`, `muted_foreground`, `border`, `primary`,
  `primary_foreground`, `radius`, `font_family`) fills the custom property of
  the same name in the shared stylesheet, as one value or a
  `{ light, dark }` pair emitted behind `prefers-color-scheme`. Hex colors
  are converted to the `H S% L%` triples the stylesheet expects, unknown
  token keys fail the write with 422, and `settings.accent` stays the
  shorthand for `primary` (the explicit token wins). The new size-capped
  `settings.theme.custom_css` (8 KiB, no `</style`) is appended as the last
  `<style>` element as the escape hatch — deliberately no template or layout
  overrides, and `site.css` stays shared and content-hashed.

## 1.10.0

### Added

- **Feed subscribe rows.** The blogcast page's bare "Subscribe via RSS" link —
  which just opened raw XML — became a subscribe row: the plain RSS link,
  podcast-app deep links (Apple Podcasts, Overcast, Pocket Casts), and a
  copy-feed-URL button with clipboard confirmation. The blog index promotes its
  RSS feed with the same shared row (RSS link, Feedly, copy button), on by
  default and removable via `settings.blog.subscribe_row: false`. Both target
  lists can be replaced per site via `settings.audio.subscribe_targets` /
  `settings.blog.subscribe_targets = [{ label, url_template }]` with `{feed}`,
  `{feed_encoded}` and `{feed_no_scheme}` placeholders.
- **Domains via PATCH.** `PATCH /v1/sites/{site}` now also accepts `domains`,
  replacing the hostname mappings in full (the same read-merge-send contract
  as `settings`); previously domains could only be set at site creation.
- **One-click post feedback.** Sites can opt in via
  `settings.feedback.enabled: true` to render a quiet "Was this post helpful?"
  thumbs-up/down widget under each post. Votes are anonymous by design (no
  name, no email, no IP — no consent surface), deduplicated per device via
  localStorage, and protected by the existing honeypot and per-IP rate limit
  instead of a captcha. New public endpoint
  `POST /public/v1/posts/{post}/feedback` stores the vote in the new
  `ck_post_feedback` table (migration `0005`); `GET /v1/feedback`
  (`moderation:write`) returns per-post up/down aggregates.

## 1.9.3

### Fixed

- Long German compounds in article titles and full URLs in source lists now
  wrap on narrow screens instead of being clipped outside the viewport.

## 1.9.2

### Fixed

- The read-aloud player is seekable again. `/media` served every asset as one
  indivisible `200`, ignoring `Range` — so a browser would not seek within it,
  and Chrome's media loader (which opens audio with `Range: bytes=0-`) stalled
  at `readyState 0` without ever reporting a duration. The result was a player
  whose scrubber, ±15 s buttons and play button all appeared dead. `/media` now
  advertises `Accept-Ranges: bytes` and answers byte ranges with a `206` and a
  `Content-Range` (`416` when unsatisfiable), forwarding the range to the object
  store and slicing locally when the store ignores it. `HEAD` reports the real
  length instead of `0`.
- The player's ±15 s buttons and seek slider no longer refuse to act before
  playback starts. Both bailed out on `readyState === 0`, which with
  `preload="none"` is every fresh page view — but assigning `currentTime` in
  that state is honoured by the browser as the default playback start position.
  Seeking before pressing play now works, and a deliberate seek takes precedence
  over the remembered listening position instead of being overridden by it.

## 1.9.1

### Fixed

- Read-aloud narration no longer speaks the title twice. The extractor
  prepends the frontmatter title as the opening sentence but kept a leading
  `# Heading` that repeats it — the same duplicate the rendered page already
  drops (`dropRedundantTitle`). The speech text now drops it too. Note: this
  changes the speech hash of affected posts, so their next enqueue counts as
  new speech text (budget-capped as always).

## 1.9.0

GEO and reader aids: every post is now first-class input for AI tools — and
authors can ship a TL;DR and FAQ without contentkit generating a word.

### Added

- A raw-Markdown twin per indexable post at `/{locale}/blog/{slug}/index.md`
  (title, canonical URL, TL;DR, body — the same block `llms-full.txt` uses),
  served as `text/markdown` and advertised via
  `<link rel="alternate" type="text/markdown">`. `noindex` posts get none.
- An AI share row on posts: a plain link to the Markdown twin (works without
  JS), a copy-Markdown button (revealed by the new hashed `ai-actions.js`)
  and "open in Claude/ChatGPT" deep links that hand the article to the
  *reader's own* assistant — the site never talks to an AI provider. Targets
  are overridable via `settings.ai.share_targets`; the row hides behind
  `settings.ai.share_buttons: false`. Default on, zero configuration.
- Authored frontmatter `tldr` (list of strings) and `faq` (list of `{q, a}`),
  validated at upload: rendered as an open "In short" block above the prose
  and a collapsed FAQ after it, exported to the Markdown twin and
  `llms-full.txt`, fed into the search index, and emitted as JSON-LD
  `abstract` and `FAQPage`.

### Changed

- Post JSON-LD grew `inLanguage`, `keywords`, `image`, `timeRequired`,
  `mainEntityOfPage`, an `AudioObject` for narrated posts and a
  `BreadcrumbList` (emitted as a JSON array in one script tag).
- Header search now ranks instead of filtering: title hits beat summary hits
  beat body hits, title prefixes beat containment; ties stay newest-first.

### Fixed

- The binary e2e test derives the expected migration count from the embedded
  migrations instead of hardcoding it (stale since the audio migration).

## 1.8.0

The read-aloud feed is now the **Blogcast** — product-wide rename from
"Podcast".

### Changed

- URLs: the feed moved from `/{locale}/podcast.xml` to `/{locale}/blogcast.xml`
  and the page from `/{locale}/podcast/` to `/{locale}/blogcast/`. The old URLs
  are gone from new releases — there is no redirect; update subscriptions and
  links.
- Visible labels: the footer item and the head `<link rel="alternate">` title
  fallback now say "Blogcast" (`{site name} · Blogcast`).
- Settings: `settings.audio.blogcast_link`, `blogcast_image` and
  `blogcast_category` replace the `podcast_*` keys. The old spellings are
  deprecated but still read as fallbacks (`blogcast_* ?? podcast_*`);
  `title`/`description` are unchanged.
- Code identifiers and CSS classes follow the rename (`blogcastRss`,
  `blogcastPage`, `ctx.blogcast`, `.blogcast-*`). The `xmlns:itunes` podcast
  RSS namespace and the `<itunes:*>` tags are protocol, not branding, and stay.

## 1.7.0

Podcast page & custom player.

### Added

- A built podcast page per locale at `/{locale}/podcast/` — channel cover,
  title/description from `settings.audio`, a subscribe-via-RSS link and one
  card per narrated post (title, date, duration, summary, player). Emitted
  under the same gate as `podcast.xml` (audio enabled + at least one narrated
  indexable post), independent of `podcast_link`; indexable and in the sitemap.
- A custom audio player (shadcn-style, theme tokens only), shared between
  article pages and the podcast page: round play/pause button, ±15 s skip,
  seek slider with time readout, the existing tempo buttons and download link.
  Progressive enhancement — the native `<audio controls preload="none">` ships
  as the no-JS fallback and audio.js swaps it for the custom bar; the
  remembered listening position stays.

### Changed

- The footer's Podcast item now targets the page (`/{locale}/podcast/`) instead
  of the raw feed; the head `<link rel="alternate">` keeps pointing at
  `podcast.xml`. Gate unchanged (`podcast_link` opt-in + narrated posts).

## 1.6.2

- Podcast links (head alternate + footer) appear only when the feed actually has narrated posts.

## 1.6.1

- Opted-in podcast feeds get a visible footer link next to RSS.

## [1.6.0] - 2026-07-09

Read-aloud: lifecycle & operations.

### Added

- Debounced auto-rebuild: after an audio job finishes, the worker schedules one
  release per site (empty `revision_ids`, reason `audio auto-rebuild`) so the
  player and podcast feed appear without a manual publish. Debounce via
  `CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS` (default 60000, 1s–1h); opt out per
  site with `settings.audio.auto_rebuild: false`. No feedback loop: the enqueue
  hook only fires for releases that carry revisions.
- `DELETE /v1/content/{item}/audio` (`release:write`): removes all audio jobs
  for the item plus the generated MP3s (storage object and `ck_assets` row) and
  schedules an auto-rebuild. Returns
  `{item_id, deleted_jobs, deleted_assets, rebuild_scheduled}`.
- `GET /v1/sites/{site}/audio/jobs` (`content:read`): newest-first job list
  (optionally filtered by `status`, `limit` default 100/max 500) with a
  `summary` of per-status counters, `chars_this_month` (UTC calendar month,
  skipped jobs excluded), `monthly_char_budget` and `budget_remaining`.
- Monthly budget enforcement on auto-enqueue: publishing no longer creates a
  job that would push the month's characters past
  `settings.audio.monthly_char_budget` (logged as `audio budget exhausted`);
  backfill behaviour is unchanged.
- Superseded-asset cleanup: when a force re-render finishes, the previous MP3
  (storage object and asset row) is deleted best-effort at the swap point, so a
  live player never 404s but old narrations no longer accumulate.
- Podcast channel polish: optional `itunes:image` (`settings.audio.podcast_image`,
  absolute URL) and `itunes:category` (`settings.audio.podcast_category`), and
  an opt-in `<link rel="alternate" type="application/rss+xml">` to
  `/{locale}/podcast.xml` in the layout via `settings.audio.podcast_link: true`
  (only on sites with audio enabled).
- Player download link: a quiet "MP3 herunterladen" / "Download MP3" anchor
  (`download` attribute) under the player.
- New guide `docs/audio.md` covering the full read-aloud lifecycle, backfill,
  deletion, job monitoring, budgets and the podcast feed.

## 1.5.1

- Read-aloud backfill accepts an optional `slugs` array to narrow the run to specific posts.
- Read-aloud backfill accepts `force: true` to re-render audio whose speech text is unchanged (voice or provider changes).

## [1.5.0] - 2026-07-09

### Added

- Read-aloud audio ("Vorlesen"): every published post can carry a pre-rendered
  spoken MP3. Publishing a release enqueues one job per post revision in the new
  `ck_audio_jobs` table (additive migration `0004_contentkit_audio`); a
  background worker — started with `CONTENTKIT_AUDIO_ENABLED=true` — extracts
  the speech text from the Markdown (frontmatter, code/mermaid fences, the
  `## Weiterführende Quellen` section, URLs and the italic series line are
  dropped; headings and list items become sentences), synthesizes it with
  Google Chirp 3 HD (chunked ≤3800 bytes, LINEAR16 24 kHz, encoded to 64 kbps
  mono MP3 via the host's `ffmpeg`, path overridable with `CONTENTKIT_FFMPEG`)
  and files the result as a normal content-addressed asset served from `/media`.
- Idempotency by speech-text hash: `UNIQUE(item_id, speech_sha256)` covers the
  *extracted speech text*, not the Markdown source, so editing a code block or
  the sources section never triggers a paid re-synthesis. Sites opt in via
  `settings.audio = { enabled, provider, voice, monthly_char_budget }`; a post
  opts out with frontmatter `audio: false`.
- Post pages with audio render a native player above the prose
  (`preload="none"`, "Diesen Beitrag anhören (X min)"), with a tempo switch
  (1×/1,25×/1,5×) and a remembered listening position per audio URL. The
  `audio.js`/`audio.css` assets load only on pages that have a player.
- Podcast feed at `/{locale}/podcast.xml` (RSS 2.0 + `itunes:` namespace, one
  `<enclosure>` per post with audio), generated only when `settings.audio.enabled`
  and at least one post carries audio. Not linked from the layout.
- `GET /v1/content/{item}/audio` reports the newest audio job and asset URL;
  `POST /v1/sites/{site}/audio/backfill` enqueues jobs for the archive
  newest-first within a character budget (`limit_chars`, falling back to
  `settings.audio.monthly_char_budget`); `dry_run: true` returns the selection
  and a cost estimate without enqueuing.

### Fixed

- `/media` now serves audio content types inline instead of forcing a download;
  without this the read-aloud `<audio>` element could not play its own asset.

## [1.4.0] - 2026-07-09

### Added

- `GET /v1/sites/{site}` returns site metadata and settings. `PATCH` replaces
  `settings` wholesale, so a partial update needs the current object first —
  until now that read was impossible over HTTP and every partial update
  silently dropped the unlisted keys. The route accepts `content:read` or
  `site:admin`, so the key that patches can also read.

## [1.3.2] - 2026-07-08

### Fixed

- The redundant-title heading is now also dropped when the title contains inline Markdown.
  A title such as ``Control Flow vor `async/await` `` is a raw string in the frontmatter but
  renders as an inlineCode node without backticks in the body, so the two never compared
  equal and the duplicate `<h1>` survived. Inline markers are stripped from both sides.

## [1.3.1] - 2026-07-08

### Fixed

- A document whose first block repeats the frontmatter `title` as a level-one heading no
  longer renders a second `<h1>`. The layout already emits the title, so such pages carried
  two `<h1>` elements and started their document outline twice — a meaningful share of the
  posts on a production site did. A body that deliberately opens with a different top-level heading
  keeps it, and a heading that is not the first block is never touched. The authored source
  is unchanged, so `llms-full.txt` and the reading-time estimate are unaffected.

## [1.3.0] - 2026-07-08

### Added

- Tag index at `/{locale}/tags/`, listing every tag with its post count. Tag pills
  have always linked to `/{locale}/tags/{tag}/`, but the index itself was a 404.
- Per-tag RSS feeds at `/{locale}/tags/{tag}/feed.xml` for tags with two or more
  posts, advertised from the tag page. The main feed now emits `<category>` per
  tag and an `<atom:link rel="self">`.
- Post pages show reading time, tag pills, related posts (cosine similarity over
  IDF-weighted tag vectors), older/newer navigation, and `Updated:` when a post
  has been revised.
- Posts older than three years carry a notice that the content may be out of date.
  Set `updatedAt` in the frontmatter to suppress it for another three years.
- `buildSite({ now })` makes build time an explicit input, so builds are
  reproducible and the age notice is testable.
- Each site now generates its own `llms.txt` and `llms-full.txt`
  ([llmstxt.org](https://llmstxt.org/) format), at the root and per locale, listing
  its posts, projects and pages, with the archive, tag index and other locales under
  the spec's `## Optional` section. `llms-full.txt` carries every published
  document's Markdown source. `noindex` content is excluded from both.

### Changed

- `/{locale}/blog/` is now a curated feed: the newest twelve posts as cards, topic
  chips, and a link to the archive. `/{locale}/archive/` is now the full index:
  every post grouped by year, with a jump navigation and client-side tag and
  free-text filtering via a new archive-only `archive.js`. Both previously
  rendered the identical list of every post.
- Tag pages with a single post are emitted as `noindex,follow` and are excluded
  from the sitemap and from per-tag feeds.
- Rendered dates are formatted in UTC, from an explicit locale. Previously the
  build machine's timezone could shift a printed date by a day, and its locale
  decided whether a date read `1.1.2026` or `1/1/2026` — both changed the
  release's asset hashes for identical content. Formatting a date without a
  locale is now an error rather than a silent fall back to the system's.

### Fixed

- `noindex` posts and projects no longer leak into the blog, archive, tag pages,
  the tag index, the home page, the projects listing or the RSS feed. Their own
  pages still render, as before; only listings exclude them.
- Tags whose slugs collide no longer overwrite each other's page. `Node JS` and
  `Node.js` both slugify to `node-js`; previously the last one written won and the
  other tag's posts silently disappeared. They now merge into a single page.
- A tag consisting only of punctuation (slugifying to the empty string) no longer
  writes a file at `{locale}/tags//index.html`.
- Projects no longer render tag pills. Tag pages are built from posts only, so a
  project's pills pointed at URLs that 404.
- `feed.xml` is served as `application/rss+xml`, matching the type every
  `<link rel="alternate">` on the site advertises. It was served as
  `application/xml`.
- The archive, search, contact and tag pages now mark their navigation entry with
  `aria-current="page"`.
- Contentkit's own `/llms.txt`, `/llms-full.txt`, `/openapi.json` and `/metrics` are
  no longer served on published site domains. One deployment hosts the admin API and
  every site; these paths answered on all of them, so every site served the CMS's
  documentation instead of its own `llms.txt`, and handed out unauthenticated
  Prometheus telemetry for the admin API. They are now gated on the request `Host`
  matching `CONTENTKIT_PUBLIC_URL`, like the `/` service descriptor already was.
  `/health` and `/ready` stay reachable on every host for probes. Set
  `CONTENTKIT_PUBLIC_URL` to a hostname you do not also publish a site on.

## [1.2.0] - 2026-07-08

### Changed

- The header navigation no longer links Contact, Impressum or the privacy policy;
  those pages now appear in the footer only. `navOrder` above 60 now means
  "footer legal column only" (previously: footer *and* trailing header nav).
- Search moved out of the header navigation into a `role="combobox"` search field
  in the header itself, with a live results dropdown and full keyboard support. It
  is inline on wide viewports and a full-width second header row below 48rem.
  `/{locale}/search/` remains as a noindex `?q=` deep-link target and is no longer
  linked from the navigation.
- `search.js` now loads on every page and fetches the search index lazily on the
  first interaction with the search field, so a page view costs no extra request.
  Result rows are built via DOM APIs instead of `innerHTML`.

### Fixed

- The empty search result message is now localized instead of always German.
- `404.html` now references the content-hashed stylesheet and scripts; it
  previously pointed at unhashed asset paths that no release contains, so it
  rendered unstyled.
- Preview rewriting now covers `action` attributes, so the header search form no
  longer navigates out of a preview to the production search page.

## [1.1.1] - 2026-07-08

### Added

- Site-level `settings.comments.enabled=false` support to suppress public post
  comment forms while keeping approved comments visible.

### Changed

- Locale search pages are now emitted with `noindex,nofollow` and are omitted
  from the sitemap.
- Search indexes now exclude `noindex` content and only include title, summary
  and tags by default. Full body indexing is opt-in via
  `settings.search.index_body=true`.

### Fixed

- Public comment submissions now return `404` when comments are disabled for a
  site, so stale cached forms cannot continue to submit. Contact forms are
  unaffected.

## [1.1.0] - 2026-07-08

### Added

- Cookie consent for GA4 (`assets/consent.js`): when a site configures the
  `ga4` analytics provider, the Google tag loader is now withheld until the
  visitor gives explicit opt-in consent (§ 25 TDDDG / Art. 6 Abs. 1 lit. a
  DSGVO). The banner is localized (de/en), offers an equally prominent
  "reject all" alongside "accept all", wires up Google Consent Mode, and adds a
  footer "Cookie settings" control so consent can be withdrawn at any time.

### Changed

- The `ga4` provider no longer emits the `gtag/js` loader directly in the head
  or a per-site `assets/analytics.js` init file. The head instead references the
  content-hashed `consent.js`, passing the measurement id via `data-ga-id`, and
  no request reaches Google before consent. Plausible (cookieless) is unchanged
  and still needs no banner.

## [1.0.1] - 2026-07-04

### Changed

- Dependency updates: `@shikijs/rehype` 4.x, `katex` 0.17, and current major
  versions of all GitHub Actions used by CI and the release pipeline.

### Fixed

- A timing race in the build-serialization integration test that could hang
  the suite on slow CI runners.

## [1.0.0] - 2026-07-04

First public release. Contentkit is an API-first Markdown mini-CMS that turns
Markdown revisions into immutable, multilingual static-site releases with
atomic activation and pointer-based rollback.

### Added

- Community files for open source: contributing guide, code of conduct,
  security policy, issue and pull request templates.
- ESLint and Prettier configuration with CI enforcement.
- Unit tests for the site builder, release manager and OpenAPI spec
  (including router/spec consistency checks).

### Changed

- The built-in webhook endpoint is now configured through
  `CONTENTKIT_WEBHOOK_URL` / `CONTENTKIT_WEBHOOK_SECRET` (previously
  `CONTENTKIT_SUBKIT_WEBHOOK_URL` / `CONTENTKIT_SUBKIT_WEBHOOK_SECRET`).
  Deployments must rename these variables.
- The HTTP layer was split into focused modules (`routes`, `security`,
  `server`) without behavior changes.
- The webhook documentation was rewritten around the Standard Webhooks
  specification with a generic receiver example.

### Fixed

- A hex `accent` site setting is converted to an HSL triple before it reaches
  the `--primary` CSS variable; previously a raw hex value silently disabled
  the accent color (e.g. an invisible submit button).
- Tag links on content cards now use the same slug as the generated tag pages;
  multi-word tags previously linked to a non-existent URL.

[1.15.1]: https://github.com/MikeBild/contentkit/releases/tag/v1.15.1
[1.15.0]: https://github.com/MikeBild/contentkit/releases/tag/v1.15.0
[1.2.0]: https://github.com/MikeBild/contentkit/releases/tag/v1.2.0
[1.1.1]: https://github.com/MikeBild/contentkit/releases/tag/v1.1.1
[1.1.0]: https://github.com/MikeBild/contentkit/releases/tag/v1.1.0
[1.0.1]: https://github.com/MikeBild/contentkit/releases/tag/v1.0.1
[1.0.0]: https://github.com/MikeBild/contentkit/releases/tag/v1.0.0
