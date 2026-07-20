import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileCompositionMarkdown } from '../../src/composition-output.mjs'
import {
  getPattern,
  patternRegistry,
  patternRegistryHash,
  recommendPatterns,
  resolvePattern,
} from '../../src/composition-registry.mjs'
import { getPublishingGuide, publishingGuideRegistry } from '../../src/publishing-guides.mjs'

const semanticProcess = {
  schema_version: '1',
  title: 'Tool call',
  locale: 'en',
  nodes: [
    {
      id: 'process-1',
      type: 'process',
      role: 'primary',
      steps: [
        { id: 'step-1', label: 'Client' },
        { id: 'step-2', label: 'Server' },
        { id: 'step-3', label: 'Tool' },
      ],
    },
  ],
}

const markdown = `---
kind: page
layout: composition
title: MCP at a glance
summary: A shared contract for tools.
locale: en
slug: mcp-at-a-glance
composition:
  format: infographic
  canvas: landscape
  intent: sequence
  density: balanced
  preferredPattern: connected-process
---

:::process{title="Tool call" role="primary"}
- Client
- Server
- Tool
:::`

const svgFontSizes = (svg) => [...svg.matchAll(/font-size="([\d.]+)"/g)].map((match) => Number(match[1]))

test('the declarative registry exposes 81 unique, versioned and agent-readable patterns', () => {
  assert.equal(patternRegistry.length, 81)
  assert.equal(new Set(patternRegistry.map((pattern) => pattern.id)).size, 81)
  assert.match(patternRegistryHash, /^[0-9a-f]{64}$/)
  for (const pattern of patternRegistry) {
    assert.equal(pattern.schema_version, 1)
    assert.ok(pattern.title)
    assert.ok(pattern.summary)
    assert.ok(pattern.narrative.question.length >= 12)
    assert.ok(pattern.narrative.communication_goal.length >= 12)
    assert.ok(pattern.narrative.story_arc.length >= 1)
    assert.ok(pattern.narrative.reader_takeaway.length >= 12)
    assert.ok(pattern.narrative.decision_support.length >= 12)
    assert.ok(pattern.accepts.node_types.length > 0)
    assert.match(pattern.source_path, /\.pattern\.md$/)
    assert.equal(getPattern(pattern.id), pattern)
    assert.ok(pattern.slots.length)
    assert.ok(pattern.capabilities.outputs.includes('html'))
    assert.ok(pattern.capabilities.outputs.includes('svg'))
    assert.ok(['html', 'svg'].includes(pattern.rendering_strategy.primary_output))
    assert.ok(pattern.rendering_strategy.alternatives.length)
    assert.equal(pattern.rendering_strategy.html_fidelity, 'layout-equivalent')
    assert.equal(pattern.rendering_strategy.png_role, 'derived-static-export')
    assert.ok(pattern.requires.primitives.length)
    assert.ok(pattern.content_budget.max_items >= pattern.accepts.min_items)
    assert.ok(pattern.content_budget.max_title_characters >= 1)
    assert.ok(pattern.content_budget.max_summary_characters >= 1)
    assert.ok(pattern.input_contract.fields.length)
    assert.ok(pattern.input_contract.units.accepted_kinds.includes('currency'))
    assert.ok(pattern.input_contract.temporal.formats.includes('ISO 8601 date'))
    assert.ok(pattern.examples.length)
    assert.ok(pattern.spec_examples.some((example) => example.kind === 'positive' && example.markdown))
    assert.ok(pattern.agent_hints.use_when.length)
    assert.ok(getPattern(pattern.static_fallback))
  }
})

test('publishing guides make report, diagram, and code stories machine-readable', () => {
  assert.equal(publishingGuideRegistry.length, 9)
  assert.deepEqual(new Set(publishingGuideRegistry.map((guide) => guide.kind)), new Set(['report', 'diagram', 'code']))
  for (const guide of publishingGuideRegistry) {
    assert.equal(getPublishingGuide(guide.id), guide)
    assert.ok(guide.narrative.question.length >= 12)
    assert.ok(guide.narrative.story_arc.length >= 2)
    assert.ok(guide.selection.use_when.length)
    assert.ok(guide.input_contract.required.length)
    assert.ok(guide.input_contract.constraints.length)
    assert.ok(guide.examples.length)
  }
})

test('formal layout and render trees are deterministic, bounded and container-aware', async () => {
  const options = {
    viewport: { width: 1440, height: 1024 },
    container: { width: 390, height: 844 },
    outputs: ['model', 'svg'],
  }
  const first = await compileCompositionMarkdown(markdown, options)
  const second = await compileCompositionMarkdown(markdown, options)
  assert.deepEqual(first.layout, second.layout)
  assert.deepEqual(first.render_tree, second.render_tree)
  assert.equal(first.layout.type, 'layout-root')
  assert.equal(first.layout.responsive.breakpoint, 'compact')
  assert.deepEqual(first.layout.responsive.viewport, { width: 1440, height: 1024 })
  assert.deepEqual(first.layout.responsive.container, { width: 390, height: 844 })
  assert.equal(first.render_tree.type, 'svg')
  assert.ok(first.layout.children.find((node) => node.role === 'main').children.length)
  assert.ok(first.render_tree.children.find((node) => node.role === 'main').children.length)
  assert.deepEqual(
    first.render_tree.children.map((node) => node.role),
    ['banner', 'main', 'contentinfo'],
  )
  for (const node of first.layout.children) {
    assert.ok(Object.values(node.box).every(Number.isFinite))
    assert.ok(node.box.width >= 0)
    assert.ok(node.box.height >= 0)
  }
})

test('visual HTML is an explicit layout-equivalent representation with a semantic compatibility default', async () => {
  const visual = await compileCompositionMarkdown(markdown, {
    viewport: { width: 1200, height: 800 },
    container: { width: 720, height: 680 },
    outputs: ['html', 'print'],
    html_presentation: 'visual',
  })
  assert.equal(visual.rendering.html_presentation, 'visual')
  assert.equal(visual.rendering.fidelity, 'layout-equivalent')
  assert.match(visual.renders.html, /class="ck-visual-composition ck-layout-sequence"/)
  assert.match(visual.renders.html, new RegExp(`data-pattern="${visual.composition.resolved_pattern}"`))
  assert.match(visual.renders.html, /container-type:inline-size/)
  assert.match(visual.renders.print_html, /composition-print/)

  const semantic = await compileCompositionMarkdown(markdown, { outputs: ['html'] })
  assert.equal(semantic.rendering.html_presentation, 'semantic')
  assert.doesNotMatch(semantic.renders.html, /ck-visual-composition/)
  await assert.rejects(
    () => compileCompositionMarkdown(markdown, { outputs: ['html'], html_presentation: 'canvas' }),
    /html_presentation must be semantic or visual/,
  )
})

test('recommendation uses authored narrative without requiring an internal LLM runtime', () => {
  const recommendations = recommendPatterns(semanticProcess, {
    intent: 'sequence',
    canvas: 'landscape',
    density: 'balanced',
    narrative: {
      question: 'How does work move through ordered stages and handoffs?',
      communication_goal: 'Explain a directed process from trigger to outcome.',
      action: 'Review the handoff that blocks the outcome.',
      disclosure: 'progressive',
    },
  })
  const connected = recommendations.find((entry) => entry.pattern === 'connected-process')
  assert.ok(connected.reasons.includes('narrative.story-fit'))
  assert.ok(connected.warnings.includes('narrative.evidence-missing'))
  assert.ok(connected.warnings.includes('narrative.story-mismatch'))
})

test('capability selection is strict and explains unavailable progressive behavior', () => {
  assert.throws(
    () => recommendPatterns(semanticProcess, { capabilities: ['executable-css'] }),
    /unknown composition capability/,
  )
  const faq = {
    schema_version: '1',
    title: 'FAQ',
    locale: 'de',
    nodes: [
      {
        id: 'faq-1',
        type: 'faq',
        role: 'primary',
        questions: [
          { id: 'q-1', title: 'A?', answer: 'A.' },
          { id: 'q-2', title: 'B?', answer: 'B.' },
        ],
      },
    ],
  }
  const recommendations = recommendPatterns(faq, {
    intent: 'explain',
    canvas: 'portrait',
    density: 'balanced',
    capabilities: ['disclosure'],
  })
  assert.equal(recommendations.find((entry) => entry.pattern === 'faq-list').eligible, true)
  assert.equal(recommendations.find((entry) => entry.pattern === 'pricing-cards').eligible, false)
})

test('every new information family compiles at compact container width with complete models', async () => {
  const ids = [
    'faq-list',
    'faq-columns',
    'faq-categorized',
    'tabbed-code',
    'file-code',
    'code-walkthrough',
    'pricing-cards',
    'pricing-comparison',
    'pricing-spotlight',
    'pricing-addons',
    'gallery-grid',
    'editorial-gallery',
    'captioned-gallery',
    'stats-inline',
    'featured-stat',
    'stat-timeline',
    'responsive-data-table',
    'grouped-data-table',
    'record-cards',
    'analytics-dashboard',
    'operations-dashboard',
    'dashboard-detail',
    'sidebar-shell',
    'topbar-shell',
    'split-pane-shell',
  ]
  for (const id of ids) {
    const source = await readFile(new URL(`../../examples/compositions/${id}.en.md`, import.meta.url), 'utf8')
    const result = await compileCompositionMarkdown(source, {
      viewport: { width: 1440, height: 1024 },
      container: { width: 390, height: 844 },
      outputs: ['model', 'html', 'svg', 'print'],
    })
    assert.equal(result.composition.requested_pattern, id)
    assert.ok(result.composition.resolved_pattern)
    assert.equal(result.layout.responsive.breakpoint, 'compact')
    assert.match(result.renders.svg, /<svg/)
    assert.match(result.renders.print_html, /composition-print/)
    assert.doesNotMatch(result.renders.svg, /NaN|undefined|Infinity/)
    if (id === 'operations-dashboard') {
      assert.doesNotMatch(result.renders.svg, />LIVE</)
      assert.doesNotMatch(result.renders.svg, /Last 30 days/)
      const wide = await compileCompositionMarkdown(source, {
        viewport: { width: 1440, height: 1024 },
        container: { width: 1200, height: 844 },
        outputs: ['model', 'svg'],
      })
      assert.equal(wide.composition.resolved_pattern, 'operations-dashboard')
      assert.match(wide.renders.svg, /Workflows/)
      assert.match(wide.renders.svg, /Publications/)
      assert.match(wide.renders.svg, /Reader sessions/)
    }
    assert.ok(result.accessible_text.length > 20)
  }
})

test('dashboard SVG renders missing evidence as an explicit compact empty state', async () => {
  const source = `---
kind: page
layout: composition
title: Weekly report
summary: No completed input interval is available.
locale: en
slug: weekly-report
composition:
  format: report
  canvas: landscape
  intent: status
  preferredPattern: operations-dashboard
---

:::dashboard-section{title="Completed week" description="2026-07-06" role="primary"}
:::

:::metric{label="Coverage" value="0%" trend="0/7"}
:::

:::chart{type="line" title="No evidence data" description="No completed input interval was measured."}
| Interval | Value |
|---|---:|
| Closed | — |
:::`
  const result = await compileCompositionMarkdown(source, {
    viewport: { width: 1440, height: 1024 },
    container: { width: 1200, height: 844 },
    outputs: ['model', 'svg'],
  })
  assert.match(result.renders.svg, /No evidence data/)
  assert.match(result.renders.svg, /No completed input interval was measured\./)
  assert.match(result.renders.svg, /stroke-dasharray="4 6"/)
  assert.doesNotMatch(result.renders.svg, /stroke-dasharray="3 7"/)
})

test('dashboard SVG preserves authored bar-chart geometry and category labels', async () => {
  const source = `---
kind: page
layout: composition
title: Hourly report
summary: Completed technical activity.
locale: en
slug: hourly-report
composition:
  format: report
  canvas: landscape
  intent: status
  preferredPattern: operations-dashboard
---

:::dashboard-section{title="Completed hour" description="09:00–10:00 UTC" role="primary"}
:::

:::metric{label="Coverage" value="4/4" trend="complete"}
:::

:::chart{type="bar" title="Technical activity" description="Completed operations by source"}
| Source | Count |
|---|---:|
| Workflows | 10 |
| Publications | 2 |
| Knowledge | 4 |
:::`
  const result = await compileCompositionMarkdown(source, {
    viewport: { width: 1440, height: 1024 },
    container: { width: 1200, height: 844 },
    outputs: ['model', 'svg'],
  })
  assert.match(result.renders.svg, /class="composition-dashboard-bars"/)
  assert.doesNotMatch(result.renders.svg, /class="composition-dashboard-lines"/)
  assert.match(result.renders.svg, />Workflows</)
  assert.match(result.renders.svg, />Publications</)
  assert.match(result.renders.svg, />Knowledge</)
})

test('data shapes let agents select only semantically compatible chart patterns', () => {
  const semantic = {
    schema_version: '1',
    title: 'Forecast',
    locale: 'en',
    nodes: [
      {
        id: 'chart-1',
        type: 'chart',
        role: 'primary',
        data_shape: 'uncertainty',
        rows: [
          ['Q1', 10, 14, 19],
          ['Q2', 12, 17, 23],
          ['Q3', 14, 20, 27],
        ],
      },
    ],
  }
  const recommendations = recommendPatterns(semantic, { intent: 'explore', canvas: 'landscape', density: 'balanced' })
  const band = recommendations.find((candidate) => candidate.pattern === 'uncertainty-band')
  const sankey = recommendations.find((candidate) => candidate.pattern === 'sankey-flow')
  assert.equal(band.eligible, true)
  assert.ok(band.reasons.includes('data.uncertainty'))
  assert.equal(sankey.eligible, false)
  assert.ok(sankey.rejections.includes('semantic.data_shape'))
})

test('recommendation explains eligibility and responsive resolution is deterministic', () => {
  const first = recommendPatterns(
    semanticProcess,
    { intent: 'sequence', canvas: 'landscape', density: 'balanced' },
    { width: 600, height: 900 },
  )
  const second = recommendPatterns(
    semanticProcess,
    { intent: 'sequence', canvas: 'landscape', density: 'balanced' },
    { width: 600, height: 900 },
  )
  assert.deepEqual(first, second)
  const connected = first.find((candidate) => candidate.pattern === 'connected-process')
  assert.equal(connected.eligible, true)
  assert.equal(connected.responsive_pattern, 'vertical-journey')
  assert.ok(connected.reasons.includes('semantic.process'))

  const resolved = resolvePattern(
    semanticProcess,
    { intent: 'sequence', canvas: 'landscape', density: 'balanced', preferred_pattern: 'connected-process' },
    { width: 600, height: 900 },
  )
  assert.equal(resolved.resolved_pattern, 'vertical-journey')
  assert.ok(resolved.diagnostics.some((entry) => entry.code === 'pattern.fallback'))
})

test('headless compilation reproduces semantic models, SVG and PNG bytes', async () => {
  const options = {
    scheme: 'dark',
    viewport: { width: 800, height: 600 },
    outputs: ['model', 'html', 'svg', 'png'],
  }
  const first = await compileCompositionMarkdown(markdown, options)
  const second = await compileCompositionMarkdown(markdown, options)
  assert.deepEqual(first, second)
  assert.equal(first.composition.resolved_pattern, 'connected-process')
  assert.equal(first.semantic.nodes[0].type, 'process')
  assert.match(first.renders.html, /composition-structure/)
  assert.match(first.renders.svg, /^<svg/)
  assert.match(first.renders.svg, /<title id="composition-title">MCP at a glance<\/title>/)
  assert.match(
    first.renders.svg,
    /font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif/,
  )
  assert.ok(Math.min(...svgFontSizes(first.renders.svg)) >= 14)
  assert.equal(Buffer.from(first.renders.png_base64, 'base64').subarray(1, 4).toString(), 'PNG')
  assert.match(first.hashes.svg_sha256, /^[0-9a-f]{64}$/)
  assert.match(first.accessible_text, /Client/)
})

test('headless compilation rejects unbounded or unknown rendering inputs', async () => {
  await assert.rejects(() => compileCompositionMarkdown(markdown, { scheme: 'sepia' }), /scheme must be light or dark/)
  await assert.rejects(
    () => compileCompositionMarkdown(markdown, { viewport: { width: 200, height: 400 } }),
    /viewport must be 320-4096/,
  )
  await assert.rejects(() => compileCompositionMarkdown(markdown, { outputs: ['pdf'] }), /unknown composition output/)
})

test('headless mobile compilation applies structural pattern fallbacks', async () => {
  const result = await compileCompositionMarkdown(markdown, {
    viewport: { width: 390, height: 844 },
    outputs: ['model', 'svg'],
  })
  assert.equal(result.composition.requested_pattern, 'connected-process')
  assert.equal(result.composition.resolved_pattern, 'vertical-journey')
  assert.ok(result.diagnostics.some((entry) => entry.code === 'pattern.fallback'))
  assert.match(result.renders.svg, /viewBox="0 0 390 844"/)
  assert.ok(Math.min(...svgFontSizes(result.renders.svg)) >= 14)
  assert.doesNotMatch(result.renders.svg, /NaN|undefined|Infinity/)
})

test('mobile comparison matrices reflow into readable subject cards', async () => {
  const result = await compileCompositionMarkdown(
    `---
layout: composition
title: Integrationsansätze
summary: Drei Ansätze entlang gemeinsamer Qualitätskriterien.
locale: de
slug: integrationsansaetze
composition:
  format: infographic
  canvas: landscape
  preferredPattern: comparison-matrix
---

::::comparison{title="Integrationsansätze"}
:::side{label="Direkt"}
- Vertrag · proprietär
- Wiederverwendung · gering
- Kopplung · hoch
:::
:::side{label="Gateway"}
- Vertrag · intern
- Wiederverwendung · mittel
- Kopplung · mittel
:::
:::side{label="MCP"}
- Vertrag · gemeinsam
- Wiederverwendung · hoch
- Kopplung · gering
:::
::::`,
    { viewport: { width: 390, height: 844 }, outputs: ['model', 'svg'] },
  )
  assert.equal(result.composition.resolved_pattern, 'comparison-matrix')
  assert.match(result.renders.svg, />Wiederverwendung</)
  assert.doesNotMatch(result.renders.svg, />Wied…</)
  assert.ok(Math.min(...svgFontSizes(result.renders.svg)) >= 14)
})

test('mobile tree hierarchies reflow without narrow abbreviated columns', async () => {
  const result = await compileCompositionMarkdown(
    `---
layout: composition
title: Dokumentationsnavigation
summary: Produkt, Bereiche, Kapitel und Seiten.
locale: de
slug: dokumentationsnavigation
composition:
  format: infographic
  canvas: portrait
  preferredPattern: tree-hierarchy
---

:::hierarchy{title="Dokumentationsnavigation"}
- ContentKit
- Grundlagen
- Autoren
- Betreiber
- API-Referenz
:::`,
    { viewport: { width: 390, height: 844 }, outputs: ['model', 'svg'] },
  )
  assert.equal(result.composition.resolved_pattern, 'tree-hierarchy')
  for (const label of ['ContentKit', 'Grundlagen', 'Autoren', 'Betreiber', 'API-Referenz']) {
    assert.match(result.renders.svg, new RegExp(`>${label}<`))
  }
  assert.doesNotMatch(result.renders.svg, /Conten…|Gr…|Au…|Be…|AP…/)
  assert.ok(Math.min(...svgFontSizes(result.renders.svg)) >= 14)
})
