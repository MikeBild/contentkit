---
schemaVersion: 1
id: distribution-boxplot
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [boxplot], minItems: 1, preferredMaxItems: 8, maxItems: 12 }
semantics: { conveys: [distribution, spread], implies: [five-number-summary] }
narrative: { question: "How do median, spread, and extremes differ across groups?", goal: "Compare distributions through a compact five-number summary.", arc: [introduce-groups-and-measure, compare-medians, compare-interquartile-spread, inspect-total-range], takeaway: "The reader can distinguish typical values, variability, and extremes across groups.", decisionSupport: "Use with valid five-number summaries; use a beeswarm when individual observations must remain visible." }
selection: { intents: [compare, explore], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
fallbacks: [detailed-chart]
layout: { primitive: connector, content: quartiles }
accessibility: { readingOrder: row-order, textEquivalent: table }
---
# Distribution Boxplot

Five-number summaries compare median, quartiles and total spread across groups.
