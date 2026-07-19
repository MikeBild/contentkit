# Visual compositions

Contentkit turns semantic Markdown into deterministic visual publications. The
important idea is simple: authors describe **what information means**; Contentkit
decides **how that meaning can be shown safely**.

```text
Markdown → Semantic AST → Narrative → Composition → Layout → Render tree
                                                        ├─ responsive HTML
                                                        ├─ standalone SVG
                                                        └─ deterministic PNG
```

Charts are only one semantic node among many. Pattern selection, layout and
rendering stay Contentkit-owned; authors cannot inject runtime code or geometry.

## A first composition

```md
---
kind: page
layout: composition
title: MCP at a glance
locale: en
slug: mcp-at-a-glance
composition:
  format: infographic
  canvas: portrait
  intent: explain
  density: balanced
  audience: Readers new to tool interoperability
  question: How does one tool request reach an implementation?
  goal: Explain the shared contract and the directed handoff.
  thesis: A shared contract separates callers from tool implementations.
  conclusion: Clients can integrate once and reuse compatible servers.
  action: Validate the contract before adding an integration.
  limitations:
    - Transport and authorization details are outside this overview.
---

:::hero
# Model Context Protocol

One shared contract for AI tools.
:::

:::process{title="Tool call" orientation="horizontal"}
- Client
- Server
- Tool
:::

::metric{label="Integrations" value="1 contract" role="evidence"}
```

The result contains responsive semantic HTML and independent light/dark SVG and
PNG representations. The source order remains the accessible reading order.
Identical source, registry, viewport and theme inputs produce identical bytes.

## The three contracts

1. **Semantic AST — meaning.** A `process` is ordered, a `comparison` has sides,
   a `timeline` has events, and a `relationship` has a center and related items.
2. **Composition AST — visual narrative.** A compatible pattern such as
   `connected-process` or `vertical-journey` is selected and its fallback is
   resolved for the viewport.
3. **Theme — appearance.** Neutral design tokens control color, typography,
   borders, radii and spacing without changing meaning or geometry rules.

The Render Tree is an internal resolved model with concrete boxes and styles. It
is output, never authored input.

The document-level Narrative Plan is explicit rather than inferred from visual
order alone. `composition` accepts `audience`, `question`, `goal`, `thesis`,
`conclusion`, `action`, `limitations` and `disclosure`. The resulting model also
links primary, supporting and evidence nodes and records their reading sequence.
This contract applies equally to infographics, dashboards and recurring reports.

## Semantic directives

| Directive | Meaning | Important constraints |
|---|---|---|
| `hero` | central thesis or definition | normally `role="primary"` |
| `metric` | one named value | `label` and `value` required |
| `process` | ordered directed steps | 2–12 list items |
| `comparison` + `side` | two or more alternatives | 2–6 labeled sides |
| `timeline` | ordered events or milestones | 2–24 list items |
| `hierarchy` | parent/child structure | 2–24 list items |
| `relationship` | center and connected entities | 2–16 list items |
| `chart` | quantitative evidence in a table | bounded numeric GFM table |
| `progress` | progress toward a maximum | numeric value from zero to max |
| `badge` | short state | visible text required |
| `card` | titled semantic grouping | title required |
| `group` | document-level grouping | 1–4 responsive columns |
| `faq` + `question` | complete questions and answers | 2–24 questions |
| `code-example` + `variant` | one task with code alternatives | 1–8 bounded variants |
| `pricing` + `plan` | comparable offers and features | 1–5 plans, one currency |
| `gallery` + `figure` | media with alt text and captions | 2–24 figures |
| `data-table` | keyed tabular records | bounded GFM table |
| `dashboard-section` | metrics, evidence, and decisions | composed semantic children |
| `application-shell` + `region` | named workspace regions | unique navigation/main regions |

Mermaid code fences contribute inferred `diagram` evidence nodes. Their
technical declaration selects a process, sequence, state, data-model,
architecture or generic technical publishing guide; they are not a geometry
authoring escape hatch.

`role` is `primary`, `supporting` or `evidence`. Authors may request
`preferredPattern`, but cannot set coordinates, CSS, JavaScript or renderer
options. Incompatible preferences produce diagnostics and a deterministic safe
fallback.

## Declarative Pattern Packages

Every pattern is an external repository file under `patterns/`. The format is
Markdown with strict YAML metadata: machines get a stable contract and humans
get an explanation in the same reviewable file. Executable extensions are
excluded because remote pattern code would create an untrusted plugin system.

```md
---
schemaVersion: 1
id: connected-process
version: 1
status: stable
category: process
scope: node
accepts: { nodeTypes: [process], minItems: 2, preferredMaxItems: 4, maxItems: 8 }
semantics: { conveys: [sequence, directed-flow], rejects: [unordered-items, repeating-cycle] }
selection: { intents: [explain, sequence], canvases: [portrait, landscape, flow], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: vertical-journey }]
fallbacks: [vertical-journey]
layout: { primitive: sequence, direction: horizontal, connector: arrow }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Connected Process

A directed process with a clear start, end and connection between steps.
```

The loader rejects duplicate IDs, unknown primitives, missing semantic types,
invalid versions, unknown fallback references and fallback cycles at startup.
Supported layout primitives are `frame`, `stack`, `grid`, `split`, `sequence`,
`radial`, `layers`, `matrix`, `card`, `slot` and `connector`.

## Registry: 81 information patterns

| Category | Patterns |
|---|---|
| Application | `sidebar-shell`, `split-pane-shell`, `topbar-shell` |
| Code | `code-walkthrough`, `file-code`, `tabbed-code` |
| Document | `editorial-poster`, `stratified-story`, `bento-summary`, `grouped-dashboard`, `table-dashboard`, `executive-brief`, `magazine-story` |
| Dashboard | `analytics-dashboard`, `dashboard-detail`, `operations-dashboard` |
| FAQ | `faq-categorized`, `faq-columns`, `faq-list` |
| Gallery | `captioned-gallery`, `editorial-gallery`, `gallery-grid` |
| Metrics | `hero-banner`, `metric-card`, `metric-wall`, `scorecard`, `kpi-strip`, `progress-rings`, `bullet-scoreboard` |
| Pricing | `pricing-addons`, `pricing-cards`, `pricing-comparison`, `pricing-spotlight` |
| Process | `connected-process`, `vertical-journey`, `circular-lifecycle`, `funnel`, `chevron-process`, `swimlane-process` |
| Comparison | `split-comparison`, `before-after`, `comparison-matrix`, `feature-table`, `spectrum-comparison` |
| Stats | `featured-stat`, `stat-timeline`, `stats-inline` |
| Table | `grouped-data-table`, `record-cards`, `responsive-data-table` |
| Timeline | `horizontal-timeline`, `vertical-timeline`, `roadmap`, `milestone-roadmap`, `phase-timeline` |
| Structure | `tree-hierarchy`, `layer-stack`, `pyramid`, `hub-and-spoke`, `concentric-layers`, `architecture-map` |
| Data | `detailed-chart`, `ranked-bars`, `lollipop-chart`, `slope-chart`, `small-multiples`, `range-dot-plot`, `dumbbell-change`, `diverging-bars`, `likert-distribution`, `scatter-correlation`, `distribution-boxplot`, `data-heatmap`, `waterfall`, `treemap`, `sankey-flow`, `uncertainty-band`, `calendar-heatmap`, `coordinate-map`, `tile-choropleth`, `beeswarm-distribution` |

The registry is intentionally broad enough for information design, but closed
enough to validate. A pattern expresses visual semantics: a pyramid implies
rank or accumulation, a funnel implies reduction, a cycle implies repetition,
and hub-and-spoke implies a center. Agents must not choose these shapes only
because they look attractive.

### Typed data shapes for agents

Data patterns additionally declare `accepts.dataShapes`. The chart directive's
optional `shape` attribute becomes `data_shape` in the Semantic AST. This gives
an external agent a machine-checkable decision rule: `uncertainty-band` accepts
`uncertainty`, while `sankey-flow` accepts `flow`; neither is an interchangeable
styling choice.

| `shape` | Required table columns | Compatible pattern |
|---|---|---|
| `range` | label, lower, upper | `range-dot-plot` |
| `change` | label, before, after | `dumbbell-change` |
| `diverging` | label, signed value | `diverging-bars` |
| `likert` | statement and 3–6 ordered response values | `likert-distribution` |
| `xy` | label, x, y | `scatter-correlation` |
| `boxplot` | label, min, Q1, median, Q3, max | `distribution-boxplot` |
| `matrix` | row label and at least two numeric columns | `data-heatmap` |
| `waterfall` | contribution, signed value | `waterfall` |
| `hierarchy` | item, parent, non-negative value | `treemap` |
| `flow` | source, target, non-negative value | `sankey-flow` |
| `uncertainty` | period, lower, estimate, upper | `uncertainty-band` |
| `calendar` | ISO date, value | `calendar-heatmap` |
| `geo-point` | label, latitude, longitude, value | `coordinate-map` |
| `geo-region` | region, value | `tile-choropleth` |
| `samples` | group, observation | `beeswarm-distribution` |

Bounds and ordering are validated before rendering. Geographic points require
real latitude/longitude values. `tile-choropleth` uses equal-area tiles and is
labelled as such; it does not invent administrative boundaries. The complete
source table remains the accessible and auditable representation.

The shape contract describes the relationship; the chart instance describes
the specific story. A chart may therefore add `question`, `insight`, `action`
and `limitation` attributes. These become `node.narrative` in the Semantic AST.
When omitted, Contentkit supplies a conservative question and communication
goal from the validated shape and chart type, while preserving the authored
description as the intended insight. Agents should author the four fields when
the decision, conclusion or evidential boundary matters.

Technical diagram fences are also semantic evidence. Contentkit classifies
Mermaid declarations as `process`, `sequence`, `state`, `data-model`,
`architecture` or `technical`, links the matching publishing guide, and exposes
its narrative in the Semantic AST. Quoted fence metadata can override the
instance title, question, insight, action and limitation:

````markdown
```mermaid title="Request lifecycle" question="Where can a request fail?" insight="Validation happens before persistence." limitation="Retries are omitted."
sequenceDiagram
  Client->>API: Submit
  API->>Store: Persist
```
````

The technical diagram source remains unchanged; metadata is for human and
machine interpretation, not geometry.

## Visual quality contract

The neutral theme is the reference rendering, not a fallback. Every pattern has
its own visual grammar: process nodes connect, funnels narrow, cycles close,
pyramids rank, matrices repeat dimensions, and timelines expose time. A generic
card grid is not an acceptable substitute for a compatible pattern.

Contentkit applies these checks before visual polish:

- one dominant statement and no more than two or three concepts per view;
- source-order text equivalents for every graphical relationship;
- a 14 px export floor up to 800 px, 15 px up to 1100 px, and 16 px on wider canvases;
- meaningful shapes and connectors that remain visible in light and dark mode;
- direct values for bounded charts and an accessible source-data table;
- a structural responsive fallback when item count or width makes the requested
  visual grammar unreadable;
- deterministic geometry with no overflow, non-finite coordinates or runtime
  measurement dependency.

Responsive design is not proportional shrinking. For example, a horizontal
connected process resolves to a vertical journey at a narrow viewport. The
resolved pattern and reason are returned to headless callers in the model and
diagnostics.

## AI-agent workflow

An external agent should use this sequence:

1. Read the Markdown and identify the information claim and relationships.
2. Produce semantic directives; do not choose coordinates or colors.
3. Fetch `GET /v1/composition-patterns`, optionally filtered by `category`,
   `scope`, `status`, `nodeType` or `canvas`.
4. Call `POST /v1/sites/{site}/compositions/recommend` with Markdown or a
   Semantic AST. Keep the returned scores, reasons and rejection codes.
5. Choose only an eligible pattern. Treat a preference as a request, not a
   command.
6. Call `POST /v1/sites/{site}/compositions/validate` before saving content.
7. Call `POST /v1/sites/{site}/compositions/compile` for a headless preview.
8. Explain fallbacks from `diagnostics`; never silently claim that the requested
   pattern was used.

Pattern ranking is deterministic: semantic compatibility is strongest, then
intent, item count, canvas and density. Lexical pattern ID is the final tie
breaker. Responsive rules may replace the selected pattern at narrow widths.

Each descriptor also exposes a strict `content_budget`, typed `input_contract`,
positive Markdown `spec_examples`, and counterexamples. Agents can therefore
check title, summary, label, body, item, series, category, code, table, and media
limits before authoring. The input contract distinguishes counts, percentages,
percentage-point changes, ISO 4217 currency, duration, rates, data sizes,
physical units, ISO calendar dates, timezone-aware instants, 24-hour time, and
temporal granularity. Display labels may be localized, but sortable values and
units remain explicit.

`rendering_strategy` distinguishes a recommended primary output from supported
alternatives. Document and interface semantics normally recommend responsive
HTML + CSS; processes, structures, and data geometry normally recommend SVG.
PNG is a derived static export. This is never a lock-in: a headless caller may
request any supported subset of `html`, `svg`, and `png`.

The review gallery currently displays SVG and PNG only. This restores the last
validated visual baseline: generic semantic HTML is not shown as if it were the
same resolved composition. HTML remains a supported publishing output but must
pass cross-renderer geometry and screenshot equivalence before it returns to
the visual pattern switch.

Every descriptor also exposes `narrative`: a natural-language question,
communication goal, ordered story arc, reader takeaway, and decision-support
statement. Data patterns curate these individually so ranking, change,
distribution, uncertainty, correlation, flow, geography, and part-to-whole are
never reduced to a generic chart recommendation.

## Headless APIs

The public registry endpoints require no site and support ETag/304 caching:

- `GET /v1/composition-patterns`
- `GET /v1/composition-patterns/{pattern}`
- `GET /v1/publishing-guides?kind=report|diagram|code`
- `GET /v1/publishing-guides/{guide}`

The site-scoped planning endpoints require `content:write`:

- `POST /v1/sites/{site}/compositions/recommend`
- `POST /v1/sites/{site}/compositions/validate`
- `POST /v1/sites/{site}/compositions/compile`

Compile accepts any supported subset of `outputs: ["model", "html", "svg",
"png", "print"]`, a `scheme` and a
bounded `viewport`. PNG is base64 in JSON; SVG and HTML are strings. Maximum
Markdown size is 256 KiB, viewport sides are 320–4096 pixels and total viewport
area is limited to 16 megapixels.

Published content remains available through the normal `content:read` API. Its
document response now includes `semantic`, `narrative`, `composition`,
`diagnostics`, `accessible_text` and representation links. Binary output uses:

- `GET /v1/sites/{site}/published/{kind}/{locale}/{slug}/composition.svg?scheme=light`
- `GET /v1/sites/{site}/published/{kind}/{locale}/{slug}/composition.png?scheme=dark`

Both are deterministic, cached with ETags and protected by the same site-scoped
read authorization as the document.

Static releases keep responsive semantic HTML/CSS as the primary reader surface
and emit standalone light/dark SVG assets. A report page does not embed that
complete composition again: it presents the semantic HTML once and embeds only
responsive chart SVGs that carry authored data evidence. The full composition
SVG and PNG remain explicit headless selections through the compile or
published-representation API. PNG is not repeated for every historical
composition during an additive site release. This keeps both the page narrative
and release duration bounded as a report archive grows.

## Themes and the review gallery

Patterns select structure; themes select appearance. The generated review set
uses the neutral reference theme: restrained, typography-led and designed to
make information hierarchy visible without decorative effects.

Typography resolves with the viewport instead of shrinking a desktop drawing.
SVGs use a 14 px floor up to 800 px, 15 px up to 1100 px, and 16 px on wider
canvases; body and label
styles grow on a responsive ramp while display headings preserve their visual
hierarchy. Dense structures must reflow when larger type no longer fits. For
example, a comparison matrix becomes stacked subject cards and a tree hierarchy
becomes an indented list at 390 px instead of compressing content into
unreadable columns. The semantic HTML uses relative `rem` sizes and `clamp()` so
browser zoom and text resizing remain available.

Run `npm run review:patterns`, then open
`examples/pattern-gallery/index.html`. It contains 81 authored examples at 320,
390, 768, 1024, 1440, and 1600 px in both appearances: 972 standalone SVGs and
972 PNGs. It also demonstrates highlighted code, a technical diagram, a
server-rendered chart, and a semantic report. Each is introduced by the question
it answers and its story arc; nine declarative publishing guides expose the same
selection logic to humans and machines. Run `npm run validate:visuals` to compare exact
bytes, validate 1,097 semantic HTML cases, measure all 972 SVGs in Chromium, and
check the complete gallery in 12 responsive appearance cases. Clipping, text
collisions, authored truncation, container overflow, separator crossings,
missing capability output, or sticky-navigation defects fail the command. The
authored Markdown examples live in `examples/compositions/`; the generated
machine-readable registry snapshot is `examples/composition-patterns.json`.

## Migration of legacy report layouts

Existing `layout: report`, `report-grid` and `report-card` documents remain
accepted and are normalized to the same Semantic AST. New content should use
`layout: composition`, `composition.format: report`, `group` and `card`. Run
`npm run migrate:reports -- --check examples` to inspect or `npm run
migrate:reports -- --write <paths...>` to update source files explicitly. The
tool never changes database state; upload reviewed Markdown as a new immutable
revision.
