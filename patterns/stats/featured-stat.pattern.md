---
schemaVersion: 1
id: featured-stat
version: 1
status: stable
category: stats
scope: node
accepts: { nodeTypes: [metric], minItems: 1, preferredMaxItems: 4, maxItems: 12 }
semantics: { conveys: [metric, emphasis], implies: [primary-value] }
narrative: {"question":"Which quantitative fact deserves dominant emphasis, and what context prevents misinterpretation?","goal":"One lead value receives emphasis while supporting metrics retain authored context.","arc":["establish-context","emphasize-the-fact","show-comparison-or-time","state-implication"],"takeaway":"One lead value receives emphasis while supporting metrics retain authored context.","decisionSupport":"Use when first metric is primary; reject when metrics need equal weight."}
selection: { intents: [status, explain], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
responsive: []
fallbacks: [metric-card]
layout: { primitive: stack }
accessibility: { readingOrder: source-order, textEquivalent: metric-list }
slots: [{ name: metrics, accepts: [metric], min: 1, max: 12, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [], primitives: [stack, card] }
contentBudget: { maxItems: 12, maxTextCharacters: 4000, maxWordsPerItem: 40 }
examples: [featured-stat]
agentHints:
  useWhen: [first-metric-is-primary]
  rejectWhen: [metrics-need-equal-weight]
  authoring: [Order the primary metric first.]
staticFallback: metric-card
---
# Featured Stat

One lead value receives emphasis while supporting metrics retain authored context.
