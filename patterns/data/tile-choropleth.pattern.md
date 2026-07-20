---
schemaVersion: 1
id: tile-choropleth
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [geo-region], minItems: 3, preferredMaxItems: 16, maxItems: 32 }
semantics: { conveys: [regional-comparison, magnitude], implies: [schematic-geography] }
narrative: { question: "How does a value differ across named regions when equal visual area improves comparison?", goal: "Compare regional magnitude without allowing geographic area to dominate perception.", arc: [name-regions-and-measure, establish-ordered-scale, compare-neighboring-and-extreme-values, identify-regional-pattern], takeaway: "The reader can compare regions fairly while retaining a schematic sense of geography.", decisionSupport: "Use when regional identity matters more than exact geography; disclose that tile position and area are schematic." }
selection: { intents: [compare, explore], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
fallbacks: [ranked-bars]
layout: { primitive: grid, content: geographic-tiles }
accessibility: { readingOrder: source-order, textEquivalent: table }
---
# Tile Choropleth

Equal-area regional tiles compare values without pretending that physical area represents magnitude.
