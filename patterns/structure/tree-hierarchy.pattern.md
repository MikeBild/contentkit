---
schemaVersion: 1
id: tree-hierarchy
version: 1
status: stable
category: structure
scope: node
accepts: { nodeTypes: [hierarchy], minItems: 2, maxItems: 16 }
semantics: { conveys: [parent-child, branching], implies: [single-root] }
narrative: {"question":"What is the root, how do child groups branch, and where does each item belong?","goal":"A rooted structure with explicit parent and child relationships.","arc":["establish-boundary-or-root","group-elements","connect-relationships","reveal-structural-meaning"],"takeaway":"A rooted structure with explicit parent and child relationships.","decisionSupport":"Use when parent child, branching; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [explain, explore], canvases: [portrait, landscape, flow], densities: [compact, balanced] }
fallbacks: [layer-stack]
layout: { primitive: grid, hierarchy: tree }
accessibility: { readingOrder: depth-first, textEquivalent: nested-list }
---
# Tree Hierarchy

A rooted structure with explicit parent and child relationships.
