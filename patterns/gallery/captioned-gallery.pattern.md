---
schemaVersion: 1
id: captioned-gallery
version: 1
status: stable
category: gallery
scope: node
accepts: { nodeTypes: [gallery], minItems: 1, preferredMaxItems: 8, maxItems: 24 }
semantics: { conveys: [media-collection, captions], implies: [source-order] }
narrative: {"question":"How does each image contribute evidence, and what caption is necessary to interpret it correctly?","goal":"A source-ordered figure list protects captions and alternative text at narrow widths.","arc":["establish-theme","sequence-or-group-media","add-essential-captions","resolve-editorial-takeaway"],"takeaway":"A source-ordered figure list protects captions and alternative text at narrow widths.","decisionSupport":"Use when captions carry important context, compact width; reject when spatial comparison is required."}
selection: { intents: [explain, explore], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
responsive: []
fallbacks: [stratified-story]
layout: { primitive: stack }
accessibility: { readingOrder: source-order, textEquivalent: figure-list }
slots: [{ name: figures, accepts: [gallery], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [], primitives: [stack, card] }
contentBudget: { maxItems: 24, maxTextCharacters: 8000, maxWordsPerItem: 60, maxMedia: 24 }
examples: [captioned-gallery]
agentHints:
  useWhen: [captions-carry-important-context, compact-width]
  rejectWhen: [spatial-comparison-is-required]
  authoring: [Keep captions concise and complete.]
staticFallback: captioned-gallery
---
# Captioned Gallery

A source-ordered figure list protects captions and alternative text at narrow widths.
