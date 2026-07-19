import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown } from '../../src/markdown.mjs'

const frontmatter = `---
kind: post
title: Test post
locale: de
slug: test-post
translationKey: test-post
tags: [one, two]
---
`

test('renders the rich Markdown profile', async () => {
  const result = await renderMarkdown(`${frontmatter}
# Heading

~~strike~~

| A | B |
| - | - |
| 1 | 2 |

- [x] done

$E=mc^2$

\`\`\`js
const ok = true
\`\`\`

\`\`\`mermaid
flowchart LR; A-->B
\`\`\`
`)
  assert.equal(result.meta.kind, 'post')
  assert.deepEqual(result.meta.tags, ['one', 'two'])
  assert.match(result.html, /<table>/)
  assert.match(result.html, /class="katex"/)
  assert.match(result.html, /class="mermaid"/)
  assert.match(result.html, /shiki/)
  assert.equal(result.hasMermaid, true)
  assert.equal(result.semantic.nodes[0].type, 'diagram')
  assert.equal(result.semantic.nodes[0].diagram_kind, 'process')
  assert.equal(result.semantic.nodes[0].publishing_guide, 'process-diagram')
})

test('mermaid fences expose authored narrative intent for agents without changing the technical source', async () => {
  const result = await renderMarkdown(`${frontmatter}
\`\`\`mermaid title="Request lifecycle" question="Where can a request fail?" insight="Validation happens before persistence." action="Alert on rejected requests." limitation="Retries are omitted."
sequenceDiagram
  Client->>API: Submit
  API->>Store: Persist
\`\`\`
`)
  const diagram = result.semantic.nodes[0]
  assert.equal(diagram.diagram_kind, 'sequence')
  assert.equal(diagram.title, 'Request lifecycle')
  assert.equal(diagram.publishing_guide, 'sequence-diagram')
  assert.equal(diagram.narrative.question, 'Where can a request fail?')
  assert.equal(diagram.narrative.reader_takeaway, 'Validation happens before persistence.')
  assert.equal(diagram.narrative.action, 'Alert on rejected requests.')
  assert.equal(diagram.narrative.limitation, 'Retries are omitted.')
  assert.match(result.html, /Client->>API: Submit/)
})

test('does not pass through raw HTML or script URLs', async () => {
  const result = await renderMarkdown(`${frontmatter}
<script>alert(1)</script>
<img src=x onerror=alert(2)>
[bad](javascript:alert(3))
`)
  assert.doesNotMatch(result.html, /script|onerror|javascript:/i)
})

test('validates required frontmatter', async () => {
  await assert.rejects(() => renderMarkdown('---\nlocale: invalid_locale\n---\n# Missing'), /title is required/)
})

test('tldr and faq frontmatter are validated, trimmed and default to empty', async () => {
  const doc = `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\ntldr:\n  - " Erste Kernaussage "\n  - Zweite Kernaussage\nfaq:\n  - q: " Was ist T? "\n    a: Ein Test.\n---\nBody.`
  const result = await renderMarkdown(doc)
  assert.deepEqual(result.meta.tldr, ['Erste Kernaussage', 'Zweite Kernaussage'])
  assert.deepEqual(result.meta.faq, [{ q: 'Was ist T?', a: 'Ein Test.' }])

  const plain = await renderMarkdown(`---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n---\nBody.`)
  assert.deepEqual(plain.meta.tldr, [])
  assert.deepEqual(plain.meta.faq, [])
})

test('malformed tldr and faq frontmatter fail the upload with a clear 422', async () => {
  const doc = (fields) => `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n${fields}\n---\nBody.`
  await assert.rejects(() => renderMarkdown(doc('tldr: not a list')), /tldr must be a list/)
  await assert.rejects(() => renderMarkdown(doc('tldr:\n  - ok\n  - ""')), /tldr must not contain empty entries/)
  await assert.rejects(
    () => renderMarkdown(doc('tldr:\n  - q: nested\n    a: object')),
    /tldr must be a list of strings/,
  )
  await assert.rejects(() => renderMarkdown(doc('faq: not a list')), /faq must be a list/)
  await assert.rejects(
    () => renderMarkdown(doc('faq:\n  - q: only a question')),
    /faq must be a list of \{ q, a \} entries/,
  )
  await assert.rejects(
    () => renderMarkdown(doc('faq:\n  - q: ""\n    a: answer')),
    /faq entries need a non-empty q and a/,
  )
})

test('a leading heading that repeats the title is dropped from the rendered html', async () => {
  // The layout renders the frontmatter title as the page <h1>; the authored copy would
  // make it the second one and start the document outline twice.
  const doc = (body) => `---\nkind: post\ntitle: Signed Webhooks\nlocale: de\nslug: s\nsummary: S\n---\n\n${body}`
  const h1s = (html) => (html.match(/<h1/g) || []).length

  assert.equal(h1s((await renderMarkdown(doc('# Signed Webhooks\n\nText.'))).html), 0)
  // Matching is on normalized text, so casing, spacing and inline markup do not matter.
  assert.equal(h1s((await renderMarkdown(doc('#   signed   webhooks\n\nText.'))).html), 0)
  assert.equal(h1s((await renderMarkdown(doc('# Signed *Webhooks*\n\nText.'))).html), 0)

  // Inline markdown in the *title* is the case that shipped broken: mdast renders
  // `` `async/await` `` as an inlineCode node without backticks, while the frontmatter
  // title is a raw string that still has them.
  const coded = (title, body) => `---\nkind: post\ntitle: ${title}\nlocale: de\nslug: s\nsummary: S\n---\n\n${body}`
  assert.equal(h1s((await renderMarkdown(coded('Control Flow vor `x/y`', '# Control Flow vor `x/y`\n\nT.'))).html), 0)
  assert.equal(h1s((await renderMarkdown(coded('Signed *Webhooks*', '# Signed *Webhooks*\n\nT.'))).html), 0)
  assert.equal(h1s((await renderMarkdown(coded('snake_case Regeln', '# snake_case Regeln\n\nT.'))).html), 0)

  // A near-miss must not be swallowed.
  assert.equal(h1s((await renderMarkdown(doc('# Signed Webhooks II\n\nText.'))).html), 1)

  // A body that deliberately opens with a different top-level heading keeps it, and a
  // heading that is not the first block is never touched.
  assert.equal(h1s((await renderMarkdown(doc('# Vorwort\n\nText.'))).html), 1)
  assert.equal(h1s((await renderMarkdown(doc('Intro.\n\n# Signed Webhooks\n\nText.'))).html), 1)
})

test('dropping the redundant title leaves the body, the anchors and the source alone', async () => {
  const result = await renderMarkdown(
    `---\nkind: post\ntitle: T\nlocale: de\nslug: s\nsummary: S\n---\n\n# T\n\nBody stays.\n\n## Section\n`,
  )
  assert.match(result.html, /Body stays\./)
  assert.match(result.html, /<h2[^>]*id="section"/, 'lower headings keep their slugs and anchors')
  // `source` feeds llms-full.txt and the reading-time estimate: it is the authored
  // document, not the rendered one.
  assert.match(result.source, /^\s*# T\n/)
})

test('extra frontmatter passes through verbatim with its YAML types preserved', async () => {
  const doc = `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\nextra:\n  reading_level: 3\n  series: effect-ts\n  audiences: [devs, ops]\n  ratings:\n    stars: 4.5\n    source: internal\n---\nBody.`
  const result = await renderMarkdown(doc)
  assert.deepEqual(result.meta.extra, {
    reading_level: 3,
    series: 'effect-ts',
    audiences: ['devs', 'ops'],
    ratings: { stars: 4.5, source: 'internal' },
  })
})

test('absent or empty extra and related leave the meta exactly as it is today', async () => {
  const plain = await renderMarkdown(`---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n---\nBody.`)
  assert.ok(!('extra' in plain.meta), 'absent extra must not appear in meta')
  assert.ok(!('related_slugs' in plain.meta), 'absent related must not appear in meta')

  // Empty values are treated as absent, so old revisions and empty-authored
  // ones serialize to byte-identical metadata.
  const empty = await renderMarkdown(
    `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\nextra: {}\nrelated: []\n---\nBody.`,
  )
  assert.equal(JSON.stringify(empty.meta), JSON.stringify(plain.meta))
})

test('malformed extra frontmatter fails the upload with a clear 422', async () => {
  const doc = (fields) => `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n${fields}\n---\nBody.`
  await assert.rejects(() => renderMarkdown(doc('extra: not a map')), /extra must be a map of custom fields/)
  await assert.rejects(() => renderMarkdown(doc('extra:\n  - a\n  - b')), /extra must be a map of custom fields/)
  await assert.rejects(
    () => renderMarkdown(doc('extra:\n  BadKey: 1')),
    /extra keys must match \[a-z\]\[a-z0-9_\]\{0,63\}/,
  )
  await assert.rejects(
    () => renderMarkdown(doc('extra:\n  nested:\n    BadKey: 1')),
    /extra keys must match/,
    'nested map keys follow the same pattern',
  )
  const manyFields = `extra:\n${Array.from({ length: 33 }, (_, i) => `  field_${i}: 1`).join('\n')}`
  await assert.rejects(() => renderMarkdown(doc(manyFields)), /extra allows at most 32 fields/)
  const longList = `extra:\n  list: [${Array.from({ length: 65 }, (_, i) => i).join(', ')}]`
  await assert.rejects(() => renderMarkdown(doc(longList)), /extra lists allow at most 64 entries/)
  const bigMap = `extra:\n  map:\n${Array.from({ length: 33 }, (_, i) => `    key_${i}: 1`).join('\n')}`
  await assert.rejects(() => renderMarkdown(doc(bigMap)), /extra maps allow at most 32 entries/)
  // Depth is capped at two: a map inside a map is not a scalar entry anymore.
  await assert.rejects(
    () => renderMarkdown(doc('extra:\n  map:\n    deep:\n      too: far')),
    /extra values must be scalars, lists of scalars or flat maps of scalars/,
  )
  await assert.rejects(() => renderMarkdown(doc('extra:\n  gone: null')), /extra values must be scalars/)
  await assert.rejects(() => renderMarkdown(doc('extra:\n  list:\n    - {a: 1}')), /extra values must be scalars/)
  const oversized = `extra:\n  blob: "${'x'.repeat(16400)}"`
  await assert.rejects(() => renderMarkdown(doc(oversized)), /extra must not exceed 16 KiB/)
})

test('lenient rendering drops malformed extra and related instead of throwing', async () => {
  // The build path (buildSite) and the Read API replay revisions stored before
  // the extra/related rules existed — a value that was valid then must never
  // fail a future release, only be dropped with a warning.
  const doc = `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\nextra: not a map\nrelated: see-also\n---\nBody.`
  await assert.rejects(() => renderMarkdown(doc), /extra must be a map of custom fields/, 'the write path stays strict')
  const result = await renderMarkdown(doc, { lenient: true })
  assert.ok(!('extra' in result.meta))
  assert.ok(!('related_slugs' in result.meta))
  assert.deepEqual(
    result.warnings.map((warning) => warning.split(':')[0]),
    ['frontmatter extra dropped', 'frontmatter related dropped'],
  )
  assert.match(result.html, /Body\./, 'the document still renders')

  // Lenient only forgives the additive keys — a broken document stays broken.
  await assert.rejects(
    () => renderMarkdown(`---\nkind: post\nlocale: de\n---\nBody.`, { lenient: true }),
    /title is required/,
  )
  // And a valid document yields no warnings in either mode.
  const clean = await renderMarkdown(`---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n---\nBody.`, {
    lenient: true,
  })
  assert.deepEqual(clean.warnings, [])
})

test('related frontmatter is validated and stored as related_slugs', async () => {
  const doc = (fields) => `---\nkind: post\ntitle: T\nlocale: de\nslug: t\nsummary: S\n${fields}\n---\nBody.`
  const result = await renderMarkdown(doc('related: [first-post, second-post]'))
  assert.deepEqual(result.meta.related_slugs, ['first-post', 'second-post'])
  assert.ok(!('related' in result.meta), 'the authored key must not shadow the derived related projection')

  await assert.rejects(() => renderMarkdown(doc('related: not-a-list')), /related must be a list of slugs/)
  await assert.rejects(
    () => renderMarkdown(doc('related: [Not A Slug]')),
    /related must contain lowercase letters, numbers and hyphens/,
  )
  const tooMany = `related: [${Array.from({ length: 9 }, (_, i) => `post-${i}`).join(', ')}]`
  await assert.rejects(() => renderMarkdown(doc(tooMany)), /related allows at most 8 references/)
  await assert.rejects(() => renderMarkdown(doc('related: [a, a]')), /related must not contain duplicates/)
  await assert.rejects(() => renderMarkdown(doc('related: [t]')), /related must not reference the document itself/)
})

test('template, hierarchy, changelog and access frontmatter are validated', async () => {
  const markdown = `---
kind: page
title: Install
locale: en
slug: install
translationKey: install-v2
layout: docs
docKey: install
docsVersion: v2
parent: start
navTitle: Quick install
navOrder: 20
category: Setup
releaseVersion: 2.0.0
changeTypes: [added, security]
access: [customers, team]
---
# Install`
  const { meta } = await renderMarkdown(markdown)
  assert.equal(meta.layout, 'docs')
  assert.equal(meta.doc_key, 'install')
  assert.equal(meta.docs_version, 'v2')
  assert.equal(meta.parent, 'start')
  assert.equal(meta.nav_title, 'Quick install')
  assert.deepEqual(meta.change_types, ['added', 'security'])
  assert.deepEqual(meta.access, ['customers', 'team'])
  await assert.rejects(() => renderMarkdown(markdown.replace('layout: docs', 'layout: arbitrary')), /layout must be/)
  await assert.rejects(() => renderMarkdown(markdown.replace('[customers, team]', '[Bad Group]')), /invalid/)
})

test('landing-page directives render only controlled content blocks', async () => {
  const { html } = await renderMarkdown(
    '---\ntitle: Product\nlocale: en\nslug: product\nlayout: landing\n---\n:::hero\n# Fast releases\n:::',
  )
  assert.match(html, /class="content-block content-block-hero"/)
  assert.doesNotMatch(html, /<script/)
})

const reportDoc = (body, fields = '') => `---
kind: page
layout: composition
title: Quarterly report
locale: de
slug: quarterly-report
composition:
  format: report
  canvas: flow
  intent: status
${fields}---
${body}`

test('reportCadence is a bounded report-only catalog field', async () => {
  const { meta } = await renderMarkdown(reportDoc(':::hero\n## Status\n\nStable.\n:::', 'reportCadence: daily\n'))
  assert.equal(meta.report_cadence, 'daily')
  await assert.rejects(
    () => renderMarkdown(reportDoc(':::hero\n## Status\n:::', 'reportCadence: realtime\n')),
    /reportCadence must be one of hourly, daily, weekly, monthly, quarterly, yearly/,
  )
  await assert.rejects(
    () =>
      renderMarkdown(
        '---\nkind: page\nlayout: landing\ntitle: Product\nlocale: en\nslug: product\nreportCadence: daily\n---\nBody.',
      ),
    /reportCadence requires composition\.format: report/,
  )
})

test('legacy report authoring normalizes into the semantic composition pipeline', async () => {
  const rendered = await renderMarkdown(`---
kind: page
layout: report
title: Legacy report
locale: en
slug: legacy-report
reportCadence: monthly
---

::::report-grid{columns="2"}
::metric{label="Revenue" value="42"}

:::report-card{title="Decision"}
Proceed with the release.
:::
::::`)
  assert.equal(rendered.meta.layout, 'composition')
  assert.equal(rendered.meta.composition.format, 'report')
  assert.equal(rendered.meta.report_cadence, 'monthly')
  assert.deepEqual(
    rendered.semantic.nodes.map((node) => node.type),
    ['group', 'metric', 'card'],
  )
  assert.match(rendered.html, /composition-group/)
  assert.match(rendered.source, /report-grid/)
})

test('composition directives produce controlled dashboard markup and normalized chart descriptors', async () => {
  const result = await renderMarkdown(
    reportDoc(`::::group{columns="4"}
::metric{label="Umsatz" value="51 Tsd. €" trend="+21%" tone="positive"}

:::card{title="Qualität" span="1"}
Status: :badge[Stabil]{tone="positive"}

::progress{label="Abdeckung" value="92" max="100"}
:::

:::chart{type="bar" title="Umsatz nach Monat" description="Umsatz und Ziel im ersten Quartal" unit="Tsd. €" span="2"}
| Monat | Umsatz | Ziel |
|---|---:|---:|
| Jan | 42 | 45 |
| Feb | 51 | — |
:::
::::`),
  )
  assert.match(result.html, /class="composition-group composition-columns-4"/)
  assert.match(result.html, /class="report-metric report-tone-positive report-span-1"/)
  assert.match(result.html, /role="progressbar"[^>]*aria-valuenow="92"/)
  assert.match(result.html, /class="report-badge report-tone-positive"/)
  assert.match(result.html, /data-report-chart="0"/)
  assert.match(result.html, /<details class="report-chart-data">/)
  assert.match(result.html, /report-chart-summary">Daten</)
  assert.equal(result.charts.length, 1)
  assert.deepEqual(result.charts[0], {
    id: 0,
    type: 'bar',
    data_shape: 'series',
    title: 'Umsatz nach Monat',
    description: 'Umsatz und Ziel im ersten Quartal',
    orientation: 'vertical',
    stacked: false,
    unit: 'Tsd. €',
    headers: ['Monat', 'Umsatz', 'Ziel'],
    rows: [
      ['Jan', 42, 45],
      ['Feb', 51, null],
    ],
    narrative: {
      question: 'How do values compare across categories?',
      communication_goal: 'Compare magnitude on a shared baseline.',
      intended_insight: 'Umsatz und Ziel im ersten Quartal',
      action: null,
      limitation: null,
    },
  })
})

test('specialized chart shapes normalize typed evidence, narrative intent and reject misleading geometry', async () => {
  const result = await renderMarkdown(
    reportDoc(`:::chart{type="line" shape="uncertainty" title="Forecast" description="Estimate with interval" unit="%" question="How reliable is the forecast?" insight="Growth continues, but the interval widens." action="Keep reserve capacity." limitation="Bounds are model estimates."}
| Quarter | Lower | Estimate | Upper |
|---|---:|---:|---:|
| Q1 | 10 | 14 | 19 |
| Q2 | 12 | 17 | 23 |
:::`),
  )
  assert.equal(result.charts[0].data_shape, 'uncertainty')
  assert.deepEqual(result.charts[0].rows[0], ['Q1', 10, 14, 19])
  assert.deepEqual(result.charts[0].narrative, {
    question: 'How reliable is the forecast?',
    communication_goal: 'Keep the central estimate and its lower and upper bounds together.',
    intended_insight: 'Growth continues, but the interval widens.',
    action: 'Keep reserve capacity.',
    limitation: 'Bounds are model estimates.',
  })

  await assert.rejects(
    () =>
      renderMarkdown(
        reportDoc(`:::chart{type="bar" shape="range" title="Invalid range" description="Lower exceeds upper"}
| Item | Lower | Upper |
|---|---:|---:|
| API | 8 | 3 |
:::`),
      ),
    /lower values not greater than upper values/,
  )
  await assert.rejects(
    () =>
      renderMarkdown(
        reportDoc(`:::chart{type="bar" shape="geo-point" title="Invalid map" description="Latitude is invalid"}
| Place | Latitude | Longitude | Value |
|---|---:|---:|---:|
| North | 95 | 10 | 2 |
:::`),
      ),
    /latitude -90\.\.90 and longitude -180\.\.180/,
  )
})

test('composition charts reject malformed tables, unsupported options and unsafe scope expansion', async () => {
  const rejects = (body, pattern) => assert.rejects(() => renderMarkdown(reportDoc(body)), pattern)
  await rejects(
    ':::chart{type="scatter" title="T" description="D"}\n| A | B |\n|-|-|\n| x | 1 |\n:::',
    /chart type must be/,
  )
  await rejects(
    ':::chart{type="line" title="T" description="D" orientation="horizontal"}\n| A | B |\n|-|-|\n| x | 1 |\n:::',
    /orientation is only supported/,
  )
  await rejects(
    ':::chart{type="donut" title="T" description="D"}\n| A | B | C |\n|-|-|-|\n| x | 1 | 2 |\n:::',
    /exactly one category and one value/,
  )
  await rejects(
    ':::chart{type="bar" title="T" description="D"}\n| A | B |\n|-|-|\n| x | nope |\n:::',
    /must be a finite number/,
  )
  await rejects(
    ':::chart{type="bar" title="T" description="D" option="raw"}\n| A | B |\n|-|-|\n| x | 1 |\n:::',
    /unknown attribute "option"/,
  )
  await rejects(':::unknown{title="T"}\nText\n:::', /unknown composition directive/)

  const embedded = await renderMarkdown(`---
kind: post
title: Normal article
locale: de
slug: normal-article
summary: A normal article with an embedded semantic comparison.
---

Introductory prose.

::::comparison{title="Delivery models" role="primary" preferredPattern="split-comparison"}
:::side{label="Live view"}
- Question · What is happening now?
- State · Mutable
:::
:::side{label="Published report"}
- Question · What was approved for this period?
- State · Immutable
:::
::::`)
  assert.equal(embedded.meta.layout, null)
  assert.equal(embedded.semantic.presentation, 'embedded')
  assert.equal(embedded.semantic.nodes.length, 1)
  assert.equal(embedded.semantic.nodes[0].type, 'comparison')
  assert.equal(embedded.semantic.nodes[0].preferred_pattern, 'split-comparison')
  assert.equal(embedded.composition, null)
  assert.match(embedded.html, /composition-comparison/)
  assert.match(embedded.html, /composition-side/)
})

test('report chart resource limits fail at write time', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => `| row-${index} | ${index} |`).join('\n')
  await assert.rejects(
    () =>
      renderMarkdown(
        reportDoc(`:::chart{type="bar" title="Too many" description="Too many rows"}
| Name | Value |
|-|-:|
${rows}
:::`),
      ),
    /at most 200 data rows/,
  )
})

const compositionDocument = (body, composition = '') => `---
layout: composition
title: Information contract
summary: Strict semantic composition fixture.
locale: de
slug: information-contract
composition:
  format: infographic
  canvas: portrait
  intent: explain
${composition}
---

${body}`

test('information families preserve authored business semantics and accessible no-JavaScript HTML', async () => {
  const result = await renderMarkdown(
    compositionDocument(
      `::::faq{title="Häufige Fragen" role="primary" preferredPattern="faq-list"}
:::question{title="Ist HTML vollständig?" category="Ausgabe"}
Ja. Antworten bleiben im Dokument.
:::
:::question{title="Ist SVG statisch?" category="Ausgabe"}
Ja. Es lädt keine entfernten Ressourcen.
:::
::::`,
      '  audience: Einsteiger\n  question: Welches Muster erklärt die Aussage ehrlich?\n  goal: Sichere Patternwahl\n  thesis: Semantik führt die Darstellung.\n  conclusion: Fallbacks bleiben deterministisch.\n  action: Vor Veröffentlichung validieren.\n  limitations: [Containerbreite muss bekannt sein.]\n  disclosure: progressive',
    ),
  )
  assert.equal(result.semantic.nodes[0].type, 'faq')
  assert.equal(result.semantic.nodes[0].questions.length, 2)
  assert.match(result.html, /<details class="composition-question" open>/)
  assert.match(result.html, /<summary class="composition-question-title">Ist HTML vollständig\?/)
  assert.equal(result.narrative.target_audience, 'Einsteiger')
  assert.equal(result.narrative.question, 'Welches Muster erklärt die Aussage ehrlich?')
  assert.equal(result.narrative.communication_goal, 'Sichere Patternwahl')
  assert.equal(result.narrative.action, 'Vor Veröffentlichung validieren.')
  assert.deepEqual(result.narrative.limitations, ['Containerbreite muss bekannt sein.'])
  assert.equal(result.narrative.disclosure, 'progressive')
  assert.ok(Array.isArray(result.narrative.relationships))
})

test('commercial, media, code, table and shell invariants fail before layout', async () => {
  await assert.rejects(
    () =>
      renderMarkdown(
        compositionDocument(`::::pricing{title="Plans" currency="EUR" billing="monthly" role="primary"}
:::plan{name="A" price="1" cadence="month" recommended="true"}
- Feature
:::
:::plan{name="B" price="2" cadence="month" recommended="true"}
- Feature
:::
::::`),
      ),
    /at most one recommended plan/,
  )
  await assert.rejects(
    () =>
      renderMarkdown(
        compositionDocument(`::::gallery{title="Gallery" role="primary"}
::figure{src="asset:images/a.png" caption="A"}
::figure{src="asset:images/b.png" alt="B"}
::::`),
      ),
    /require alt text/,
  )
  await assert.rejects(
    () =>
      renderMarkdown(
        compositionDocument(`::::code-example{title="Code" role="primary"}
:::variant{label="A" language="bash" default="true"}
\`\`\`bash
echo A
\`\`\`
:::
:::variant{label="B" language="bash" default="true"}
\`\`\`bash
echo B
\`\`\`
:::
::::`),
      ),
    /at most one default variant/,
  )
  await assert.rejects(
    () =>
      renderMarkdown(
        compositionDocument(`:::data-table{title="Rows" rowKey="ID" role="primary"}
| ID | Status |
| --- | --- |
| same | ok |
| same | error |
:::`),
      ),
    /rowKey values must be non-empty and unique/,
  )
  await assert.rejects(
    () =>
      renderMarkdown(
        compositionDocument(`::::application-shell{title="Shell" role="primary"}
:::region{name="navigation" label="Navigation"}
One
:::
:::region{name="secondary" label="Secondary"}
Two
:::
::::`),
      ),
    /requires a main region/,
  )
})
