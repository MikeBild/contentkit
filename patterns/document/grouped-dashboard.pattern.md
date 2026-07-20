---
schemaVersion: 1
id: grouped-dashboard
version: 1
status: stable
category: document
scope: document
accepts: { nodeTypes: [metric, chart, progress, group, card], minItems: 2, maxItems: 24 }
semantics: { conveys: [status, grouping], implies: [related-sections] }
narrative: { question: "What is the current state across related areas, and which group needs attention?", goal: "Organize status signals into meaningful sections while preserving an overall health narrative.", arc: [state-overall-health, scan-groups-in-priority-order, surface-exceptions, connect-exceptions-to-action], takeaway: "The reader sees overall state, understands each group, and knows where attention is required.", decisionSupport: "Use when signals form meaningful groups; reject unrelated metrics assembled only to fill a grid." }
selection: { intents: [status, explore], canvases: [landscape, flow], densities: [compact, balanced] }
fallbacks: [stratified-story]
layout: { primitive: grid, columns: 4 }
accessibility: { readingOrder: source-order, textEquivalent: structured-text }
---
# Grouped Dashboard

A dashboard that groups operational information into clearly bounded areas.
