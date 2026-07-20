---
schemaVersion: 1
id: vertical-timeline
version: 1
status: stable
category: timeline
scope: node
accepts: { nodeTypes: [timeline], minItems: 2, maxItems: 12 }
semantics: { conveys: [chronology], implies: [top-to-bottom-time] }
narrative: {"question":"Which events need more explanation while preserving an unmistakable chronological order?","goal":"A readable chronology for narrow formats or events with longer descriptions.","arc":["establish-time-window","follow-events","emphasize-milestones","connect-past-to-current-state"],"takeaway":"A readable chronology for narrow formats or events with longer descriptions.","decisionSupport":"Use when chronology; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [sequence], canvases: [portrait, flow], densities: [compact, balanced, spacious] }
fallbacks: []
layout: { primitive: sequence, direction: vertical, connector: line }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Vertical Timeline

A readable chronology for narrow formats or events with longer descriptions.
