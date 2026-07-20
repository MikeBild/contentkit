---
schemaVersion: 1
id: editorial-gallery
version: 1
status: stable
category: gallery
scope: node
accepts: { nodeTypes: [gallery], minItems: 3, preferredMaxItems: 7, maxItems: 12 }
semantics: { conveys: [media-story, emphasis], implies: [first-asset-primary] }
narrative: {"question":"How should varied media sizes and emphasis create a deliberate editorial reading rhythm?","goal":"One lead figure and supporting media form an authored visual story.","arc":["establish-theme","sequence-or-group-media","add-essential-captions","resolve-editorial-takeaway"],"takeaway":"One lead figure and supporting media form an authored visual story.","decisionSupport":"Use when first asset deserves emphasis; reject when all assets are equal."}
selection: { intents: [explain, explore], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: captioned-gallery }]
fallbacks: [gallery-grid, captioned-gallery]
layout: { primitive: grid, columns: 3 }
accessibility: { readingOrder: source-order, textEquivalent: figure-list }
slots: [{ name: figures, accepts: [gallery], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [captioned-gallery], primitives: [grid, card] }
contentBudget: { maxItems: 12, maxTextCharacters: 6000, maxWordsPerItem: 50, maxMedia: 12 }
examples: [editorial-gallery]
agentHints:
  useWhen: [first-asset-deserves-emphasis]
  rejectWhen: [all-assets-are-equal]
  authoring: [Place the lead figure first in source order.]
staticFallback: captioned-gallery
---
# Editorial Gallery

One lead figure and supporting media form an authored visual story.
