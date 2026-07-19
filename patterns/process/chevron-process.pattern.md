---
schemaVersion: 1
id: chevron-process
version: 1
status: stable
category: process
scope: node
accepts: { nodeTypes: [process], minItems: 3, preferredMaxItems: 5, maxItems: 7 }
semantics: { conveys: [sequence, handoff], rejects: [repeating-cycle] }
narrative: {"question":"Which linear stages move one artifact toward completion with clear forward momentum?","goal":"Interlocking stages that emphasize forward handoff between a small number of steps.","arc":["name-trigger","follow-stages","expose-handoffs-or-branches","arrive-at-outcome"],"takeaway":"Interlocking stages that emphasize forward handoff between a small number of steps.","decisionSupport":"Use when sequence, handoff; reject when repeating cycle."}
selection: { intents: [sequence, explain], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: vertical-journey }]
fallbacks: [vertical-journey]
layout: { primitive: sequence, shape: chevron, direction: horizontal }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Chevron Process

Interlocking stages that emphasize forward handoff between a small number of steps.
