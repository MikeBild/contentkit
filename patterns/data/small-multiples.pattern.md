---
schemaVersion: 1
id: small-multiples
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], minItems: 3, preferredMaxItems: 12, maxItems: 30 }
semantics: { conveys: [repeated-series, comparison], implies: [shared-scale] }
narrative: { question: "How do several comparable series differ in shape, timing, or magnitude?", goal: "Repeat the same visual grammar so readers can compare patterns without line overlap.", arc: [define-shared-measure-and-scale, scan-each-series, compare-shape-and-timing, identify-common-and-exceptional-patterns], takeaway: "The reader can compare many series while preserving each series' internal pattern.", decisionSupport: "Use only with a shared scale and visual grammar; normalize explicitly if raw units are not comparable." }
selection: { intents: [compare, explore], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: detailed-chart }]
fallbacks: [detailed-chart]
layout: { primitive: grid, content: small-multiples }
accessibility: { readingOrder: row-major, textEquivalent: table }
---
# Small Multiples

Repeated compact plots on one shared scale for scanning several series without overlap.
