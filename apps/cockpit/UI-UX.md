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

The family-level behaviour contract is [Cockpit Convention 1.4](../../COCKPIT-KONVENTION.md),
the German source in the repository root. It complements this product-specific
component and layout guide. A shortened English translation for operators is
[docs/COCKPIT_CONVENTION_EN.md](../../docs/COCKPIT_CONVENTION_EN.md) — a reading aid,
not the standard; where the two differ, the German source wins. In ContentKit the
convention means, concretely:

- Overview is ordered as Decisions, Release Chain, Recent Activity; HTTP, MCP and
  p95 live on System.
- Draft capture has no required metadata. Decisions is the separate triage step.
- Drafts, moderation and preview promotions share one current-state queue; Audit
  keeps the append-only history.
- Promotion review uses one server-side review id bound to an immutable release and
  manifest. Its diff card may inspect and reject; activation remains the explicit
  browser gate.
- Collection rows show summaries, data-derived categories and destructive actions
  only in confirmed overflow menus.
- Credentials are a permission inventory: last use first, age and never-used state
  visible, with enforced authorization described as a Boundary.
- Site switching groups Production, Canary and Test and can hide Test.

These are product-neutral ContentKit rules. Dogfooding tenants may verify them but
do not contribute tenant-specific nouns or behaviour to the core.

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
- `default` uses `primary` (neutral black in the light scheme, neutral white in
  the dark scheme). Blue is reserved for links, focus and data; a blue filled
  action is not a second primary-button system.
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
- Tables use the pane they have: cells wrap at desktop widths and rows become
  labelled records below 640px. A data list never introduces a second horizontal
  navigation axis.
- **A list is a `DataTable`.** It carries the four states, cursor pagination, the
  column chooser and the sort-capability rule in one place. `Card` + `Table` +
  `TableState` is the older hand-rolled shape; it is not wrong, but it is a second
  answer to "how do I render a list", and a console with two answers has none. New
  lists use `DataTable`; touched list surfaces migrate rather than adding another
  hand-written variant.
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

Minimum for a new or touched page: **usable at 390px wide.** Nothing scrolls
horizontally. Below 640px, every table row stacks into label/value pairs and keeps
its controls in the normal vertical reading order.

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
| Tables and row actions | `Edit`/`Revoke`/`Approve`/`Delete` were 370–1400px off the right of the window; pinning that last cell still left the data two to five windows wide | Below 640px, rows are labelled records with actions at the end. At wider widths the native table uses fixed layout and wrapping, so neither the data nor its controls scroll sideways |
| Dialog footers | Four dialogs put their own answer below the fold at 390×667; `ck-api-key-dialog` laid out 1406px of form in a 635px panel and left Create 700px past a window that cannot scroll | The panel's middle row gives, so the body scrolls and the footer stays |
| The wizard's step strip | Scrolled sideways at every viewport; at 390 steps 3 and 4 were 219px and 361px past the window | Wraps |
| Tab strips | Adding counts took the moderation strip to 349px inside 342px | Wrap |
| The page header | A 100px action button and its gap took 116px of a 342px row, wrapping descriptions in 226px | Actions take their own row below `sm` |
| Page bodies, the content detail, site-settings' nine sections | — | Measured clean; nothing was changed |

Every row above is held by a case at 390 in the browser suite, so this table
cannot quietly stop being true.

The stacked presentation keeps the native `<table>` and its headers in the DOM;
only the visual layout changes. `Table.mobileLabels` is required, so a new table
cannot silently ship a narrow layout whose values have no visible names.

---

## 8. Accessibility, as rules rather than aspiration

- Every dialog has a title, even if it is `sr-only`.
- Focus is trapped while a dialog is open and lands somewhere useful when it closes
  — never on `<body>`.
- A dialog that owns a mutation cannot be dismissed while the request is in flight.
- Every interactive element carries a `data-testid`. This is a standing project
  requirement, not a testing convenience.
- Nothing is conveyed by colour alone. A status and a warning always have words;
  Alerts additionally carry their severity icon.

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

---

## 9. Product-family grammar

ContentKit shares the Cockpit grammar used by WorkKit, CodeKit, Subkit, WatchKit
and WikiKit: the same shadcn primitives and semantic tokens, one viewport-bound
shell, one account menu in the sidebar footer, wrapping tabs, compact cards and
one neutral primary action per surface. A user moving between products should not
have to relearn where navigation, personal settings, help or destructive actions
live.

ContentKit stays recognizable through its work, not through a second button
palette: the publishing lifecycle, document preview, release chain, composition
registry and editorial language are its signature surfaces. Shared controls do
not get product-specific colours or geometry.

The reviewed WikiKit knowledge spaces currently contain no approved Cockpit
design rule. This document therefore records only conventions verified in the
local sibling implementations and the shared Cockpit contract; it does not
attribute invented rules to WikiKit.

## 10. Identity and personal settings

The signed-in user's footer control is the only home for personal settings. Its
menu contains the readable identity summary, Profile, Language (Automatic,
English, German), Appearance (System, Light, Dark) and Sign out. Theme and locale
toggles do not appear as unrelated controls elsewhere in the shell.

Roles are translated display labels. Provider identifiers, session subjects,
database IDs and UUIDs are transport data, not interface copy. When no readable
name exists, say that the item is unavailable or show an aggregate count; never
print an opaque identifier as a fallback.

## 11. Test and language contracts

- Every control has a stable `data-testid`; every repeated row and row action
  appends its visible position. UUIDs, tokens, hashes, provider subjects and
  personal data never become selectors. Enforced by
  `test/unit/cockpit-testids.test.mjs`.
- English and German catalogs have exactly the same keys and placeholders.
  Visible product copy, placeholders and accessible labels must come from the
  catalog; technical syntax is the only explicit exception. Locale preference
  supports automatic browser detection plus manual English/German selection.
  Enforced by `apps/cockpit/src/lib/i18n.test.ts`.
- Icon-only actions use one icon, a localized accessible name and the same short
  label in a hover/focus Tooltip. Definitions use Tooltip; multi-sentence help
  uses Popover. One field label gets one help trigger, never stacked help icons.

## 12. Entscheidungs-Grammatik

Wortgleiche Kopie von §8 der Cockpit-Konvention v1.4 (`COCKPIT-KONVENTION.md` im Repo-Root). Sie steht hier, weil die Entscheidungs-Seite dieses Produkts an ihr gemessen wird; der Maßstab hat eine Quelle und keine abweichenden Kopien (§13).

### 8. Entscheidungs-Grammatik

Jedes Produkt, das menschliche Entscheidungen sammelt (Freigaben, Reviews, Budget-Gates, Proposals), hat **eine** Entscheidungs-Seite. Sie beantwortet die drei Fragen in dieser Reihenfolge: Was passiert? Braucht es mich? Was tue ich dann? WorkKit ist die Referenz-Implementierung; jedes Produkt kopiert das Muster in eigene Komponenten (kein Import).

**8.1 Navigation.** Der Eintrag steht ungruppiert direkt unter der Übersicht und trägt einen Live-Zähler (offene Positionen, dedupliziert). Der Zähler kippt auf rot, sobald eine Position abgelaufen ist oder ein Health-Problem enthalten ist. Produktname des Eintrags einheitlich: „Entscheidungen".

**8.2 Queue.** Eine Spalte, max-w ~780 px. Default-Sortierung: ablaufend zuerst, dann älteste zuerst. Positionen älter als 3 Tage stehen in einer eigenen Rubrik „Liegt schon länger". Filter-Chips nach Art, Gruppieren-Umschalter (Keine / Art / Verursacher), Persistenz lokal.

**8.3 Zeile.** Meta-Zeile (Status-Glyph + Art-Badge · Quell-Referenz als Link · Frist „Entscheiden bis …" wo vorhanden, mit Herkunft) → Titel (line-clamp-2, nie UUID) → Wirkung in einer Zeile → Quellzeile. Aktionen rechts unten: Buttons benennen die Handlung („Freigeben", „Ablehnen", „Änderung anfordern" — nie „OK"). Ablehnung klappt ein Notizfeld in der Zeile auf. Entscheidung verlässt die Seite nie; Optimistic-Hide + Toast, Fehler bringt die Zeile zurück. ⋯-Menü: Später erinnern (Presets + eigener Zeitpunkt) · Dauerhaft verwerfen (mit Bestätigung; wenn endgültig, sagt die UI das) · Quelle öffnen.

**Drei Arten von Nein.** Wo das Produkt sie kennt, unterscheidet die Zeile: Ablehnung **mit** Begründung (schickt zurück ans Nacharbeiten) · Ablehnung **ohne** Begründung (beendet) · **Verwerfen** (folgenlos — als „folgenlos" beschriftet). Eine unbeantwortete Frist verfällt sichtbar als „verfallen (nicht entschieden)", nie stillschweigend. Ein wiederholter identischer Vorschlag zeigt die frühere Ablehnung samt Begründung — die Oberfläche bohrt nicht nach, bis der Mensch ja sagt. Wo Auftraggeber und Freigeber getrennte Rollen sind, zeigt die Zeile, wer entscheiden darf; die eigene Beauftragung ist markiert.

**8.4 Aufklappen.** Zeilen mit mehr Kontext tragen unten links einen benannten Toggle („Mehr anzeigen"), nie einen nackten Chevron. Aufgeklappt: volle Begründung, Rohdaten der Quelle, ggf. Formular für strukturierte Rückfragen. Die Entscheidungs-Buttons wandern ins Panel (kollabiert Kompakt-Form, expandiert Voll-Form).

**8.5 Regale.** Unter der aktiven Queue: einklappbare Sektionen „Zurückgestellt" (mit Wiedervorlage-Zeit), „Verworfen", „Entschieden" — gedimmt, mit Rückhol-Aktion wo die API es erlaubt. Grundsatz dahinter: **Zustand und Geschichte sind getrennte Flächen.** Die Queue zeigt nur den aktuellen Zustand (Erledigtes verschwindet, nichts wird durchgestrichen); die vollständige Geschichte wohnt im Audit/Aktivitätsprotokoll (append, nie gekürzt).

**8.6 Leere.** Nie etwas offen: grüner Check, „Alles erledigt" + „Gerade wartet keine Entscheidung auf dich." Nur weggefiltert: eigene, kompaktere Meldung mit Hinweis auf die Filter. Beide getrennt testbar (§4 gilt).

**8.7 Incident-Banner.** Die Übersicht zeigt oberhalb aller Kacheln einen nicht schließbaren roten Banner, sobald ein Budget-/Health-Gate offen oder eine Frist gerissen ist — mit konkreten Zahlen und Link auf die Entscheidungs-Seite. Ein Dashboard, das bei offenen Gates Ruhe meldet, ist ein Konventionsbruch.

**8.8 Produkt-Spezifisch bleibt:** die Arten (Kinds) und ihre Badges, die Resolver-Formulare, die Quell-Referenzen. Familienweit sind Struktur, Sprache, Sortierung, Regale, Leere-Zustände und der Banner-Vertrag.
