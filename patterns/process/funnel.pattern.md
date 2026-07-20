---
schemaVersion: 1
id: funnel
version: 1
status: stable
category: process
scope: node
accepts: { nodeTypes: [process], minItems: 3, maxItems: 7 }
semantics: { conveys: [sequence, reduction], implies: [quantity-decreases] }
narrative: {"question":"How is a broad input intentionally reduced at each stage, and what qualifies the remaining output?","goal":"A staged process in which the amount of material or candidates decreases.","arc":["name-trigger","follow-stages","expose-handoffs-or-branches","arrive-at-outcome"],"takeaway":"A staged process in which the amount of material or candidates decreases.","decisionSupport":"Use when sequence, reduction; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [explain, sequence], canvases: [portrait, landscape, flow], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: vertical-journey }]
fallbacks: [vertical-journey]
layout: { primitive: layers, shape: narrowing }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Funnel

A staged process in which the amount of material or candidates decreases.
