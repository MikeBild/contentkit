---
schemaVersion: 1
id: circular-lifecycle
version: 1
status: stable
category: process
scope: node
accepts: { nodeTypes: [process], minItems: 3, preferredMaxItems: 6, maxItems: 8 }
semantics: { conveys: [sequence, repetition], implies: [last-returns-to-first], rejects: [terminal-process] }
narrative: {"question":"Which recurring stages form a true cycle in which the outcome feeds the next beginning?","goal":"A repeating process whose last step returns to the first.","arc":["name-trigger","follow-stages","expose-handoffs-or-branches","arrive-at-outcome"],"takeaway":"A repeating process whose last step returns to the first.","decisionSupport":"Use when sequence, repetition; reject when terminal process."}
selection: { intents: [explain, sequence], canvases: [portrait, landscape, square], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: vertical-journey }]
fallbacks: [connected-process, vertical-journey]
layout: { primitive: radial, startAt: top, direction: clockwise, connector: arrow }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Circular Lifecycle

A repeating process whose last step returns to the first.
