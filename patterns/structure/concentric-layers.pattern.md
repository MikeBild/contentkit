---
schemaVersion: 1
id: concentric-layers
version: 1
status: stable
category: structure
scope: node
accepts: { nodeTypes: [hierarchy], minItems: 3, preferredMaxItems: 5, maxItems: 7 }
semantics: { conveys: [containment, dependency], implies: [inside-out-order] }
narrative: {"question":"Which responsibilities or controls surround the core in meaningful ordered boundaries?","goal":"Nested conceptual boundaries that communicate containment from core to outer context.","arc":["establish-boundary-or-root","group-elements","connect-relationships","reveal-structural-meaning"],"takeaway":"Nested conceptual boundaries that communicate containment from core to outer context.","decisionSupport":"Use when containment, dependency; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [explain], canvases: [portrait, landscape, square], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: layer-stack }]
fallbacks: [layer-stack]
layout: { primitive: radial, shape: concentric }
accessibility: { readingOrder: inside-out, textEquivalent: ordered-list }
---
# Concentric Layers

Nested conceptual boundaries that communicate containment from core to outer context.
