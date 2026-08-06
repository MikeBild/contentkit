# cockpit-ui

Contract: cockpit-ui
Tokens-File: contract/cockpit-ui.css
Tokens-Digest: sha256:4ca18a25cbcfa991384c86a72051c5651b1a8861594486ed902145781d47a36e
Rules-Digest: sha256:db3fd7e6323ef8cbf4c29707de08f34d577ae1c2bee4950c2a12ad198253492c

This file is byte-identical in every product that implements `cockpit-ui`.
Nothing imports it. It is law, carried by copy.

## What this is, and what it is deliberately not

ContentKit and WatchKit are separate products. Separate servers, separate
databases, separate OIDC clients, separate binaries, separate releases. That does
not change and this contract does not ask it to.

What they share is a **look, a user flow and a design system** — and until this
file existed they shared it by coincidence. Two `index.css` files declared 75
custom properties each, 74 of the names matched and every matched value was
identical, held together by nothing but two developers having copied the same
block. That drifts on the next commit and nobody notices until the two consoles
look like two products.

So: three files are shared, all of them text, none of them code.

| | |
|---|---|
| `contract/COCKPIT-UI.md` | this file — the rules, each with an ID |
| `contract/cockpit-ui.css` | the token bytes |
| `contract/RITUAL.md` | how a change to either one travels |

There is **no shared package, no shared component, no shared build and no shared
deployment.** A product implements this contract with its own code. Where the
product genuinely needs to differ, it differs, and says so in its own
`apps/cockpit/UI-UX.md`.

This file **never names a test.** Enforcement is per-product and lives in
`contract/conformance.cockpit-ui.json`, which maps each rule ID to the local
test that holds it — or to nothing, with a stated reason. That file is
deliberately *not* identical between products: it is the honest record of what
each one actually enforces, and an empty `enforced_by` with a real `why` is a
truthful entry, not a gap to be papered over.

## 1. Tokens

- **CUI-TOKEN-1** — The three regions delimited by the `cockpit-ui` sentinels
  in `apps/cockpit/src/index.css` are byte-identical to `contract/cockpit-ui.css`:
  `tokens-light`, `tokens-dark`, `theme-map`, in that order.
- **CUI-TOKEN-2** — The names declared in `tokens-light` are exactly the names
  listed below.
- **CUI-TOKEN-3** — A custom property declared outside the sentinels carries the
  product's prefix (`--ck-`, `--wt-`). The type stack of §2 is the only exception.

The tokens are shadcn's **names** with the family's **values**, so a component
pasted from the registry works unmodified in either console and still looks like
it belongs there.

### Names

```
background, foreground, surface, card, card-foreground, popover,
popover-foreground, primary, primary-foreground, secondary,
secondary-foreground, muted, muted-foreground, accent, accent-foreground,
destructive, warning, success, border, input, ring, chart-1, chart-2, chart-3,
chart-4, chart-5, radius, sidebar, sidebar-foreground, sidebar-primary,
sidebar-primary-foreground, sidebar-accent, sidebar-accent-foreground,
sidebar-border, sidebar-ring
```

### There is no version number

The identity of this contract is the digest of its bytes, and `Tokens-Digest`
above is it.

A version number was tried and removed. It existed so that a product which had
NOT yet taken a change would fail loudly rather than render a component unstyled
— but `RITUAL.md`'s first rule is that a change lands in every product in one
wave, so that lagging product does not exist. What the number actually bought was
a second thing to keep in step, hand-typed, which is precisely the failure it was
meant to prevent: four repositories can all claim the same version while their
bytes diverge, and for a while the auth funnel's `content="2"` did exactly that.

So: any change to `contract/cockpit-ui.css` is a new digest — a changed value, an
added name and a removed name alike — and the wave lands together.

## 2. Type

- **CUI-TYPE-1** — `--font-sans` carries the family stack, compared by normalised
  value and never by bytes. It lives **outside** the sentinels: one product's
  formatter wraps the declaration and the other's does not, and a contract a
  formatter can break is a contract nobody keeps. Further families
  (`--font-mono`, `--font-heading`) are the product's own.

## 3. Theme

- **CUI-THEME-1** — The operator's choice is one of `light`, `dark`, `system`,
  stored under `<prefix>-cockpit-theme`. The prefix is the product's.
- **CUI-THEME-2** — `system` is the **absence** of the stored key, never the
  string `"system"`. A stored word and an unexpressed preference are different
  facts.
- **CUI-THEME-3** — A blocking pre-paint script applies the resolved scheme
  before first paint. The console never renders a frame in the wrong scheme.
- **CUI-THEME-4** — The resolved scheme is carried by the `dark` class on the
  document element.
- **CUI-THEME-5** — Signing out does not reset the theme.

## 4. Mount and delivery

- **CUI-MOUNT-1** — The console is served under the `/cockpit` path prefix of the
  product's own origin, so the session cookie is same-origin and no CORS or
  bearer token is involved.
- **CUI-MOUNT-2** — Fingerprinted assets are immutable; `index.html` is `no-cache`.
- **CUI-MOUNT-3** — Unknown paths under the prefix fall back to `index.html`.
- **CUI-MOUNT-4** — The console runs under a strict CSP. The pre-paint script of
  CUI-THEME-3 is the only inline script.

## 5. Markers

- **CUI-MARK-1** — The served `index.html` declares
  `<meta name="cockpit-ui-contract" content="cockpit-ui">` and
  `<meta name="cockpit-ui-digest" content="sha256-…">`, the latter **derived at
  build time from the bytes of the tokens file** and never hand-typed.
- **CUI-MARK-2** — The shell's outermost element carries `data-cockpit-ui`.

No test inside one repository can prove its bytes match an absent sibling's. The
derived digest is what makes divergence *visible* instead: two products serving
different bytes announce different strings, in the DOM, in every screenshot.

## 6. What a page is

- **CUI-PAGE-1** — One page answers one question.
- **CUI-PAGE-2** — One module exports one page.
- **CUI-LADDER-1** — Pick the first container that fits, going down: nothing →
  tabs → card → accordion. Every step down costs the reader something.
- **CUI-LADDER-2** — A card is not a container for one sentence, and cards do not
  nest. If something inside a card needs its own frame, the card is a page section.
- **CUI-LADDER-3** — One empty state per surface, not per card.

## 7. Actions

- **CUI-ACT-1** — A link navigates: the URL changes and nothing else does. A
  button changes something.
- **CUI-ACT-2** — A row of actions is one kind or the other.
- **CUI-ACT-3** — Never a `<div onClick>`. A control that acts is a `<button>`; a
  control that navigates is an `<a>`.
- **CUI-ACT-4** — One primary action per surface.
- **CUI-ACT-5** — A button never rewrites its own label while it works. Compose a
  spinner with `disabled` and leave the label alone, or the button the reader
  aimed at is gone by the time they arrive.

## 8. Words

- **CUI-WORDS-1** — Each surface carries the length it is for: a page description
  is one sentence about what the page is *for*; a field description is what must
  be known before acting; a tooltip is a definition, a unit or a shorthand; a
  popover is a paragraph; an alert is a consequence.
- **CUI-WORDS-2** — A native `title=` attribute is not a tooltip. It is invisible
  on touch and unreachable by keyboard.

## 9. Severity and colour

- **CUI-SEV-1** — A severity never wears a chart series' name. `destructive`,
  `warning`, `success` — never `chart-N`. It renders identically, which is
  exactly why nothing on screen says it is wrong.
- **CUI-SEV-2** — A value nobody sent is not zero. `—` for a missing number,
  never `0`. A measured zero and an unmeasured value are different facts and must
  read differently.

## 10. The four states of anything that loads

- **CUI-LOAD-1** — Loading is a skeleton in the shape of the result, never the
  word "Loading…", which is one line high where the result is forty.
- **CUI-LOAD-2** — An error carries the server's own words, with `role="alert"`.
  A refusal names counts; rewriting it drops them.
- **CUI-LOAD-3** — An empty state has a title, a description and, where one
  exists, the action that fills it.
- **CUI-LOAD-4** — An empty result and a failed request never look the same.

## 11. Layout

- **CUI-LAYOUT-1** — The console is an app shell: the panes scroll, the document
  does not. Every element between `body` and the scrolling pane is bounded to the
  viewport.
- **CUI-LAYOUT-2** — Spacing is `flex` + `gap-*`.
- **CUI-LAYOUT-3** — A table wide enough to overflow scrolls inside its own
  container, never by pushing the page sideways.

## 12. Responsiveness

- **CUI-RESP-1** — A new or touched page is usable at 390px wide. A table may
  scroll horizontally inside its own container; nothing else may, and a table may
  not take the row's own controls with it.

## 13. Accessibility

- **CUI-A11Y-1** — Every dialog has a title, even if it is visually hidden.
- **CUI-A11Y-2** — Focus is trapped while a dialog is open and lands somewhere
  useful when it closes — never on `<body>`.
- **CUI-A11Y-3** — A dialog that owns a mutation cannot be dismissed while the
  request is in flight.
- **CUI-A11Y-4** — Every interactive element carries a `data-testid`.
- **CUI-A11Y-5** — Nothing is conveyed by colour alone. A status has a word; a
  warning has an icon.

## 14. Navigation

- **CUI-NAV-1** — Navigation is a declarative table, not a hand-written tree.
  Each entry states at least its route, its label, its icon, the scope that
  reveals it and the group it sits in.
- **CUI-NAV-2** — Each entry states the API paths its page reaches, and that
  declaration is compared against what the page actually calls. A navigation
  table nobody checks is a comment.

## 15. AI output

- **CUI-AI-1** — A model's claim is not a measurement, and never renders in a
  token that means "healthy" or "confirmed".
- **CUI-AI-2** — Model identity and generation time are shown wherever model
  output is. Confidence is a number with its scale stated, never a bare
  colour-coded bar.
- **CUI-AI-3** — Model output states what it was shown. What cannot be traced
  cannot be argued with.
- **CUI-AI-4** — Accept/reject renders only where an endpoint actually records
  the answer. An affordance that discards the operator's judgement is worse than
  none.

## Ledger

Every change to `contract/cockpit-ui.css` appends a row here, in both products,
in the same wave.

| Date | Digest | Change |
|---|---|---|
| 2026-08-05 | `sha256:2974e7b7` | Contract established from the bytes both consoles already shipped. No value changed. |
| 2026-08-06 | `sha256:4ca18a25` | Dropped the version number: the sentinels lose their `-v1`, so the file's bytes change and no token value does. The digest is the identity now. |
