---
schemaVersion: 1
id: comparison-matrix
version: 1
status: stable
category: comparison
scope: node
accepts: { nodeTypes: [comparison], minItems: 2, maxItems: 6 }
semantics: { conveys: [comparison, repeated-criteria], implies: [shared-dimensions] }
narrative: {"question":"How do several options perform across the same criteria, and where are the decisive tradeoffs?","goal":"Several subjects compared across a repeated and explicitly named set of criteria.","arc":["introduce-options","establish-shared-criteria","reveal-differences","support-choice"],"takeaway":"Several subjects compared across a repeated and explicitly named set of criteria.","decisionSupport":"Use when comparison, repeated criteria; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [compare, explore], canvases: [landscape, flow], densities: [compact, balanced] }
fallbacks: [split-comparison]
layout: { primitive: matrix, columns: 3 }
accessibility: { readingOrder: row-major, textEquivalent: table }
---
# Comparison Matrix

Several subjects compared across a repeated and explicitly named set of criteria.
