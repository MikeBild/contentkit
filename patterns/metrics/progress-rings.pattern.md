---
schemaVersion: 1
id: progress-rings
version: 1
status: stable
category: metrics
scope: node
accepts: { nodeTypes: [group], minItems: 2, preferredMaxItems: 4, maxItems: 6 }
semantics: { conveys: [progress, completion], implies: [bounded-maximum] }
narrative: {"question":"How complete are several bounded workstreams, and which one is furthest from completion?","goal":"Several bounded completion measures shown as directly labelled circular progress.","arc":["name-the-measure","show-value-and-unit","add-target-period-or-trend","state-meaning"],"takeaway":"Several bounded completion measures shown as directly labelled circular progress.","decisionSupport":"Use when progress, completion; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [status, compare], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: [scorecard]
layout: { primitive: radial, content: progress }
accessibility: { readingOrder: row-major, textEquivalent: progress-list }
---
# Progress Rings

Several bounded completion measures shown as directly labelled circular progress.
