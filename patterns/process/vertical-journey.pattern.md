---
schemaVersion: 1
id: vertical-journey
version: 1
status: stable
category: process
scope: node
accepts: { nodeTypes: [process], minItems: 2, maxItems: 12 }
semantics: { conveys: [sequence, progression], implies: [top-to-bottom-order] }
narrative: {"question":"How should a longer sequence unfold when each stage needs enough explanation to stand on its own?","goal":"A top-to-bottom process suitable for narrow viewports and longer explanations.","arc":["name-trigger","follow-stages","expose-handoffs-or-branches","arrive-at-outcome"],"takeaway":"A top-to-bottom process suitable for narrow viewports and longer explanations.","decisionSupport":"Use when sequence, progression; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [explain, sequence], canvases: [portrait, flow], densities: [compact, balanced, spacious] }
fallbacks: []
layout: { primitive: sequence, direction: vertical, connector: line }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Vertical Journey

A top-to-bottom process suitable for narrow viewports and longer explanations.
