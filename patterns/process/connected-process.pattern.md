---
schemaVersion: 1
id: connected-process
version: 1
status: stable
category: process
scope: node
accepts: { nodeTypes: [process], minItems: 2, preferredMaxItems: 4, maxItems: 8 }
semantics: { conveys: [sequence, directed-flow], rejects: [unordered-items, repeating-cycle] }
narrative: {"question":"How does work move through ordered stages, and which connection explains each handoff?","goal":"A directed process with a clear start, end and connection between steps.","arc":["name-trigger","follow-stages","expose-handoffs-or-branches","arrive-at-outcome"],"takeaway":"A directed process with a clear start, end and connection between steps.","decisionSupport":"Use when sequence, directed flow; reject when unordered items, repeating cycle."}
selection: { intents: [explain, sequence], canvases: [portrait, landscape, flow], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: vertical-journey }]
fallbacks: [vertical-journey]
layout: { primitive: sequence, direction: horizontal, connector: arrow }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Connected Process

A directed process with a clear start, end and connection between steps.
