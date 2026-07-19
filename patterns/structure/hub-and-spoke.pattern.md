---
schemaVersion: 1
id: hub-and-spoke
version: 1
status: stable
category: structure
scope: node
accepts: { nodeTypes: [relationship], minItems: 3, preferredMaxItems: 6, maxItems: 8 }
semantics: { conveys: [central-entity, peer-connections], implies: [one-hub] }
narrative: {"question":"Which central entity coordinates several independent peers, and what relationship connects each one?","goal":"One central entity connected to several otherwise peer entities.","arc":["establish-boundary-or-root","group-elements","connect-relationships","reveal-structural-meaning"],"takeaway":"One central entity connected to several otherwise peer entities.","decisionSupport":"Use when central entity, peer connections; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [explain, explore], canvases: [portrait, landscape, square], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: stratified-story }]
fallbacks: [stratified-story]
layout: { primitive: radial, center: hub, connector: line }
accessibility: { readingOrder: center-then-source-order, textEquivalent: relationship-list }
---
# Hub and Spoke

One central entity connected to several otherwise peer entities.
