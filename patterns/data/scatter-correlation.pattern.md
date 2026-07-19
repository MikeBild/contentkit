---
schemaVersion: 1
id: scatter-correlation
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [xy], minItems: 4, preferredMaxItems: 24, maxItems: 80 }
semantics: { conveys: [correlation, outliers], implies: [two-quantitative-axes], rejects: [causality] }
narrative: { question: "How do two quantitative variables relate, and which observations depart from the pattern?", goal: "Reveal association, clusters, and outliers without claiming causation.", arc: [define-both-variables-and-units, plot-observations, assess-direction-and-strength, inspect-clusters-and-outliers], takeaway: "The reader can judge whether the variables co-vary and which observations deserve investigation.", decisionSupport: "Use for paired quantitative observations; never present visual association as causal evidence." }
selection: { intents: [explore, compare], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: [detailed-chart]
layout: { primitive: frame, content: xy-points }
accessibility: { readingOrder: row-order, textEquivalent: table }
---
# Scatter Correlation

Points positioned by two quantitative variables reveal association, clusters and outliers.
