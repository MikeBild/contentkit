---
schemaVersion: 1
id: beeswarm-distribution
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [samples], minItems: 8, preferredMaxItems: 48, maxItems: 120 }
semantics: { conveys: [distribution, observations], implies: [individual-samples] }
narrative: { question: "How are individual observations distributed, and which values are unusual?", goal: "Reveal distribution shape without hiding the observations behind an aggregate.", arc: [introduce-measure-and-range, show-every-observation, reveal-clusters-gaps-and-outliers, summarize-distribution-shape], takeaway: "The reader can see both the overall distribution and the observations that create it.", decisionSupport: "Use when individual cases matter; prefer a boxplot when only a compact statistical summary is needed." }
selection: { intents: [explore, compare], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: [distribution-boxplot]
layout: { primitive: frame, content: packed-observations }
accessibility: { readingOrder: ascending-value, textEquivalent: table }
---
# Beeswarm Distribution

Individual observations are packed without overlap to expose distribution shape and unusual values.
