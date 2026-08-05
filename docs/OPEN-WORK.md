# The four open items, and how each is finished

Written after 4.9.0 shipped. Each item states what is actually wrong — measured, not
remembered — what "done" means, and what could go wrong doing it.

**Implementation order is not the reading order.** Item 2 is built first, because
items 1 and 3 are claims that only a browser can check: until something drives the
console at a real viewport, "the tab shows a count" and "the page works at 390px" are
assertions about source text. The reading order below is the order of visible value;
the build order is **2 → 1 → 3 → 4**.

---

## 1. Four of six tab strips carry no count

### What is wrong

`moderation.tsx`, `webhooks.tsx`, `credentials.tsx` and `published.tsx` pass no
`badge` to `Tabs`. `compositions.tsx` and `content.tsx` do. A moderator on Comments
cannot see that twelve contact submissions are waiting.

This is a regression **introduced by the consistency pass**: stacked, those lists were
below the fold; behind a tab they are behind a door with no number on it. The same
commit range added counts to two other strips, so the console is now inconsistent in
the way the pass existed to remove.

### Why it was not done with the rest

The three moderation lists query with different shapes:

| list | query key | filter |
|---|---|---|
| comments | `keys.moderation.comments(siteId, query)` | a status filter held in the card |
| contact | `keys.moderation.contact(siteId)` | none |
| feedback | `[...keys.moderation.feedback(siteId), post]` | a post filter |

Only `contact` dedupes against a page-level query. For the other two the card's key
carries filter state the page does not have, so a page-level count is a **second
request**, not a free read.

### What done means

The badge shows **what is waiting**, not the size of the current filtered view — that
is the number a moderator needs and it is a different question from what the card
renders. `GET /v1/comments` takes a `status` parameter, so the pending count is one
narrow query; contact and feedback have no status and need a count of the whole list.

1. A `useTabCounts(siteId)` hook next to each page, one query per tab, `staleTime` long
   enough that switching tabs does not refetch, and `enabled` gated on the scope the
   page already checks.
2. The badge renders only when the count is **known and non-zero**. A `0` badge is
   noise; a badge on a failed query is a lie. Absent is the third state and it must be
   distinguishable from zero — the same rule §4 of UI-UX.md states for every number.
3. `published.tsx` and `credentials.tsx` are cheaper: their panels already hold the
   lists, so the count can be lifted from the query the panel makes rather than added.

### Risks

Three extra requests per page load, on a page an operator opens to do one job. Mitigate
by fetching counts only for the tabs **not** currently open — the open tab's own list
already answers it — and by accepting a stale count for the duration of a visit.

### Verified by

A Playwright case (item 2): open `/moderation`, assert the Contact tab shows a count
matching what the Contact panel lists when opened. That is the assertion no source
test can make.

---

## 2. Nothing drives the console in a browser

### What is wrong

`jsdom` performs no layout. `clientHeight` is `0` there, so the entire class of
layout defects is invisible to the 79 rendering tests. This is not theoretical: an
unbounded shell wrapper made nine tenths of the releases page unreachable in 4.8.0,
with no scrollbar to say so, and shipped past 1078 source tests, 79 DOM tests and six
adversarial reviews. It was found by a user.

`playwright` is already a devDependency and `scripts/validate-*-browser.mjs` is the
established pattern — three of them run inside `npm run validate:visuals`. They drive
**built site output**, never the console.

### What done means

`scripts/validate-cockpit-browser.mjs`, following the existing three in shape, plus a
`cockpit:e2e` job in CI.

**The hard part is not Playwright, it is the fixture.** The console needs an API and a
session. Three options, in order of preference:

1. **Against the local stack.** `npm start` boots Postgres on 127.0.0.1:55432 and the
   API on 4050, and `scripts/test-e2e-local.sh` already does this for the binary.
   Real server, real session, real data. Slowest, and the one that would have caught
   the scroll defect.
2. **Against a static build with a stubbed API.** Serve `assets/cockpit` and intercept
   `/v1/*` with `page.route()`. Fast, hermetic, and enough for layout, responsiveness
   and keyboard paths — which is what this exists for.
3. Against production. **No.** A test that writes to a live site is not a test.

Start with (2) because it makes the suite cheap enough to run on every push, and add
(1) for the handful of cases that need a real session.

### The cases, and why each

| Case | Why a browser is required |
|---|---|
| Every route scrolls when its content exceeds the viewport | The 4.8.0 defect, exactly |
| No page scrolls the document itself | `body` is `overflow:hidden`; a page that beats it breaks the shell |
| Nothing overflows horizontally at 1280, 768 and 390 | Layout, unmeasurable in jsdom |
| The sidebar becomes a sheet below 768 and its trigger opens it | The mobile claim in §7 |
| Tab counts match their panel's list (item 1) | Two surfaces, one number |
| The collapsed rail shows a tooltip for every entry | Hover state, no layout in jsdom |

### Risks

A browser suite that is slow or flaky gets skipped, and a skipped gate is worse than
none because it looks like coverage. Keep it under a minute, run it on every push, and
if a case is flaky **delete it** rather than retry it.

---

## 3. Nine of sixteen pages carry no responsive class

### What is wrong

`access`, `assistant`, `audio`, `content`, `credentials`, `moderation`,
`site-settings`, `sites`, `webhooks`. The shell is responsive — below 768px the sidebar
is an off-canvas sheet, which came free with shadcn — but the pages were never designed
for narrow, and **nobody has ever opened this console on a phone**, including me: my
attempt to drive a 390px viewport did not take, so §7 of UI-UX.md is written from
source and the DOM, not from use.

### What done means

Per UI-UX.md §7: usable at 390px. Tables may scroll horizontally; nothing else may.

1. Item 2's viewport case, run at 390, produces the real list of what breaks. Fix that
   list rather than sprinkling `sm:` prefixes at nine files.
2. The likely shapes, from reading: two-column form grids that should collapse; action
   rows that should wrap; the wizard's step strip; fixed `min-w` on filter selects.
3. `site-settings.tsx` is the hardest — nine accordion sections of dense fields — and
   should be done last, when the pattern from the other eight is known.

### Risks

"Responsive" without a device is guesswork. This item is **blocked on item 2** and
should not be started before it, or it will be another set of claims.

---

## 4. Four unrelated backend items

### 4a. The release build blocks the event loop

**Measured:** a 103.7s build during which unrelated requests got no response for over
twenty seconds. One deploy verification lost a `DELETE` that landed server-side 37
seconds after the client gave up.

**Cause:** `releases.mjs` builds in the API process. There is no Worker and no fork —
`grep` for `worker_threads|child_process` in `releases.mjs` and `site-builder.mjs`
returns nothing. `renderMarkdown` is awaited per item, so the loop does yield, but
Shiki, KaTeX and ECharts are CPU-bound between those yields and a site with hundreds of
documents holds the thread for seconds at a time.

**Done:** the build runs off the request thread. `deck-renderer.mjs` already spawns a
child process for Slidev, so the precedent and the supervision code exist. A
`worker_threads` Worker is the lighter option and keeps the storage client in-process;
a child process is the more isolating one and matches the deck path. Decide by
measuring both against a real site, not by preference.

**Verified by:** a load case that fires `GET /health` every 200ms through a full
build of a large site and asserts no response exceeds a threshold. This is the only
item here whose fix can be proven with a number.

### 4b. No asset upload endpoint

**Measured:** `docs/openapi.json` has exactly two `multipart/form-data` operations —
`POST /v1/sites/{site}/content` and `PUT /v1/content/{item}/revisions` — and both take
one part, `document`, a Markdown file. There is no media store.

The console has a `Dropzone` component that emits `File[]` and deliberately makes no
request, and the date picker's `Calendar` was removed again because nothing imported
it. Assets are entered as URLs.

**Done:** either an endpoint and a store, or the honest removal of the Dropzone. This
is a product decision about whether ContentKit hosts media at all, not a bug, and it
should be decided before it is built.

### 4c. Sorting is client-side only

**Measured:** `GET /v1/sites/{site}/content` takes `site`, `kind` and `locale`, returns
a bare array, and passes no `limit` to the repository. So the list is genuinely
unpaged, the printed total is true, and client-side sorting covers everything — today.
The moment that endpoint grows a cursor, every sort silently becomes a sort of one
page, and `DataTable` already refuses to offer a sort it cannot honour.

**Done:** `sort` and `order` parameters on the endpoint, or a written decision that
the list stays unpaged. The current state is correct and fragile, which is the worst
combination to leave undocumented.

### 4d. `canary` has no locale rows

**Measured:** `GET /v1/sites/canary` returns `locales: []`. `buildSnapshot` falls back
to `default_locale`, so it builds — the site is not broken, its record is incomplete.
Since 4.7.0 the console can add the row, and since the last fix the menu offers `de`.

**Done:** add the `de` row through the console. One click, on a site the deploy
pipeline writes to on every run. It is listed here so it is not forgotten, not because
it is hard.

---

## What this plan does not contain

- Anything that would need a production write beyond 4d.
- A rewrite of what 4.9.0 just settled. The container ladder, the affordance grammar
  and the page split are done and tested; this list is what is left, not a second
  opinion about what is finished.
