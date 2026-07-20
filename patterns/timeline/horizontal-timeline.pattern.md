---
schemaVersion: 1
id: horizontal-timeline
version: 1
status: stable
category: timeline
scope: node
accepts: { nodeTypes: [timeline], minItems: 2, preferredMaxItems: 6, maxItems: 8 }
semantics: { conveys: [chronology], implies: [left-to-right-time] }
narrative: {"question":"Which concise events form one chronological path that can be scanned from left to right?","goal":"A compact chronology arranged from left to right.","arc":["establish-time-window","follow-events","emphasize-milestones","connect-past-to-current-state"],"takeaway":"A compact chronology arranged from left to right.","decisionSupport":"Use when chronology; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [sequence], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: vertical-timeline }]
fallbacks: [vertical-timeline]
layout: { primitive: sequence, direction: horizontal, connector: line }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Horizontal Timeline

A compact chronology arranged from left to right.
