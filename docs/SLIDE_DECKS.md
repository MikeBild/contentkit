# Semantic slide decks

ContentKit owns the complete slide-deck lifecycle: immutable Markdown source,
deterministic information architecture and narrative, semantic visual
components, preview, atomic release, static delivery, telemetry and rollback.

## Authoring contract

Decks are first-class content items. Use `kind: deck` with the controlled
`deck` layout and separate slides by a blank-line-delimited `---` marker:

```md
---
kind: deck
layout: deck
title: Product decision
locale: en
slug: product-decision
question: What should we ship?
goal: Make the evidence actionable.
deck:
  theme: editorial
  visualScheme: auto
  maxSlides: 24
  firstSlide:
    layout: cover
---

# Product decision

What should we ship?

---

# Evidence

:::metric{label="Conversion" value="18%" trend="+4 pp" role="primary"}
:::

---

# Decision

Ship the verified path.
```

The supported themes are `neutral` and `editorial`. `visualScheme` is `auto`,
`light` or `dark`; `auto` emits both visual schemes. `maxSlides` is a bounded
integer from 1 through 120. ContentKit rejects unknown values and never accepts
an uploaded CSS/template override.

`deck.firstSlide` preserves bounded Slidev frontmatter such as `layout`,
`class`, `background` or `transition` for the opening slide. `theme`,
`routerMode` and `colorSchema` are reserved because ContentKit controls the
installed base theme, offline hash routing and visual scheme. Later per-slide
frontmatter uses normal Slidev syntax and is preserved by the official parser;
separator-like text inside fenced code is not treated as a new slide.

The production-shaped source is
[`examples/decks/decision.en.md`](../examples/decks/decision.en.md). A larger
German example is maintained in
[`examples/decks/contentkit-semantic-publishing.de.md`](../examples/decks/contentkit-semantic-publishing.de.md).
When released, its permanent site path is
`/de/slides/contentkit-semantic-publishing/`.

## Deterministic compiler

The authoring source is transformed in four explicit stages:

1. `plan` parses the source and derives a versioned, source-addressed DeckPlan.
   It contains the information architecture, narrative, slide roles,
   communication goals, bounded Markdown link/footnote source references and
   SHA-256 hashes. A top-level source catalog connects evidence to its slide.
2. `validate` checks the same plan and returns bounded diagnostics. It performs
   no Slidev build.
3. `compile` resolves semantic directives through ContentKit's declarative
   Pattern Registry. Each matching slide receives standalone SVG and PNG
   components; `auto` produces light and dark variants.
4. The trusted-source Slidev/Vite compiler creates one self-contained HTML
   artifact with hash routing, offline fonts/assets and presenter mode.

The same source and compiler version produce the same DeckPlan hash and final
HTML hash. A strong ETag makes repeated headless reads cacheable. Release
artifacts are immutable and rollback switches the release pointer without
recompiling.

Semantic component failures are release-blocking by default, so a published
deck never silently degrades into raw directive text. A headless migration
probe may explicitly set `preferences.allowVisualFallback: true`; the DeckPlan
then carries a slide-addressed diagnostic and preserves the source slide.

## API

Theme discovery is public:

```bash
curl "$CONTENTKIT_URL/v1/deck-themes"
```

Planning and validation require `content:write`:

```bash
jq -n --rawfile markdown examples/decks/decision.en.md '{markdown:$markdown}' |
  curl -X POST "$CONTENTKIT_URL/v1/sites/$SITE/decks/plan" \
    -H "Authorization: Bearer $CONTENTKIT_PUBLISH_API_KEY" \
    -H 'Content-Type: application/json' --data-binary @-
```

Compilation additionally requires `deck:render`:

```bash
jq -n --rawfile markdown examples/decks/decision.en.md \
  '{markdown:$markdown,async:true}' |
  curl -X POST "$CONTENTKIT_URL/v1/sites/$SITE/decks/compile" \
    -H "Authorization: Bearer $CONTENTKIT_DECK_API_KEY" \
    -H 'Content-Type: application/json' --data-binary @-
```

The synchronous result includes each semantic component's SVG text, Base64 PNG
and scheme-specific hashes as well as the compiled Markdown and final HTML.
Released decks embed those representations directly, so delivery stays a
single offline artifact.

An asynchronous request returns 202 with `status_url` and `result_url`.
Headless jobs are bounded, process-local and expire; they intentionally do not
persist Markdown. Uploading the source as content and creating a preview or
release is the durable workflow:

```bash
curl -X POST "$CONTENTKIT_URL/v1/sites/$SITE/content" \
  -H "Authorization: Bearer $CONTENTKIT_DECK_API_KEY" \
  -H 'Content-Type: text/markdown' \
  --data-binary @examples/decks/decision.en.md
```

The published artifact is `/{locale}/slides/{slug}/`; its Markdown twin,
search entry, sitemap entry and per-site LLM documentation are generated in
the same atomic release.

## Security boundary

Slidev/Vite builds can execute deck code. Only trusted automation receives the
`deck:render` scope. A normal `content:write` author can upload, plan and
validate a deck but cannot compile or explicitly publish a new deck revision.

The build runner has bounded concurrency, queue length, queue wait and runtime;
kills the complete child process group on timeout; caps diagnostics; removes
temporary files after success, failure or timeout; sweeps stale files at
startup; and starts the child with a secret-free environment. The build remains
a trusted-code boundary, not a sandbox. Run ContentKit as an unprivileged
service account and do not grant `deck:render` to untrusted tenants.

Ordinary pages retain ContentKit's strict no-inline-script CSP. Only a released
`/slides/.../index.html` receives the offline deck CSP required by the
self-contained Slidev runtime; it denies network connections and forms.

## Telemetry and product statistics

Prometheus exports:

- `contentkit_deck_builds_total{result}`;
- `contentkit_deck_cache_total{result}`;
- `contentkit_deck_jobs_total{status}`;
- `contentkit_deck_operations_total{mode,result,execution}`;
- `contentkit_deck_build_duration_milliseconds_total`;
- `contentkit_deck_output_bytes_total`.

`GET /v1/sites/{site}/stats/decks` returns dense UTC buckets for plans,
validations, sync/async compiles, previews, releases, outcomes, cache results,
slide and SVG/PNG counts, diagnostics, duration and output bytes. Events are
site-scoped, contain no Markdown, URL, title, user identity, API key or job ID,
and expire under `CONTENTKIT_PRODUCT_STATS_RETENTION_DAYS`.

Successful release activation emits `contentkit.deck.published` atomically
with the content and release events. A failed deck release emits
`contentkit.deck.release_failed` best-effort, while the database event remains
the statistics source of truth.

## Production verification

Before retiring the standalone service, verify all of these against the live
ContentKit production deployment:

- `/ready` reports the new version and zero unexpected in-flight builds;
- `/openapi.json`, `/llms.txt` and `/llms-full.txt` contain every deck route;
- a scoped key can plan, validate, synchronously compile and asynchronously
  compile the example; a key without `deck:render` receives 403;
- two identical compiles have the same plan hash/HTML hash and the second is a
  cache hit;
- the example preview loads, advances slides, renders SVG and PNG fallbacks,
  enters presenter mode and makes no runtime network request;
- release activation serves the canonical deck URL with the deck CSP, strong
  storage content and a Markdown twin;
- the site sitemap, search index and LLM files reference the deck without
  leaking protected content;
- `/metrics` and `/stats/decks` move by the expected bounded values;
- the signed `contentkit.deck.published` webhook arrives once;
- activating the previous release restores the old site, and reactivating the
  new release restores the deck.
