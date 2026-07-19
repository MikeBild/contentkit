---
schemaVersion: 1
id: diverging-bars
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [diverging], minItems: 2, preferredMaxItems: 10, maxItems: 18 }
semantics: { conveys: [deviation, direction], implies: [meaningful-zero] }
narrative: { question: "Which values fall above or below a meaningful reference, and by how much?", goal: "Make direction and magnitude of deviation immediately comparable.", arc: [define-reference-or-zero, separate-negative-and-positive, rank-deviation-magnitude, identify-largest-departures], takeaway: "The reader sees which categories move in each direction and which deviations matter most.", decisionSupport: "Use only when zero or the chosen baseline has semantic meaning; reject arbitrary centered scales." }
selection: { intents: [compare, status], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
fallbacks: [ranked-bars]
layout: { primitive: split, content: signed-bars }
accessibility: { readingOrder: row-order, textEquivalent: table }
---
# Diverging Bars

Signed values extend from a meaningful center to compare positive and negative deviation.
