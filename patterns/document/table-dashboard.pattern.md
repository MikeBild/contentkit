---
schemaVersion: 1
id: table-dashboard
version: 1
status: stable
category: document
scope: document
accepts: { nodeTypes: [metric, chart, progress, group, card], minItems: 4, maxItems: 24 }
semantics: { conveys: [comparison, repeated-dimensions], implies: [shared-row-column-semantics] }
narrative: { question: "How do several subjects compare across the same repeated dimensions?", goal: "Align repeated measures so differences and exceptions can be read accurately by row and column.", arc: [define-subjects-and-dimensions, establish-shared-units, compare-across-rows-and-columns, identify-exceptions], takeaway: "The reader can make precise comparisons across subjects without losing dimensional context.", decisionSupport: "Use when every subject shares the same dimensions; reject heterogeneous cards that cannot be compared cell by cell." }
selection: { intents: [compare, status], canvases: [landscape, flow], densities: [compact] }
responsive: [{ maxWidth: 720, use: grouped-dashboard }]
fallbacks: [grouped-dashboard]
layout: { primitive: matrix, columns: 4 }
accessibility: { readingOrder: row-major, textEquivalent: table }
---
# Table Dashboard

A repeated row-and-column structure for direct comparison across shared dimensions.
