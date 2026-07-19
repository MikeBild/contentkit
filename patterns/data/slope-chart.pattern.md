---
schemaVersion: 1
id: slope-chart
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], minItems: 2, preferredMaxItems: 2, maxItems: 2 }
semantics: { conveys: [change, before-after], implies: [exactly-two-periods] }
narrative: { question: "Which categories rose, fell, crossed, or remained stable between two periods?", goal: "Make direction and relative rank change visible between two comparable moments.", arc: [establish-before-and-after, align-common-scale, follow-each-category, identify-crossings-and-largest-moves], takeaway: "The reader sees direction, magnitude, and rank movement for every category.", decisionSupport: "Use for exactly two periods and a manageable number of series; use dumbbells when distance matters more than trajectory." }
selection: { intents: [compare, status], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: [detailed-chart]
layout: { primitive: connector, content: slopes }
accessibility: { readingOrder: series-order, textEquivalent: table }
---
# Slope Chart

Several series compared across exactly two ordered categories to expose direction and change.
