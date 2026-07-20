---
schemaVersion: 1
id: treemap
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [hierarchy], minItems: 3, preferredMaxItems: 12, maxItems: 24 }
semantics: { conveys: [part-to-whole, hierarchy], implies: [non-negative-size] }
narrative: { question: "Which hierarchical parts contribute most to the whole?", goal: "Show nested part-to-whole composition using non-negative size.", arc: [establish-total, group-by-hierarchy, compare-largest-parts, inspect-concentration-and-long-tail], takeaway: "The reader sees dominant contributors and how they belong to higher-level groups.", decisionSupport: "Use only for non-negative additive values; use ranked bars when precise comparison is more important than hierarchy." }
selection: { intents: [explore, compare], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
fallbacks: [ranked-bars]
layout: { primitive: grid, content: proportional-rectangles }
accessibility: { readingOrder: descending-value, textEquivalent: table }
---
# Treemap

Nested proportional rectangles communicate hierarchical parts of a non-negative whole.
