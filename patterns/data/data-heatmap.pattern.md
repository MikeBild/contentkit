---
schemaVersion: 1
id: data-heatmap
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [matrix], minItems: 2, preferredMaxItems: 12, maxItems: 24 }
semantics: { conveys: [matrix, intensity], implies: [two-categorical-dimensions] }
narrative: { question: "Where do high, low, or unusual values occur across two categorical dimensions?", goal: "Turn a quantitative matrix into a pattern of intensity while preserving row and column context.", arc: [name-both-dimensions, establish-color-scale, scan-for-clusters, inspect-exceptions], takeaway: "The reader can locate concentrations and anomalies across the complete matrix.", decisionSupport: "Use when cell position across both dimensions matters; use a table when exact lookup dominates pattern recognition." }
selection: { intents: [explore, compare], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
fallbacks: [table-dashboard]
layout: { primitive: matrix, content: value-cells }
accessibility: { readingOrder: row-major, textEquivalent: table }
---
# Data Heatmap

A quantitative matrix uses ordered intensity while preserving labeled rows and columns.
