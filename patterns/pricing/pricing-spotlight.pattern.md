---
schemaVersion: 1
id: pricing-spotlight
version: 1
status: stable
category: pricing
scope: node
accepts: { nodeTypes: [pricing], minItems: 1, preferredMaxItems: 3, maxItems: 5 }
semantics: { conveys: [offer, recommendation], implies: [featured-plan] }
narrative: {"question":"Which offer is the recommended fit, and which evidence justifies giving it visual priority?","goal":"One authored recommended plan leads, with alternatives remaining fully visible.","arc":["establish-buyer-context","align-plans","compare-decisive-features","support-fit-based-choice"],"takeaway":"One authored recommended plan leads, with alternatives remaining fully visible.","decisionSupport":"Use when one plan is authored as recommended, compact width; reject when no plan should receive emphasis."}
selection: { intents: [explain, compare], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
responsive: []
fallbacks: [stratified-story]
layout: { primitive: stack }
accessibility: { readingOrder: source-order, textEquivalent: plan-list }
slots: [{ name: plans, accepts: [pricing], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [], primitives: [stack, card] }
contentBudget: { maxItems: 5, maxTextCharacters: 9000, maxWordsPerItem: 100 }
examples: [pricing-spotlight]
agentHints:
  useWhen: [one-plan-is-authored-as-recommended, compact-width]
  rejectWhen: [no-plan-should-receive-emphasis]
  authoring: [Recommendation must be explicitly authored.]
staticFallback: pricing-spotlight
---
# Pricing Spotlight

One authored recommended plan leads, with alternatives remaining fully visible.
