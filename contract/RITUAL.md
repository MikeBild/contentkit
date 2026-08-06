# Changing something that is shared

This file is byte-identical in every product that implements `cockpit-ui`.

There is one rule above all the steps below:

> **There is no such thing as a contract change in one repository.** A branch that
> touches `contract/` in one product without a sibling branch open is unfinished.

The products stay separate products. What travels between them is bytes and rules,
by hand, in a wave — never a package, never a dependency, never a deployment.

## Changing a token value

Example: `--accent` in the light scheme.

| # | Where | Do | Red until you do it |
|---|---|---|---|
| 1 | ContentKit | `src/design-system.mjs` — the new hex | `cockpit-design-tokens` — css ≠ design system |
| 2 | ContentKit | `contract/cockpit-ui.css` — the same hex | `cockpit-ui-contract` — file ≠ `Tokens-Digest` |
| 3 | ContentKit | `shasum -a 256 contract/cockpit-ui.css` → paste into `Tokens-Digest`; append a Ledger row | as above |
| 4 | ContentKit | copy the region into `apps/cockpit/src/index.css`, between the sentinels | region equality |
| 5 | ContentKit | `npm run cockpit:build && npm run validate:cockpit` | the browser check |
| 6 | ContentKit | commit **all four files together**, trailer `Cockpit-UI-Contract: sha256:<first 12>` | — |
| 7 | WatchKit, **same day** | `cp ../contentkit/contract/{cockpit-ui.css,COCKPIT-UI.md} contract/` | `cockpit-ui-contract` — index.css ≠ contract |
| 8 | WatchKit | copy the region into `apps/cockpit/src/index.css` **and** update `apps/cockpit/src/lib/tokens.ts` | `cockpit-theme` — tokens.ts ≠ contract |
| 9 | WatchKit | `bun run build:cockpit` (regenerates `assets/cockpit` **and** `src/cockpit-embedded.ts`) | `check:cockpit-drift` |
| 10 | WatchKit | `bun run gate`; commit with the **same trailer** | — |
| 11 | either | `node scripts/verify-family-contracts.mjs --sibling ../watchkit` | — |

## Adding or removing a token name

Steps 1–11 above, plus: change the name list in `COCKPIT-UI.md` before step 3.
`CUI-TOKEN-2` fails until you do.

There is no version to bump. A version number was tried and removed: it existed
so a product that had NOT taken a change would fail loudly rather than render a
component unstyled — but rule 12 below says a change lands everywhere in one
wave, so that product does not exist. The digest is the identity.

## Changing the auth funnel's shared block

Same shape, four repos instead of two:

```
watchkit    src/oauth/ui.ts                              test/unit/oauth-ui.test.ts
contentkit  src/oauth/ui.mjs                             test/unit/oauth-policy-ui.test.mjs
wikikit     src/oauth/ui.ts                              test/unit/oauth-ui.test.ts
subkit      apps/engine/src/http/routes/oauth/ui.ts      .../oauth/ui.test.ts
```

Author in one, run its test, copy the sha256 it printed into `COMMON_STYLE_SHA256`
in all four, open four PRs **before merging any**, merge them together.

The funnel's own marker needs no editing: `AUTH_UI_DIGEST` is computed from the
block at module load, so the `<meta name="mcp-auth-ui-contract">` every product
serves changes with the bytes. It used to be a hand-typed `content="2"` in four
repositories — a marker that could not be wrong because it said nothing about
what it described.

## What is red if you stop halfway

| You did | What happens |
|---|---|
| `index.css` only | region ≠ contract file → red, with the differing line number |
| contract css only | `sha256` ≠ `Tokens-Digest` → red |
| contract css + digest, forgot `index.css` | region mismatch → red |
| added or removed a name without changing the list | name set-equality → red |
| **all of it in one product, forgot the sibling** | **both repos green** |

That last row is the one no single-repo test can catch, and pretending otherwise
is how `mcp-auth-v2` ended up with four repos asserting a hand-typed `content="2"`
that would have kept passing while the CSS diverged. Three things catch it
instead:

1. the `cockpit-ui-digest` meta is **derived from the bytes**, so divergent
   products announce divergent strings in the DOM
2. the missing Ledger row — a one-line `diff` any human can read
3. `verify-family-contracts`, run at promotion time on a machine that has both
   checkouts. It exits 0 with `no sibling checkout found; nothing compared` when
   there is nothing to compare, and it is **never** part of `npm test` / `bun test`.

Keep the wave short. Open both branches before merging either.
