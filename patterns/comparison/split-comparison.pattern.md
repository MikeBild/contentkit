---
schemaVersion: 1
id: split-comparison
version: 1
status: stable
category: comparison
scope: node
accepts: { nodeTypes: [comparison], minItems: 2, maxItems: 2 }
semantics: { conveys: [comparison, juxtaposition], implies: [equal-dimensions] }
narrative: {"question":"What are the most consequential differences between two directly comparable alternatives?","goal":"Two subjects shown side by side using the same comparison dimensions.","arc":["introduce-options","establish-shared-criteria","reveal-differences","support-choice"],"takeaway":"Two subjects shown side by side using the same comparison dimensions.","decisionSupport":"Use when comparison, juxtaposition; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [compare], canvases: [portrait, landscape, square, flow], densities: [compact, balanced, spacious] }
responsive: [{ maxWidth: 720, use: before-after }]
fallbacks: [before-after]
layout: { primitive: split, columns: 2 }
accessibility: { readingOrder: source-order, textEquivalent: comparison-list }
---
# Split Comparison

Two subjects shown side by side using the same comparison dimensions.
