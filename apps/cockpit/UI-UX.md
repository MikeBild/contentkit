# The Cockpit's interface, decided once

This exists because the console was inconsistent in ways that are cheap to fix
individually and expensive to keep fixing: forty-one cards on one page and no tabs
anywhere near it, a link and two buttons in the same row doing the same kind of
thing, three cards side by side each carrying its own paragraph saying nothing was
measured. Every one of those was a defensible local choice. Together they read as a
console nobody decided.

So this is the decision. It is short on purpose: a rule nobody can recall is a rule
nobody follows. Where a rule can be enforced by a test, the test is named.

---

## 1. What a page is

**One page answers one question.** "What is in this site?" is a page. "What is
happening with audio, decks, compositions, patterns and guides?" is five.

A page has exactly one `<Page title description>` heading. The description is one
sentence and says what the page is *for*, never how it works.

### The container ladder

Pick the first one that fits, going down. Every step down costs the reader
something, so do not start halfway.

| | Use when | Do not use when |
|---|---|---|
| **Nothing** | The page is one list or one form. | — |
| **Tabs** | The page has 2–6 *parallel* concerns about one subject, and the reader looks at one at a time. | The concerns are sequential (→ Steps), or the reader compares them side by side. |
| **Card** | A group of controls or facts that has its own title and can be reasoned about alone. | It is the only thing on the page — then it is the page. |
| **Accordion / Collapsible** | Many sections, most of them rarely opened, and the reader needs to see the *titles* to find one. | Fewer than four sections. |

**Tabs are the default for a page with more than one concern.** They were used in
two files in the whole console while one page carried forty-one cards; that ratio is
the defect this section exists to correct.

A card is not a container for one paragraph. If a card holds one sentence, it is a
sentence.

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
- Nothing is truncated where the space beside it is empty. If a name must be cut,
  the full value belongs in a `title` *and* in the accessible name.

## 7. Responsiveness

The shell is responsive: below 768px the sidebar is an off-canvas sheet. **The pages
largely are not**, and this is written down rather than implied — four of eight
carry no responsive class at all. Until that is fixed, a page is not finished when
it works at 1440px.

Minimum for a new or touched page: it is usable at 390px wide. Tables may scroll
horizontally; nothing else may.

---

## 8. Accessibility, as rules rather than aspiration

- Every dialog has a title, even if it is `sr-only`.
- Focus is trapped while a dialog is open and lands somewhere useful when it closes
  — never on `<body>`.
- A dialog that owns a mutation cannot be dismissed while the request is in flight.
- Every interactive element carries a `data-testid`. This is a standing project
  requirement, not a testing convenience.
- Nothing is conveyed by colour alone. A status has a word; a warning has an icon.

Enforced by `apps/cockpit/src/components/**/*.test.tsx` and
`test/unit/cockpit-dialog-guards.test.mjs`. The behavioural floor in
`test/unit/cockpit-behavioural-floor.test.mjs` names every contract a rendering test
covers, and — deliberately — what is still graded by reading source, so a runner in
the repository is never mistaken for coverage.
