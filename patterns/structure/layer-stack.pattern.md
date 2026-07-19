---
schemaVersion: 1
id: layer-stack
version: 1
status: stable
category: structure
scope: node
accepts: { nodeTypes: [hierarchy], minItems: 2, maxItems: 8 }
semantics: { conveys: [layers, dependency], implies: [ordered-levels] }
narrative: {"question":"Which ordered layers depend on those beneath them, and what responsibility belongs to each layer?","goal":"Ordered architectural or conceptual layers with dependencies between levels.","arc":["establish-boundary-or-root","group-elements","connect-relationships","reveal-structural-meaning"],"takeaway":"Ordered architectural or conceptual layers with dependencies between levels.","decisionSupport":"Use when layers, dependency; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [explain], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: []
layout: { primitive: layers, direction: vertical }
accessibility: { readingOrder: source-order, textEquivalent: ordered-list }
---
# Layer Stack

Ordered architectural or conceptual layers with dependencies between levels.
