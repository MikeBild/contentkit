---
schemaVersion: 1
id: range-dot-plot
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [range], minItems: 2, preferredMaxItems: 10, maxItems: 16 }
semantics: { conveys: [range, interval], implies: [lower-upper-bounds] }
narrative: { question: "What interval belongs to each category, and where are the narrowest or widest ranges?", goal: "Compare lower and upper bounds without implying a single exact value.", arc: [define-bound-meaning, align-categories, compare-interval-position, compare-interval-width], takeaway: "The reader sees both the location and uncertainty or tolerance of every range.", decisionSupport: "Use only when both bounds share a unit and meaning; use uncertainty bands when intervals change continuously over time." }
selection: { intents: [compare, explore], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
fallbacks: [detailed-chart]
layout: { primitive: connector, content: intervals }
accessibility: { readingOrder: row-order, textEquivalent: table }
---
# Range Dot Plot

Labeled intervals with explicit lower and upper endpoints for comparing ranges.
