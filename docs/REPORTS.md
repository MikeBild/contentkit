# Markdown reports and dashboards

Contentkit can turn one auditable Markdown document into a responsive report or
dashboard. Authors write metrics, cards, progress and ordinary GFM tables. A
release converts chart tables into content-hashed light and dark SVG assets,
while the original tables remain available below each chart.

The output follows the existing shadcn-style design-token contract. Apache
ECharts is an internal server-side renderer, not an authoring language: report
authors never write an ECharts or Vega specification, and published pages load
no chart JavaScript.

## Minimal report

Select the controlled `report` layout in frontmatter:

```md
---
kind: page
layout: report
title: Q2 Business Review
locale: en
slug: q2-business-review
translationKey: q2-business-review
summary: Revenue, delivery and reliability for Q2.
reportCadence: quarterly
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

Report directives are accepted only with explicit `layout: report`. Unknown
directives and unknown attributes fail the Markdown write with HTTP 422, so a
typo cannot silently produce an incomplete dashboard.

When a report contains at least two level-two headings (`##`), Contentkit
derives a responsive, localized section navigation from them. The links remain
ordinary same-page anchors, need no JavaScript and are omitted from print. Use
level-two headings for the report's major areas and level-three headings for
detail that should stay out of this navigation.

## Report catalog and periods

An optional `reportCadence` adds the report to the generic period catalog. Its
allowed values are `hourly`, `daily`, `weekly`, `monthly`, `quarterly` and
`yearly`; it is rejected on every layout except `report`. The report's `date`
remains the semantic period timestamp and therefore drives newest-first sorting.

With the `product` site preset, the presence of at least one report activates a
zero-configuration report home. It shows the newest immutable report for every
available cadence, links those periods directly, and keeps up to twelve older
reports as recent history. A report without `reportCadence` remains valid and is
grouped as “Other report”. This behavior is based only on generic frontmatter;
Contentkit never infers a cadence from a product name, title or slug.

Private sites retain the normal release-scoped security model: the catalog can
render protected titles only when they carry the exact same grant as the home
route. Public discovery files continue to exclude protected and `noindex`
reports.

## Layout primitives

Use a grid to arrange cards, metrics, progress and charts. It collapses to one
column on narrow screens and prints without card fragmentation.

```md
::::report-grid{columns="4"}
::metric{label="Gross margin" value="68.4%" trend="+2.1 pp" tone="positive"}

:::report-card{title="Review status" span="2"}
Finance :badge[Approved]{tone="positive"}

::progress{label="Objectives completed" value="8" max="10"}
:::
::::
```

| Directive | Attributes | Contract |
|---|---|---|
| `report-grid` | `columns="1..4"` | Responsive grid; defaults to four columns |
| `report-card` | required `title`, optional `span="1..4"` | Card for prose, lists, tables or nested inline directives |
| `metric` | required `label` and `value`; optional `trend`, `tone`, `span` | Compact KPI card |
| `badge` | optional `tone`; visible inline text is required | Inline status label, for example `:badge[Approved]{tone="positive"}` |
| `progress` | required `label` and numeric `value`; optional positive `max`, `span` | Accessible progress bar; `value` must be between zero and `max` |
| `chart` | see below | Static SVG plus an accessible source-data disclosure |

`tone` is one of `neutral`, `positive`, `warning` or `negative`. `span` is an
integer from one through four. The normal `note`, `tip` and `warning` callouts
remain available in reports.

## Charts from Markdown tables

A `chart` must contain exactly one GFM table. The first column contains category
labels; every remaining cell is a finite number. Use an em dash (`—`) for a
missing point. Formatted strings such as `€1,200`, percentages with `%`, dates
that should be parsed, formulas and arbitrary JSON are deliberately not
accepted: the Markdown table is the complete, reviewable data contract.

```md
:::chart{type="area" title="Delivery throughput" description="Completed work items by month" stacked="true" unit="items" span="2"}
| Month | Product | Platform |
|---|---:|---:|
| Apr | 18 | 11 |
| May | 22 | 14 |
| Jun | 25 | — |
:::
```

Chart attributes:

| Attribute | Required | Values |
|---|---|---|
| `type` | yes | `bar`, `line`, `area` or `donut` |
| `title` | yes | Visible caption, at most 160 characters |
| `description` | yes | Image alternative and SVG accessible name, at most 500 characters |
| `unit` | no | Axis/label suffix, at most 16 characters |
| `span` | no | Grid span from `1` through `4` |
| `orientation` | no | `vertical` or `horizontal`; bar charts only |
| `stacked` | no | `true` or `false`; bar and area charts only |

A donut accepts exactly one value column. A report accepts at most 24 charts;
each chart accepts at most 200 data rows and eight value series. These bounded
contracts keep uploads and release builds predictable. An all-missing chart,
or an all-zero donut, renders a localized empty state.

## Theme integration

Report cards consume the same shadcn-style tokens as every Contentkit page.
Charts additionally use `chart_1` through `chart_5`. Each value can be a scalar
or a `{ "light": "...", "dark": "..." }` pair:

```json
{
  "theme": {
    "tokens": {
      "primary": { "light": "221 83% 53%", "dark": "217 91% 60%" },
      "chart_1": { "light": "221 83% 53%", "dark": "217 91% 60%" },
      "chart_2": { "light": "160 84% 39%", "dark": "158 64% 52%" },
      "chart_3": "38 92% 50%",
      "chart_4": "262 83% 58%",
      "chart_5": "0 72% 51%"
    }
  }
}
```

Colors use the same hex or shadcn-style `H S% L%` triple accepted by the
existing theme system. `settings.theme.custom_css` can style report HTML, but
it does not enter the generated SVG assets; use the chart tokens for chart
colors. `PATCH /v1/sites/{site}` replaces settings wholesale, so read and merge
the current settings before applying a theme update.

## Output, accessibility and security

- The release contains content-hashed SVG files and a `<picture>` with separate
  light/dark sources. Rebuilding identical content is byte-deterministic.
- Charts have a descriptive image alternative and SVG accessible name. Their
  source table stays in a `<details>` block and is expanded for print.
- The report layout is responsive and has print rules for clean PDF export.
- No chart runtime, tooltip code, remote font or third-party request is shipped
  to the browser. Existing CSP remains unchanged.
- Raw HTML is still sanitized. Directive markup and attributes are mapped to a
  fixed Contentkit-owned DOM; authored text cannot select components or execute
  code.
- Indexable report pages receive an `index.md` Markdown twin, and their authored
  source appears in the site's `llms-full.txt`. `noindex` and reader access
  rules remove those public discovery surfaces as usual.
- The authenticated single-document read API renders charts as self-contained
  SVG data URLs; static site releases use content-hashed SVG files.

See [`examples/reports/quarterly.en.md`](../examples/reports/quarterly.en.md)
for a complete report using all four chart types.
