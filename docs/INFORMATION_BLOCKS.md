# Semantic information blocks

ContentKit is a headless Markdown mini-CMS with semantic visual composition and
information patterns. Information blocks extend the existing publishing model;
they are not a separate component library or a client-side runtime.

```text
Markdown
  → Semantic AST
  → Narrative
  → Resolved composition
  → Layout tree
  → Render tree
  → responsive HTML / standalone SVG / deterministic PNG
```

Authors describe meaning, content, and relationships. ContentKit owns pattern
eligibility, responsive fallback, geometry, theme resolution, and output
serialization. Authored CSS, coordinates, and executable pattern code are not
part of the contract.

Semantic information blocks may be used in two scopes. A full
`layout: composition` document resolves all nodes into a document-level
Narrative, Composition, Layout Tree and Render Tree and can produce HTML, SVG
and PNG. A normal page or post may embed selected blocks in editorial prose;
those blocks remain accessible HTML and appear in a Semantic AST whose
`presentation` is `embedded`, while the surrounding document keeps its normal
layout and does not acquire standalone visual exports implicitly.

## Implemented semantic families

| Family | Directives | Meaning | Stable patterns |
|---|---|---|---|
| FAQ | `faq`, `question` | complete questions and answers, optionally categorized | `faq-list`, `faq-columns`, `faq-categorized` |
| Code example | `code-example`, `variant` | one task shown through one or more code variants | `tabbed-code`, `file-code`, `code-walkthrough` |
| Pricing | `pricing`, `plan` | comparable commercial offers, cadence, features, and one optional recommendation | `pricing-cards`, `pricing-comparison`, `pricing-spotlight`, `pricing-addons` |
| Gallery | `gallery`, `figure` | media with alternative text, captions, and authored aspect ratios | `gallery-grid`, `editorial-gallery`, `captioned-gallery` |
| Data table | `data-table` around a GFM table | keyed records, column roles, sorting intent, and compact record semantics | `responsive-data-table`, `grouped-data-table`, `record-cards` |
| Dashboard section | `dashboard-section` | a status or analysis section composed from metrics, charts, cards, and tables | `analytics-dashboard`, `operations-dashboard`, `dashboard-detail` |
| Application shell | `application-shell`, `region` | named navigation, toolbar, main, and secondary regions | `sidebar-shell`, `topbar-shell`, `split-pane-shell` |
| Stats | extended `metric` nodes | values with period, previous value, target, unit, and status | `stats-inline`, `featured-stat`, `stat-timeline` |

All families preserve source order as the accessible reading order. The
semantic HTML contains the complete information without JavaScript. Progressive
behavior may improve navigation or disclosure, but may not become the only way
to access content.

## Authoring examples

### FAQ

```md
::::faq{title="Common questions" role="supporting" preferredPattern="faq-categorized"}
:::question{title="Can I export SVG?" category="Output"}
Yes. SVG is a standalone deterministic representation.
:::
:::question{title="Does the page require JavaScript?" category="Runtime"}
No. The complete answer remains available without JavaScript.
:::
::::
```

Rules: 2–24 questions; source order is authoritative; category is optional;
answers remain sanitized Markdown.

### Code example

````md
::::code-example{title="Compile a document" role="evidence" preferredPattern="tabbed-code"}
:::variant{label="Shell" language="bash"}
```bash
curl -X POST "$CONTENTKIT_URL/v1/sites/$SITE/compositions/compile"
```
:::
:::variant{label="JavaScript" language="javascript"}
```javascript
await fetch(url, { method: 'POST', body: JSON.stringify(input) })
```
:::
::::
````

Rules: 1–8 variants; one fenced block per variant; language identifiers are
allowlisted; static output shows the primary variant and a visible variant
index.

### Pricing

```md
::::pricing{title="Plans" currency="EUR" billing="monthly" role="primary"}
:::plan{name="Starter" price="0" cadence="month"}
- 3 projects
- Community support
:::
:::plan{name="Pro" price="49" cadence="month" recommended="true"}
- Unlimited projects
- Priority support
:::
::::
```

Rules: 1–5 plans; one ISO 4217 currency per comparison; at most one recommended
plan; price is numeric unless explicitly authored as custom; ContentKit never
invents a discount or converts currencies.

### Gallery

```md
::::gallery{title="Publishing surfaces" role="supporting" preferredPattern="editorial-gallery"}
::figure{src="asset:images/dashboard.png" alt="Dashboard with operating metrics" caption="Operations overview" aspect="16/9"}
::figure{src="asset:images/mobile.png" alt="Report cards on a narrow screen" caption="Compact reflow" aspect="9/16"}
::::
```

Rules: 2–24 figures; informative media requires alternative text; captions are
optional; sources pass through the existing asset trust boundary; standalone
output never depends on a remote request.

### Data table

```md
::::data-table{title="Service status" rowKey="Service" keyColumns="Service,Status" columnRoles="Service:key,Status:status,Latency:number" defaultSort="Service" role="primary"}
| Service | Status | Latency |
|---|---|---:|
| Compile API | Stable | 184 ms |
| Registry API | Stable | 42 ms |
::::
```

The original table remains the accessible source. Narrow containers resolve to
labeled records instead of compressing columns. Static outputs are bounded and
report omitted rows explicitly.

### Application shell

```md
::::application-shell{title="Operations workspace" preferredPattern="sidebar-shell"}
:::region{name="navigation" title="Workspace navigation"}
- Overview
- Reports
- Settings
:::
:::region{name="main" title="Current report"}
The complete semantic report remains usable without the shell.
:::
::::
```

Shell regions add information architecture while preserving the headless
content model. HTML uses landmarks and compact navigation; static exports use a
deterministic region summary.

## Declarative Pattern Package contract

Every stable pattern is a repository-owned `.pattern.md` file. Strict YAML
frontmatter provides a machine-readable contract and the Markdown body explains
the intended use to a human reviewer. Remote executable extensions are not
accepted.

Each registry descriptor includes:

- `accepts`: semantic node types, typed data shapes, and item bounds;
- `semantics`: what the pattern conveys, implies, and must reject;
- `narrative`: the question answered, communication goal, story arc, reader
  takeaway, and decision support;
- `selection`: compatible intents, canvases, and densities;
- `slots`: required and optional semantic child roles;
- `capabilities`: HTML, SVG, PNG, print, and optional interactions;
- `rendering_strategy`: recommended primary output, supported alternatives,
  rationale, and PNG's derived-export role;
- `requires`: trusted patterns and layout primitives;
- `content_budget`: maximum items, words, characters, code lines, table rows,
  media, columns, series, and categories;
- `input_contract`: typed field roles, units, currency rules, time formats, and
  ordering requirements;
- `responsive`, `fallbacks`, and `static_fallback`: deterministic degradation;
- `examples` and `spec_examples`: positive Markdown and explicit
  counterexamples;
- `agent_hints`: selection, rejection, and authoring guidance.

The registry rejects duplicate IDs, invalid semantic types, unknown primitives,
unknown dependencies, missing fallbacks, and fallback cycles during startup.

## Values, units, and time

Agents must separate the stored value from its presentation label. Pattern
contracts support the following unit kinds:

`count`, `percentage`, `percentage-point`, `currency`, `duration`, `rate`,
`data-size`, `distance`, `area`, `volume`, `temperature`, `angle`, and `custom`.

Important invariants:

- currency uses an ISO 4217 code and one currency within a comparison;
- percentages and percentage-point changes are distinct semantics;
- durations contain a numeric value and an explicit unit;
- comparable series use compatible units unless normalization is explicit;
- calendar values use ISO 8601 dates;
- instants use ISO 8601 datetimes with a timezone;
- clock time uses a 24-hour value;
- temporal data includes sortable values while localized display labels remain
  separate;
- supported granularities are minute, hour, day, week, month, quarter, and year.

These contracts let an external agent distinguish a calendar heatmap from a
timeline, a rate from a count, and a monetary amount from a generic number.

## Structured diagnostics

Headless compilation returns machine-readable diagnostics instead of silently
changing meaning. The implemented diagnostic families include:

- incompatible, unknown, or responsive pattern fallback;
- unavailable output or interaction capability;
- text reflow or truncation;
- omitted items;
- exceeded item, word, character, code, table, media, column, series, or
  category budgets;
- degraded patterns and missing assets.

`allowOverflow` is not an authoring escape hatch. ContentKit must reflow, select
a safe fallback, or reject invalid input.

## Container-aware responsive resolution

Pattern resolution uses the effective container, not only the browser viewport:

- container width and available height;
- viewport width and height;
- embedding context and requested density;
- output capability and print mode;
- semantic item count and content budgets.

For example, a horizontal process can resolve to a vertical journey, a matrix
to labeled records, and a multi-column FAQ to a readable list. The resolved
pattern and reason are returned in the model.

## Complete review gallery

Run `npm run review:patterns`, then open
`examples/pattern-gallery/index.html`. The gallery dogfoods the complete
pipeline and contains:

- the five-stage semantic publishing explanation;
- highlighted fenced code from the standard Markdown renderer;
- a live technical diagram introduced by its process-story question;
- a standalone light/dark server-rendered chart introduced by its analytical
  question;
- a semantic report composed from metrics, progress, and a decision;
- nine declarative report, diagram, and code story-selection guides;
- all 81 declarative information patterns grouped by communication purpose;
- light/dark and six real container choices;
- semantic source, pattern contract, SVG, and PNG review links.

The gallery is an example application only. Compilation, recommendation,
validation, SVG, and PNG remain available headlessly.

The gallery's `Render as` control currently offers `SVG` and `PNG`. SVG is the
known-good visual-composition baseline and PNG is rasterized from those exact
SVG bytes. Semantic HTML remains available through the compile API, but the
gallery does not claim pixel equivalence while renderer-neutral HTML visual
layout is being rebuilt.

`GET /v1/publishing-guides` exposes the same story-selection model shown in the
gallery. Agents select by question, semantics, required evidence, and rejection
conditions before choosing a technical authoring form.

## Verification contract

`npm run validate:visuals` verifies the currently generated reference matrix:

- 81 patterns × 2 appearances × 6 widths = 972 SVG and 972 PNG outputs;
- 1,097 semantic HTML cases, including no-JavaScript, zoom, print, reduced
  motion, keyboard, and resilience fixtures;
- 12 complete gallery-page cases across six widths and both appearances;
- browser screenshots at 390 px and 1440 px in light and dark;
- real Chromium measurements for clipping, text overlap, container escape,
  truncation, separator crossings, horizontal overflow, sticky navigation, and
  output presence;
- deterministic model, SVG, and PNG hashes;
- source tables, accessible names, reading order, minimum font sizes, and exact
  responsive fallback resolution.

Generated reports are written to `examples/pattern-gallery/validation.json`,
`browser-validation.json`, `html-validation.json`, and
`page-validation.json`. Review screenshots are under
`examples/pattern-gallery/validation-screenshots/`.

## Scope boundary

ContentKit remains one product: a headless mini-CMS plus semantic visual
composition and information patterns. The architecture does not include slide
product adapters, presentation runtimes, office export abstractions, or a
product-specific chart authoring contract.
