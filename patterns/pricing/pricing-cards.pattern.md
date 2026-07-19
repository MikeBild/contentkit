---
schemaVersion: 1
id: pricing-cards
version: 1
status: stable
category: pricing
scope: node
accepts: { nodeTypes: [pricing], minItems: 2, preferredMaxItems: 4, maxItems: 5 }
semantics: { conveys: [offers, choice], implies: [comparable-plans] }
narrative: {"question":"Which plan best fits each audience when price and a concise feature set are compared?","goal":"Comparable plans appear as equal cards with one optional authored recommendation.","arc":["establish-buyer-context","align-plans","compare-decisive-features","support-fit-based-choice"],"takeaway":"Comparable plans appear as equal cards with one optional authored recommendation.","decisionSupport":"Use when two to four comparable plans; reject when features require row alignment."}
selection: { intents: [compare, explain], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: pricing-spotlight }]
fallbacks: [pricing-spotlight]
layout: { primitive: grid, columns: 3 }
accessibility: { readingOrder: source-order, textEquivalent: plan-list }
slots: [{ name: plans, accepts: [pricing], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [pricing-spotlight], primitives: [grid, card] }
contentBudget: { maxItems: 5, maxTextCharacters: 9000, maxWordsPerItem: 100 }
examples: [pricing-cards]
agentHints:
  useWhen: [two-to-four-comparable-plans]
  rejectWhen: [features-require-row-alignment]
  authoring: [Use one currency and at most one recommended plan.]
staticFallback: pricing-spotlight
---
# Pricing Cards

Comparable plans appear as equal cards with one optional authored recommendation.
