---
schemaVersion: 1
id: coordinate-map
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [geo-point], minItems: 2, preferredMaxItems: 12, maxItems: 40 }
semantics: { conveys: [geographic-position, magnitude], implies: [latitude-longitude] }
narrative: { question: "Where are the measured locations, and how large is each value?", goal: "Connect exact geographic position with a comparable quantitative measure.", arc: [establish-geographic-context, locate-observations, compare-symbol-magnitude, identify-spatial-clusters-or-outliers], takeaway: "The reader understands both where observations occur and how their values differ.", decisionSupport: "Use only with valid coordinates; use ranked bars when location is incidental rather than explanatory." }
selection: { intents: [explore, compare], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: [ranked-bars]
layout: { primitive: frame, content: projected-points }
accessibility: { readingOrder: descending-value, textEquivalent: table }
---
# Coordinate Map

Projected latitude and longitude place labeled magnitude symbols in geographic context.
