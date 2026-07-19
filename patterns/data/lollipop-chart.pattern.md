---
schemaVersion: 1
id: lollipop-chart
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], minItems: 3, preferredMaxItems: 10, maxItems: 20 }
semantics: { conveys: [magnitude, comparison], rejects: [part-to-whole] }
narrative: { question: "Which categories have larger or smaller values on one shared measure?", goal: "Provide a low-ink magnitude comparison with direct labels and clear endpoints.", arc: [state-shared-measure, align-common-baseline, compare-endpoints, call-out-extremes], takeaway: "The reader can compare category magnitude without unnecessary visual weight.", decisionSupport: "Use for independent magnitudes; do not use when values represent parts of a whole." }
selection: { intents: [compare, explore], canvases: [portrait, landscape, flow], densities: [balanced, spacious] }
fallbacks: [detailed-chart]
layout: { primitive: connector, content: lollipop }
accessibility: { readingOrder: source-order, textEquivalent: table }
---
# Lollipop Chart

A low-ink magnitude comparison using direct labels, stems and prominent endpoints.
