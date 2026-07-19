---
schemaVersion: 1
id: metric-wall
version: 1
status: stable
category: metrics
scope: node
accepts: { nodeTypes: [group], minItems: 2, preferredMaxItems: 6, maxItems: 12 }
semantics: { conveys: [multi-value-overview], implies: [peer-metrics] }
narrative: {"question":"Which portfolio of independent metrics provides a balanced overview without implying a sequence?","goal":"A regular collection of peer metrics for fast scanning.","arc":["name-the-measure","show-value-and-unit","add-target-period-or-trend","state-meaning"],"takeaway":"A regular collection of peer metrics for fast scanning.","decisionSupport":"Use when multi value overview; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [status], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: stratified-story }]
fallbacks: [grouped-dashboard]
layout: { primitive: grid, columns: 3 }
accessibility: { readingOrder: row-major, textEquivalent: definition-list }
---
# Metric Wall

A regular collection of peer metrics for fast scanning.
