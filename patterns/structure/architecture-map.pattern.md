---
schemaVersion: 1
id: architecture-map
version: 1
status: stable
category: structure
scope: node
accepts: { nodeTypes: [relationship], minItems: 4, preferredMaxItems: 6, maxItems: 8 }
semantics: { conveys: [system-context, relationships], implies: [central-platform] }
narrative: {"question":"Which system components, boundaries, and directed dependencies create the complete operating context?","goal":"A system context view with inputs, central capability and downstream consumers.","arc":["establish-boundary-or-root","group-elements","connect-relationships","reveal-structural-meaning"],"takeaway":"A system context view with inputs, central capability and downstream consumers.","decisionSupport":"Use when system context, relationships; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [explain, explore], canvases: [landscape, flow], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: stratified-story }]
fallbacks: [hub-and-spoke]
layout: { primitive: connector, shape: architecture-map }
accessibility: { readingOrder: source-order, textEquivalent: relationship-list }
---
# Architecture Map

A system context view with inputs, central capability and downstream consumers.
