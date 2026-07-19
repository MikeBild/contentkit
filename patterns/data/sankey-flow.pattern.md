---
schemaVersion: 1
id: sankey-flow
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [flow], minItems: 3, preferredMaxItems: 12, maxItems: 24 }
semantics: { conveys: [quantitative-flow, stages], implies: [source-target-value] }
narrative: { question: "How does a quantity move, split, or converge between stages?", goal: "Explain proportional flow from sources through intermediate stages to destinations.", arc: [establish-total-input, trace-major-paths, reveal-splits-and-merges, account-for-destinations-or-losses], takeaway: "The reader can follow where quantity comes from, where it goes, and which paths dominate.", decisionSupport: "Use only for conserved or explicitly accounted flow; use a process diagram when sequence matters but quantity does not." }
selection: { intents: [explain, explore], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: [vertical-journey]
layout: { primitive: connector, content: weighted-flows }
accessibility: { readingOrder: source-target, textEquivalent: table }
---
# Sankey Flow

Weighted source-to-target connections explain how quantities move between stages.
