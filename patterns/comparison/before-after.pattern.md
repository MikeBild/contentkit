---
schemaVersion: 1
id: before-after
version: 1
status: stable
category: comparison
scope: node
accepts: { nodeTypes: [comparison], minItems: 2, maxItems: 2 }
semantics: { conveys: [change, comparison], implies: [ordered-transformation] }
narrative: {"question":"What meaningfully changed between the previous and resulting state, and why is the change better or worse?","goal":"Two states connected as an ordered transformation from earlier to later.","arc":["introduce-options","establish-shared-criteria","reveal-differences","support-choice"],"takeaway":"Two states connected as an ordered transformation from earlier to later.","decisionSupport":"Use when change, comparison; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [compare, sequence], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: []
layout: { primitive: sequence, direction: horizontal, connector: arrow }
accessibility: { readingOrder: source-order, textEquivalent: comparison-list }
---
# Before and After

Two states connected as an ordered transformation from earlier to later.
