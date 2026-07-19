---
schemaVersion: 1
id: likert-distribution
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [likert], minItems: 2, preferredMaxItems: 8, maxItems: 12 }
semantics: { conveys: [attitude, distribution], implies: [ordered-response-scale] }
narrative: { question: "How are ordered responses distributed between disagreement, neutrality, and agreement?", goal: "Compare attitudes without reducing them to a misleading average.", arc: [define-response-scale, anchor-neutral-center, compare-negative-and-positive-shares, reveal-polarization-or-consensus], takeaway: "The reader sees both direction and distribution of sentiment for each statement.", decisionSupport: "Use only for ordered response categories with a meaningful neutral center." }
selection: { intents: [compare, explore], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
fallbacks: [detailed-chart]
layout: { primitive: split, content: centered-stacks }
accessibility: { readingOrder: row-order, textEquivalent: table }
---
# Likert Distribution

Ordered response shares diverge around a neutral center for survey comparison.
