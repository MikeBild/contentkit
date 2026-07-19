---
schemaVersion: 1
id: kpi-strip
version: 1
status: stable
category: metrics
scope: node
accepts: { nodeTypes: [group], minItems: 3, preferredMaxItems: 5, maxItems: 8 }
semantics: { conveys: [peer-metrics, scan], rejects: [ranked-values] }
narrative: {"question":"Which small set of equal-priority signals summarizes the current state at a glance?","goal":"A compact horizontal run of peer metrics for a report or dashboard header.","arc":["name-the-measure","show-value-and-unit","add-target-period-or-trend","state-meaning"],"takeaway":"A compact horizontal run of peer metrics for a report or dashboard header.","decisionSupport":"Use when peer metrics, scan; reject when ranked values."}
selection: { intents: [status], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: metric-wall }]
fallbacks: [metric-wall]
layout: { primitive: grid, columns: 5, flow: horizontal }
accessibility: { readingOrder: left-to-right, textEquivalent: list }
---
# KPI Strip

A compact horizontal run of peer metrics for a report or dashboard header.
