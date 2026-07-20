---
schemaVersion: 1
id: metric-card
version: 1
status: stable
category: metrics
scope: node
accepts: { nodeTypes: [metric], minItems: 1, maxItems: 1 }
semantics: { conveys: [single-value], implies: [value-is-important] }
narrative: {"question":"Which one measure needs focused interpretation through value, unit, period, and trend?","goal":"A focused card for one value, label, trend and status.","arc":["name-the-measure","show-value-and-unit","add-target-period-or-trend","state-meaning"],"takeaway":"A focused card for one value, label, trend and status.","decisionSupport":"Use when single value; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [status], canvases: [portrait, landscape, square, flow], densities: [compact, balanced, spacious] }
fallbacks: []
layout: { primitive: card, emphasis: value }
accessibility: { readingOrder: source-order, textEquivalent: definition }
---
# Metric Card

A focused card for one value, label, trend and status.
