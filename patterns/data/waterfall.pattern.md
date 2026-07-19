---
schemaVersion: 1
id: waterfall
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [waterfall], minItems: 3, preferredMaxItems: 10, maxItems: 14 }
semantics: { conveys: [contribution, cumulative-change], implies: [additive-sequence] }
narrative: { question: "Which positive and negative contributions explain the move from a starting value to an ending value?", goal: "Make an additive bridge between start, intermediate contributions, and result.", arc: [establish-starting-value, apply-contributions-in-order, expose-positive-and-negative-drivers, reconcile-ending-value], takeaway: "The reader can account for the final value and identify the contributions with greatest impact.", decisionSupport: "Use only when contributions are additive and reconcile to the result; reject unrelated category comparisons." }
selection: { intents: [explain, compare], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: [detailed-chart]
layout: { primitive: sequence, content: cumulative-bars }
accessibility: { readingOrder: source-order, textEquivalent: table }
---
# Waterfall

Signed contributions accumulate in sequence to explain movement from start to final total.
