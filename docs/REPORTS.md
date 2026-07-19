# Reports and dashboards as compositions

Contentkit treats a report as a semantic visual composition, not as a special
renderer. The author states what each block means, Contentkit selects a valid
visual pattern, then publishes responsive HTML plus standalone SVG and PNG.
Charts remain table-driven evidence and published pages require no browser chart
runtime.

For the complete architecture, all 81 patterns and the AI-agent workflow, read
[VISUAL_COMPOSITIONS.md](VISUAL_COMPOSITIONS.md).

## Minimal report

```md
---
kind: page
layout: composition
title: Q2 Business Review
locale: en
slug: q2-business-review
translationKey: q2-business-review
summary: Revenue, delivery and reliability for Q2.
reportCadence: quarterly
composition:
  format: report
  canvas: flow
  intent: status
  density: compact
---

::metric{label="Revenue" value="€1.42M" trend="+12.8% QoQ" tone="positive"}

:::chart{type="bar" title="Revenue versus plan" description="Monthly revenue and plan in thousands of euros" unit="€k"}
| Month | Revenue | Plan |
|---|---:|---:|
| Apr | 438 | 425 |
| May | 471 | 450 |
| Jun | 512 | 480 |
:::
```

New composition directives use `layout: composition`. Unknown directives and
attributes fail the write with HTTP 422. A composition must contain at least one
semantic directive.

For compatibility, existing `layout: report` documents and their `report-grid`
and `report-card` directives are normalized internally to `composition`,
`group` and `card`. New documents should use the explicit contract above.

## Report catalog and periods

`reportCadence` is valid only with `composition.format: report`. Its values are
`hourly`, `daily`, `weekly`, `monthly`, `quarterly` and `yearly`. With the
`product` site preset, Contentkit lists the newest immutable report for each
cadence and keeps up to twelve older reports as history. Untagged reports appear
as “Other report”. Access rules and `noindex` remain authoritative.

Two or more level-two headings create a responsive same-page section navigation
without JavaScript. Use level-three headings for details that should stay out of
that navigation.

## Dashboard primitives

```md
::::group{columns="4"}
::metric{label="Gross margin" value="68.4%" trend="+2.1 pp" tone="positive"}

:::card{title="Review status" span="2"}
Finance :badge[Approved]{tone="positive"}

::progress{label="Objectives completed" value="8" max="10"}
:::
::::
```

| Directive | Attributes | Contract |
|---|---|---|
| `group` | `columns="1..4"`, optional semantic role | responsive document grouping |
| `card` | required `title`, optional `span="1..4"` and role | titled semantic grouping |
| `metric` | required `label`, `value`; optional `trend`, `tone`, `span`, role | KPI evidence |
| `badge` | optional `tone`; visible text required | short inline state |
| `progress` | required `label`, numeric `value`; optional positive `max`, `span`, role | accessible progress |
| `chart` | options below | static light/dark SVG plus accessible source data |

`tone` is `neutral`, `positive`, `warning` or `negative`. `role` is `primary`,
`supporting` or `evidence`.

## Charts from Markdown tables

A chart contains exactly one GFM table. The first column is categorical and
remaining cells are finite numbers; use `—` for a missing value. Authors cannot
upload renderer-specific specifications.

| Attribute | Required | Values |
|---|---|---|
| `type` | yes | `bar`, `line`, `area`, `donut` |
| `title` | yes | at most 160 characters |
| `description` | yes | accessible description, at most 500 characters |
| `unit` | no | at most 16 characters |
| `span` | no | `1`–`4` |
| `orientation` | no | `vertical` or `horizontal`, bar only |
| `stacked` | no | boolean, bar and area only |
| `shape` | no | typed information form; defaults to `series` |
| `question` | no | the decision or analytical question, at most 240 characters |
| `insight` | no | the intended conclusion, at most 500 characters |
| `action` | no | the action supported by the evidence, at most 500 characters |
| `limitation` | no | an evidential boundary or caveat, at most 500 characters |

A donut accepts exactly one value column. One document accepts at most 24
charts; one chart accepts at most 200 rows and eight value series. The source
table remains in a semantic disclosure and expands for print.

`shape` describes the meaning and columns of the table, not a renderer. The
supported forms are `range`, `change`, `diverging`, `likert`, `xy`, `boxplot`,
`matrix`, `waterfall`, `hierarchy`, `flow`, `uncertainty`, `calendar`,
`geo-point`, `geo-region` and `samples`. Contentkit validates the exact column
contract, ordering and bounds before pattern selection. For example:

```md
:::chart{type="line" shape="uncertainty" title="Capacity forecast" description="Estimate with an 80 percent interval" unit="%" question="Can planned demand be served?" insight="Capacity grows, but uncertainty widens." action="Keep reserve capacity for September." limitation="Bounds are model estimates."}
| Month | Lower | Estimate | Upper |
|---|---:|---:|---:|
| August | 61 | 68 | 75 |
| September | 64 | 72 | 81 |
:::
```

External agents should read `accepts.data_shapes` from the Pattern Registry and
choose only a matching eligible pattern. The registry recommendation endpoint
returns `data.<shape>` as a positive reason or `semantic.data_shape` as a
rejection. The full contract table is in
[VISUAL_COMPOSITIONS.md](VISUAL_COMPOSITIONS.md).

## Chart quality rules

Choose a chart from the question, not from its appearance: bars compare
magnitudes, lines show ordered change, areas communicate accumulated change and
donuts show a small part-to-whole set. A chart should support one central claim.
Its normalized Semantic AST node always contains a narrative question,
communication goal and intended insight. Explicit `action` and `limitation`
fields keep an agent from turning evidence into an unsupported recommendation.

Contentkit keeps bar baselines at zero, but scales line axes to the observed
range so small, meaningful changes remain visible. Short series receive direct
value labels. Multiple lines differ by stroke pattern as well as color. Donut
segments carry category, value and percentage directly. Every SVG has a title
and description, while the complete Markdown table remains the authoritative
accessible representation.

## Theme, output and headless use

Report HTML consumes the normal theme tokens. Charts additionally use
`chart_1` through `chart_5`, each as one color or a light/dark pair. Pattern
geometry does not come from theme CSS.

Release builds emit content-hashed light/dark chart and composition SVGs beside
responsive semantic HTML/CSS. PNG is generated only when a headless caller
explicitly requests the raster representation. No visualization runtime, remote
font or third-party request is sent to readers. Graphics use Contentkit's standard font stack (`Inter`,
`ui-sans-serif`, `system-ui`, platform UI fallbacks and `sans-serif`); the
bundled Inter primary face makes raster output independent from system fonts.
Typed data shapes also emit a structurally reflowed 390-pixel
mobile SVG selected by the responsive `<picture>` element; it is not a scaled
desktop chart. Generated graphics enforce a responsive type floor of 15 px on
canvases up to 800 px, 15 px up to 1100 px, and 16 px on wider canvases; layouts reflow instead of reducing
labels below that threshold.

The authenticated published-document API returns Semantic AST, Narrative,
resolved Composition, diagnostics, accessible text and representation links.
The `.svg` and `.png` representation endpoints use the same `content:read`
authorization and ETag caching. See [VISUAL_COMPOSITIONS.md](VISUAL_COMPOSITIONS.md)
for exact paths and compile requests.

See [`examples/reports/quarterly.en.md`](../examples/reports/quarterly.en.md) for
a complete report. Legacy report Markdown can be checked or rewritten with
`npm run migrate:reports`.
