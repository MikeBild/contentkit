# The Cockpit's interface, decided once

This exists because the console was inconsistent in ways that are cheap to fix
individually and expensive to keep fixing: forty-one cards on one page and no tabs
anywhere near it, a link and two buttons in the same row doing the same kind of
thing, three cards side by side each carrying its own paragraph saying nothing was
measured. Every one of those was a defensible local choice. Together they read as a
console nobody decided.

So this is the decision. It is short on purpose: a rule nobody can recall is a rule
nobody follows. Where a rule is enforced by a test, that test is named here — and where
it is not, the rule says so in as many words. A review found this document citing a
test that did not assert the rule beside it, silent about four files that were doing
the real work, and stating an absolute the console breaks forty-four times. A style
guide that is wrong about itself is worse than none, so the marking matters as much as
the rules.

---

## 1. What a page is

**One page answers one question.** "What is in this site?" is a page. "What is
happening with audio, decks, compositions, patterns and guides?" is five.

**And one module exports one page.** This is not pedantry: `authoring.tsx` held five
compliant pages, already mounted at five routes, and every measurement anyone took
read the module. Five good pages in one bucket measured as one bad page, which is
precisely how the defect survived being looked at.

A page has exactly one `<Page title description>` heading. The description is one
sentence and says what the page is *for*, never how it works.

### The container ladder

Pick the first one that fits, going down. Every step down costs the reader
something, so do not start halfway.

| | Use when | Do not use when |
|---|---|---|
| **Nothing** | The page is one list or one form. | — |
| **Tabs** | The page has 2–6 *parallel* concerns about one subject, and the reader looks at one at a time. | The concerns are sequential (→ Steps); the reader compares them side by side; or one panel's controls act on another panel's content — a button whose whole effect is off screen describes itself falsely. |
| **Card** | A group of controls or facts that has its own title and can be reasoned about alone. | It is the only thing on the page — then it is the page. |
| **Accordion / Collapsible** | Many sections, most of them rarely opened, and the reader needs to see the *titles* to find one. | Fewer than four sections. |

**Tabs are the default for a page with more than one concern.** They were used in
two files in the whole console while one page carried forty-one cards; that ratio is
the defect this section exists to correct.

A card is not a container for one paragraph. If a card holds one sentence, it is a
sentence.

Enforced by `test/unit/cockpit-shape.test.mjs`: one module exports one page, a page
with more sibling cards than the ladder allows and no Tabs or Accordion is a stack of
boxes, a tab strip whose triggers answer no panel is unreachable, and a loading branch
renders a Skeleton rather than nothing. `test/unit/cockpit-governance-split.test.mjs`
holds the same rules over the pages that were split out of a bucket module, including
the coupling exception — a page whose panels write into each other must keep saying so.

### What must never happen

- A card whose only content is an empty state. One `Empty` per *surface*, not per
  card: a grid of nine cards each saying "nothing here" is nine times the pixels for
  one fact.
- Nested cards. If something inside a card needs its own frame, the card is a page
  section and the thing inside it is the card.

---

## 2. Actions: button or link

The rule is about **what happens**, never about how it looks.

| Affordance | Means | Examples |
|---|---|---|
| **Link** (`AppLink`, `Button variant="link"`) | Navigation. The URL changes; nothing else does. | Details, a row that opens a record, a breadcrumb |
| **Button** | A change. Something is created, altered, deleted, or a request is sent. | Save, Activate, Delete, New release |
| **Button `variant="destructive"`** | An irreversible change. | Delete, Discard, Unpublish |

Consequences, and they are not optional:

- A row of actions is one kind or the other. "Details · Activate · Delete" with a
  link and two buttons in one row is the exact defect this rule names: three
  affordances, three meanings, one visual grammar. Details navigates → it is a link,
  and it is styled as one, in every row.
- Never a `<div onClick>`. A control that acts is a `<button>`; a control that
  navigates is an `<a>`. Anything else is invisible to a keyboard and to a screen
  reader.
- **One primary action per surface.** `variant="default"` is the thing this page
  exists for. Everything else is `outline` or `ghost`. Two filled buttons side by
  side ask the reader to choose without saying which is which.
Enforced by `test/unit/cockpit-affordances.test.mjs`, and the testid requirement by
`test/unit/cockpit-testids.test.mjs`.

- A button never rewrites its own label while it works. Compose `Spinner` +
  `disabled` and leave the label alone, or the button the reader aimed at is gone by
  the time they arrive.

---

## 3. Words

The console explains a great deal, and that is right — this product has release
semantics nobody guesses. The failure is not that the text exists; it is that all of
it is on screen at once.

| Where | What belongs there | Length |
|---|---|---|
| `Page description` | What the page is for. | 1 sentence |
| `CardDescription` | What this group is, if the title is not enough. | 1 sentence |
| `FieldDescription` | What must be known *before* acting. Unset semantics live here. | 1 line |
| `Tooltip` | A definition, a unit, a shorthand. | ≤ 1 short sentence |
| `Popover` / `HoverCard` | A paragraph, a list of refusal conditions, an example. | As long as it needs |
| `Alert` | A consequence, a warning, a server refusal. | As short as it can be |

Rules:

- **Nothing is deleted to satisfy this.** Prose moves; a reason that existed is a
  reason worth keeping. `test/unit/cockpit-forms-density.test.mjs` enforces both
  halves: the count must fall *and* the text must still be reachable.
- A native `title=` attribute is not a tooltip. It is invisible on touch and
  unreachable by keyboard.
- Two sentences in a row on screen means one of them belongs behind an affordance.

---

## 4. State, severity and colour

Never a raw chart colour for a severity. `bg-chart-3` on a warning is a graph
series' name doing a warning's job: it renders identically, so nothing on screen says
it is wrong, and the source reads as though a chart leaked into a save bar.

| Meaning | Token | Component |
|---|---|---|
| Failure, refusal, irreversible | `destructive` | `Alert variant="destructive"`, `Badge`, `Button` |
| Needs attention, accepted but questionable | `warning` | `Alert`, `StatusBadge tone="warning"` |
| Done, healthy, passed | `success` | `StatusBadge tone="success"` |
| A quantity in a chart | `chart-1…5` | charts, sparklines, diff rows |

Enforced by `test/unit/cockpit-lists.test.mjs`, which exempts the two genuine data
uses by name.

**A value nobody sent is not zero.** `—` for a missing number, never `0`. A
measured zero and an unmeasured value are different facts and must read differently.

---

## 5. The four states of anything that loads

Every list, every panel, every tile has four, and they must be four visibly
different things:

1. **Loading** — `Skeleton` in the shape of the result. Never the word "Loading…",
   which is one line high where the result is forty.
2. **Error** — `Alert variant="destructive"` with `role="alert"`, carrying the
   server's own words. A refusal names counts; rewriting it drops them.
3. **Empty** — `Empty` with a title, a description and, where one exists, the action
   that fills it.
4. **Result.**

An empty result and a failed request must never look the same. That is the whole
reason this is written down.

---

## 6. Layout

- The console is an app shell: **the panes scroll, the document does not.** Every
  element between `body` and the scrolling pane must be bounded to the viewport.
  Enforced by `test/unit/cockpit-scroll-containment.test.mjs`, which exists because
  an unbounded wrapper once made nine tenths of a page unreachable with no scrollbar
  to say so.
- Spacing is `flex` + `gap-*`. Never `space-y-*`.
- A table wide enough to overflow scrolls inside its own container, never by pushing
  the page sideways.
- **A list is a `DataTable`.** It carries the four states, cursor pagination, the
  column chooser and the sort-capability rule in one place. `Card` + `Table` +
  `TableState` is the older hand-rolled shape; it is not wrong, but it is a second
  answer to "how do I render a list", and a console with two answers has none. New
  lists use `DataTable`; existing ones move when they are next touched.
- **Prefer not to truncate.** Give the text the space — `max-w-*` with `break-words`,
  or let the secondary value wrap beneath the primary one. An earlier version of this
  rule said a cut name may keep its full value in a `title`; that contradicts §3 and is
  enforced against by `test/unit/cockpit-forms-density.test.mjs`, so it is withdrawn.

  **Stated honestly: `truncate` appears 44 times in `apps/cockpit/src` today.** This is
  a direction, not a law, and no test enforces it — writing it as an absolute while the
  console breaks it four dozen times is how a style guide stops being believed. Where a
  cut is unavoidable, the full value must be reachable some way that is not a `title`:
  the accessible name, a Tooltip, or the row expanding.

## 7. Responsiveness

Minimum for a new or touched page: **usable at 390px wide.** A table may scroll
horizontally inside its own container; nothing else may, and a table may not take
the row's own controls with it.

### The count of responsive classes was the wrong measurement

Two earlier versions of this section counted `sm:`/`md:` prefixes in `src/pages`
and reported the console mostly unresponsive — "four of eight", then nine of
sixteen. The number was accurate and it measured nothing. Seven of the nine pages
it named are composition shells thirty to a hundred lines long: `access.tsx` is
three `<Card>`s in a `flex-col`, `moderation.tsx` and `webhooks.tsx` are a tab
strip over cards. They carry no responsive class because they carry almost no
layout. The layout is in `Page`, `Card`, `Table`, `Tabs` and `src/forms`, and the
forms have been mobile-first all along — every grid in them is `sm:grid-cols-2`,
which is already the collapsed-at-390 spelling.

So the console was driven at 390 instead, every route and every dialog
(`scripts/validate-cockpit-browser.mjs`). What that found, and what is now true:

| Measured at 390 | Was | Is |
|---|---|---|
| Row actions in lists | `Edit`/`Revoke`/`Approve`/`Delete` 370–1400px off the right of the window on **every** list — the tables are 713px (groups) to 1749px (webhook endpoints) inside a 342px container, and the last column is the actions on all of them | The last cell is pinned to the right edge below `md`, bounded to `max-w-36` so it cannot eat the identity column |
| Dialog footers | Four dialogs put their own answer below the fold at 390×667; `ck-api-key-dialog` laid out 1406px of form in a 635px panel and left Create 700px past a window that cannot scroll | The panel's middle row gives, so the body scrolls and the footer stays |
| The wizard's step strip | Scrolled sideways at every viewport; at 390 steps 3 and 4 were 219px and 361px past the window | Wraps |
| Tab strips | Adding counts took the moderation strip to 349px inside 342px | Wrap |
| The page header | A 100px action button and its gap took 116px of a 342px row, wrapping descriptions in 226px | Actions take their own row below `sm` |
| Page bodies, the content detail, site-settings' nine sections | — | Measured clean; nothing was changed |

Every row above is held by a case at 390 in the browser suite, so this table
cannot quietly stop being true.

### What is still true and is not fixed

A list at 390 is a table two to five times the width of the window, and pinning
its actions does not change that: on `/moderation` a row is 257px tall because
the comment being moderated is off to the right, so the page whose job is reading
a comment shows an author and whitespace. Letting cells wrap below `md` was
measured — it takes moderation from 943px to 703px and webhooks from 1749px to
886px, at the cost of row heights of 77–257px — and it is a trade, not a fix.
**The honest statement is that lists are reachable at 390 and not yet readable
at it.** The answer is a row that stacks below `md` rather than a table that
scrolls, and that is a change to `DataTable` and the nine hand-rolled lists §6
already wants moved onto it — not a class.

---

## 8. Accessibility, as rules rather than aspiration

- Every dialog has a title, even if it is `sr-only`.
- Focus is trapped while a dialog is open and lands somewhere useful when it closes
  — never on `<body>`.
- A dialog that owns a mutation cannot be dismissed while the request is in flight.
- Every interactive element carries a `data-testid`. This is a standing project
  requirement, not a testing convenience.
- Nothing is conveyed by colour alone. A status has a word; a warning has an icon.

Enforced, rule by rule rather than by a blanket claim, because an earlier version of
this paragraph credited two files with a rule neither of them asserts:

| Rule | Enforced by |
|---|---|
| A dialog has a title | `test/unit/cockpit-confirm.test.mjs` |
| Focus trapped, restored, never on `<body>` | `apps/cockpit/src/components/confirm.test.tsx` |
| A mutation dialog resists dismissal in flight | `test/unit/cockpit-dialog-guards.test.mjs` |
| Every interactive element has a `data-testid` | `test/unit/cockpit-testids.test.mjs` |
| Nothing is conveyed by colour alone | **nothing — aspirational** | The behavioural floor in
`test/unit/cockpit-behavioural-floor.test.mjs` names every contract a rendering test
covers, and — deliberately — what is still graded by reading source, so a runner in
the repository is never mistaken for coverage.
