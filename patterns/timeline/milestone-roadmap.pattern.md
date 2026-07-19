---
schemaVersion: 1
id: milestone-roadmap
version: 1
status: stable
category: timeline
scope: node
accepts: { nodeTypes: [timeline], minItems: 3, preferredMaxItems: 6, maxItems: 10 }
semantics: { conveys: [time, milestones], implies: [gated-progress] }
narrative: {"question":"Which future gates mark meaningful progress, and what outcome defines each milestone?","goal":"A forward route with prominent gates and concise outcomes at each milestone.","arc":["establish-time-window","follow-events","emphasize-milestones","connect-past-to-current-state"],"takeaway":"A forward route with prominent gates and concise outcomes at each milestone.","decisionSupport":"Use when time, milestones; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [sequence, status], canvases: [landscape, flow], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: vertical-timeline }]
fallbacks: [vertical-timeline]
layout: { primitive: sequence, shape: milestones }
accessibility: { readingOrder: chronological, textEquivalent: ordered-list }
---
# Milestone Roadmap

A forward route with prominent gates and concise outcomes at each milestone.
