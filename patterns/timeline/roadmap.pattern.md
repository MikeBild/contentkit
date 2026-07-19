---
schemaVersion: 1
id: roadmap
version: 1
status: stable
category: timeline
scope: node
accepts: { nodeTypes: [timeline], minItems: 2, maxItems: 12 }
semantics: { conveys: [future-sequence, milestones], implies: [planned-not-completed] }
narrative: {"question":"Which planned stages and milestones communicate future intent without implying completed work?","goal":"Planned milestones arranged across future phases or time periods.","arc":["establish-time-window","follow-events","emphasize-milestones","connect-past-to-current-state"],"takeaway":"Planned milestones arranged across future phases or time periods.","decisionSupport":"Use when future sequence, milestones; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [sequence, status], canvases: [portrait, landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: vertical-timeline }]
fallbacks: [horizontal-timeline, vertical-timeline]
layout: { primitive: layers, axis: time }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Roadmap

Planned milestones arranged across future phases or time periods.
