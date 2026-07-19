---
schemaVersion: 1
id: scorecard
version: 1
status: stable
category: metrics
scope: node
accepts: { nodeTypes: [group], minItems: 2, maxItems: 12 }
semantics: { conveys: [evaluation, thresholds], implies: [explicit-judgement] }
narrative: {"question":"Which criteria pass, fail, or approach a shared readiness threshold?","goal":"A set of evaluated metrics with explicit status or threshold meaning.","arc":["name-the-measure","show-value-and-unit","add-target-period-or-trend","state-meaning"],"takeaway":"A set of evaluated metrics with explicit status or threshold meaning.","decisionSupport":"Use when evaluation, thresholds; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [status, compare], canvases: [portrait, landscape, flow], densities: [compact, balanced] }
fallbacks: [metric-wall]
layout: { primitive: grid, columns: 2 }
accessibility: { readingOrder: row-major, textEquivalent: table }
---
# Scorecard

A set of evaluated metrics with explicit status or threshold meaning.
