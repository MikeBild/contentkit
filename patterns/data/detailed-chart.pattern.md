---
schemaVersion: 1
id: detailed-chart
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], minItems: 1, maxItems: 200 }
semantics: { conveys: [quantitative-data], implies: [precise-values-available] }
narrative: { question: "What quantitative pattern is present, and which exact values support it?", goal: "Present labeled quantitative evidence with axes and an accessible source table.", arc: [state-the-analytical-question, establish-dimensions-and-units, show-the-pattern, preserve-exact-values], takeaway: "The reader sees the main quantitative relationship and can verify it against the source data.", decisionSupport: "Use as a safe general chart only when no more specific information pattern expresses the intended story." }
selection: { intents: [status, compare, explore], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
fallbacks: []
layout: { primitive: frame, content: chart }
accessibility: { readingOrder: source-order, textEquivalent: table }
---
# Detailed Chart

A quantitative chart with labels, axes and an accessible source-data table.
