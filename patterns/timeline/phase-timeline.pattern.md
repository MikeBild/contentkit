---
schemaVersion: 1
id: phase-timeline
version: 1
status: stable
category: timeline
scope: node
accepts: { nodeTypes: [timeline], minItems: 3, preferredMaxItems: 6, maxItems: 12 }
semantics: { conveys: [time, phases], implies: [grouped-stages] }
narrative: {"question":"Which broader phases organize related events, and how does each phase advance the overall program?","goal":"Chronological events grouped into alternating phase bands for programme reporting.","arc":["establish-time-window","follow-events","emphasize-milestones","connect-past-to-current-state"],"takeaway":"Chronological events grouped into alternating phase bands for programme reporting.","decisionSupport":"Use when time, phases; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [sequence, status], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: vertical-timeline }]
fallbacks: [vertical-timeline]
layout: { primitive: sequence, shape: phase-bands }
accessibility: { readingOrder: chronological, textEquivalent: ordered-list }
---
# Phase Timeline

Chronological events grouped into alternating phase bands for programme reporting.
