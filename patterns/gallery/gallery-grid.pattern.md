---
schemaVersion: 1
id: gallery-grid
version: 1
status: stable
category: gallery
scope: node
accepts: { nodeTypes: [gallery], minItems: 2, preferredMaxItems: 9, maxItems: 24 }
semantics: { conveys: [media-collection, equality], implies: [peer-assets] }
narrative: {"question":"Which media items should be compared as equal peers in one consistent visual collection?","goal":"A regular contact sheet for equally important authored media.","arc":["establish-theme","sequence-or-group-media","add-essential-captions","resolve-editorial-takeaway"],"takeaway":"A regular contact sheet for equally important authored media.","decisionSupport":"Use when assets have equal importance; reject when one asset is editorially primary."}
selection: { intents: [explore, explain], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: captioned-gallery }]
fallbacks: [captioned-gallery]
layout: { primitive: grid, columns: 3 }
accessibility: { readingOrder: source-order, textEquivalent: figure-list }
slots: [{ name: figures, accepts: [gallery], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [captioned-gallery], primitives: [grid, card] }
contentBudget: { maxItems: 24, maxTextCharacters: 6000, maxWordsPerItem: 40, maxMedia: 24 }
examples: [gallery-grid]
agentHints:
  useWhen: [assets-have-equal-importance]
  rejectWhen: [one-asset-is-editorially-primary]
  authoring: [Provide alt text for every informative figure.]
staticFallback: captioned-gallery
---
# Gallery Grid

A regular contact sheet for equally important authored media.
