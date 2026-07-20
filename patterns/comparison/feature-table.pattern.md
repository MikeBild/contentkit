---
schemaVersion: 1
id: feature-table
version: 1
status: stable
category: comparison
scope: node
accepts: { nodeTypes: [comparison], minItems: 2, preferredMaxItems: 4, maxItems: 6 }
semantics: { conveys: [comparison, repeated-criteria], implies: [shared-dimensions] }
narrative: {"question":"Which capabilities are present in each option, and which differences change the choice?","goal":"A dense labelled table for several alternatives measured on repeated dimensions.","arc":["introduce-options","establish-shared-criteria","reveal-differences","support-choice"],"takeaway":"A dense labelled table for several alternatives measured on repeated dimensions.","decisionSupport":"Use when comparison, repeated criteria; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [compare], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: comparison-matrix }]
fallbacks: [split-comparison]
layout: { primitive: matrix, content: feature-table }
accessibility: { readingOrder: row-major, textEquivalent: table }
---
# Feature Table

A dense labelled table for several alternatives measured on repeated dimensions.
