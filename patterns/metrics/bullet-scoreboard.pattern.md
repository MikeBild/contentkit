---
schemaVersion: 1
id: bullet-scoreboard
version: 1
status: stable
category: metrics
scope: node
accepts: { nodeTypes: [group], minItems: 2, maxItems: 10 }
semantics: { conveys: [targets, thresholds], implies: [bounded-maximum] }
narrative: {"question":"How does each measure perform against its target, and which gap requires attention first?","goal":"Compact target bars that compare actual progress with an explicit reference marker.","arc":["name-the-measure","show-value-and-unit","add-target-period-or-trend","state-meaning"],"takeaway":"Compact target bars that compare actual progress with an explicit reference marker.","decisionSupport":"Use when targets, thresholds; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [status, compare], canvases: [portrait, landscape, flow], densities: [compact, balanced] }
fallbacks: [scorecard]
layout: { primitive: stack, content: bullet-bars }
accessibility: { readingOrder: top-to-bottom, textEquivalent: table }
---
# Bullet Scoreboard

Compact target bars that compare actual progress with an explicit reference marker.
