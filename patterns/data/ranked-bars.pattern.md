---
schemaVersion: 1
id: ranked-bars
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], minItems: 3, preferredMaxItems: 8, maxItems: 16 }
semantics: { conveys: [ranking, magnitude], implies: [sorted-values] }
narrative: { question: "Which categories lead, trail, or form meaningful tiers by magnitude?", goal: "Make ordered magnitude and rank easy to scan and compare.", arc: [name-measure-and-unit, sort-by-value, compare-neighboring-ranks, identify-leaders-laggards-and-gaps], takeaway: "The reader immediately understands order, magnitude, and meaningful separation between categories.", decisionSupport: "Use when rank is central; preserve source order instead when order itself carries semantic meaning." }
selection: { intents: [compare, status], canvases: [portrait, landscape, flow], densities: [compact, balanced] }
fallbacks: [detailed-chart]
layout: { primitive: stack, content: ranked-bars }
accessibility: { readingOrder: descending-value, textEquivalent: table }
---
# Ranked Bars

Sorted horizontal bars with category and value labels placed directly on each row.
