import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileDeck, planDeck, splitDeckSlides } from '../../src/decks.mjs'

const source = `---
kind: deck
layout: deck
title: Reliable publishing
summary: Evidence, sequence and decision.
locale: en
slug: reliable-publishing
audience: Operators
question: How does a release become reliable?
goal: Explain the evidence-backed release path.
action: Verify the active release after publishing.
deck:
  theme: editorial
  maxSlides: 12
  visualScheme: auto
---

# Reliable publishing

Evidence before activation.

---

# Release path

:::process{title="Atomic release" role="primary" preferredPattern="connected-process"}
- Build
- Validate
- Activate
:::

---

# Decision

Verify the active pointer.
`

test('deck planning is deterministic, narrative-aware and source-addressed', async () => {
  const first = await planDeck(source)
  const second = await planDeck(source)
  assert.deepEqual(first, second)
  assert.equal(first.plan_sha256, second.plan_sha256)
  assert.equal(first.slides.length, 3)
  assert.deepEqual(
    first.slides.map((slide) => slide.role),
    ['opening', 'evidence', 'conclusion'],
  )
  assert.equal(first.settings.theme, 'editorial')
  assert.equal(first.settings.template, 'freeform')
  assert.equal(first.narrative.question, 'How does a release become reliable?')
  assert.match(first.slides[0].id, /^slide-001-[0-9a-f]{8}$/)
  assert.deepEqual(first.sources, [])
})

test('deck separators and maxSlides are bounded', async () => {
  assert.equal(splitDeckSlides(source).length, 3)
  await assert.rejects(() => planDeck(source, { maxSlides: 2 }), /exceeding maxSlides 2/)
  await assert.rejects(() => planDeck(source, { maxSlides: 0 }), /integer from 1 to 120/)
  await assert.rejects(() => planDeck(source.replace('kind: deck', 'kind: page')), /kind: deck/)
})

test('official Slidev parsing preserves per-slide frontmatter and ignores separators in fences', async () => {
  const parserSource = `---
kind: deck
layout: deck
title: Parser deck
locale: en
slug: parser-deck
---
# One

\`\`\`md

---

\`\`\`
---
layout: center
class: text-center
---
# Two
`
  assert.equal(splitDeckSlides(parserSource).length, 2)
  const plan = await planDeck(parserSource)
  assert.equal(plan.slides.length, 2)
  assert.equal(plan.slides[1].slide_frontmatter.layout, 'center')
  const compiled = await compileDeck(parserSource, { renderHtml: async (markdown) => markdown })
  assert.match(compiled.markdown, /layout: center\nclass: text-center\n---\n# Two/)
})

test('deck compilation materializes semantic SVG and PNG components before HTML rendering', async () => {
  let renderedMarkdown = ''
  const compiled = await compileDeck(source, {
    includeArtifactData: true,
    renderHtml: async (markdown) => {
      renderedMarkdown = markdown
      return '<!doctype html><html><head></head><body>deck</body></html>'
    },
  })
  assert.equal(compiled.plan.slides.length, 3)
  assert.equal(compiled.artifacts.length, 1)
  assert.equal(compiled.artifacts[0].pattern, 'connected-process')
  assert.ok(compiled.artifacts[0].hashes.light.svg)
  assert.ok(compiled.artifacts[0].hashes.light.png)
  assert.ok(compiled.artifacts[0].hashes.dark.svg)
  assert.ok(compiled.artifacts[0].hashes.dark.png)
  assert.match(compiled.artifacts[0].representations.light.svg, /^<svg/)
  assert.match(compiled.artifacts[0].representations.light.png_base64, /^[A-Za-z0-9+/]+=*$/)
  assert.match(renderedMarkdown, /data:image\/svg\+xml;base64/)
  assert.match(renderedMarkdown, /data:image\/png;base64/)
  assert.match(renderedMarkdown, /routerMode: "hash"/)
  assert.match(renderedMarkdown, /data-contentkit-design-system/)
  assert.match(renderedMarkdown, /--ck-deck-accent:#2563eb/)
  assert.match(compiled.html_sha256, /^[0-9a-f]{64}$/)
})

test('site design tokens become deterministic deck CSS for light and dark schemes', async () => {
  let renderedMarkdown = ''
  await compileDeck(source, {
    settings: {
      accent: '221 83% 53%',
      theme: {
        tokens: {
          background: { light: '#ffffff', dark: '#020817' },
          foreground: { light: '#020817', dark: '#f8fafc' },
          font_family: 'Inter, ui-sans-serif, system-ui, sans-serif',
        },
      },
    },
    renderHtml: async (markdown) => {
      renderedMarkdown = markdown
      return '<!doctype html><html><head></head><body>deck</body></html>'
    },
  })
  assert.match(renderedMarkdown, /:root\{--ck-deck-bg:#ffffff;--ck-deck-fg:#020817;/)
  assert.match(renderedMarkdown, /html\.dark\{--ck-deck-bg:#020817;--ck-deck-fg:#f8fafc;/)
  assert.doesNotMatch(renderedMarkdown, /Inter Variable/)
})

test('the technical explainer template validates an explicit narrative sequence', async () => {
  const example = await readFile(
    new URL('../../examples/decks/contentkit-semantic-publishing.en.md', import.meta.url),
    'utf8',
  )
  const plan = await planDeck(example)
  assert.equal(plan.schema_version, '2')
  assert.equal(plan.settings.template, 'technical-explainer')
  assert.deepEqual(
    plan.slides.map((slide) => slide.role),
    plan.settings.template_contract.narrative_slots,
  )
  assert.deepEqual(plan.diagnostics, [])
  assert.match(plan.compiler.deck_template_registry_sha256, /^[0-9a-f]{64}$/)
})

test('selected templates reject missing authored narrative roles before rendering', async () => {
  const invalidTemplate = source.replace('deck:\n', 'deck:\n  template: technical-explainer\n')
  const plan = await planDeck(invalidTemplate)
  assert.ok(plan.diagnostics.some((entry) => entry.code === 'deck.template.role-required'))
  assert.ok(plan.diagnostics.some((entry) => entry.code === 'deck.template.slot-missing'))
  await assert.rejects(() => compileDeck(invalidTemplate), /deck template validation failed/)
})
