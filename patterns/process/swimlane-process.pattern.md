---
schemaVersion: 1
id: swimlane-process
version: 1
status: stable
category: process
scope: node
accepts: { nodeTypes: [process], minItems: 3, preferredMaxItems: 6, maxItems: 8 }
semantics: { conveys: [sequence, responsibility], implies: [alternating-owners] }
narrative: {"question":"Which participant owns each stage, and where do cross-owner handoffs create risk or delay?","goal":"An ordered flow split into responsibility lanes encoded in each step label.","arc":["name-trigger","follow-stages","expose-handoffs-or-branches","arrive-at-outcome"],"takeaway":"An ordered flow split into responsibility lanes encoded in each step label.","decisionSupport":"Use when sequence, responsibility; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [sequence, explain], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: vertical-journey }]
fallbacks: [vertical-journey]
layout: { primitive: sequence, lanes: 2, direction: horizontal }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Swimlane Process

An ordered flow split into responsibility lanes encoded in each step label.
