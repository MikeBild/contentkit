---
schemaVersion: 1
id: pricing-comparison
version: 1
status: stable
category: pricing
scope: node
accepts: { nodeTypes: [pricing], minItems: 2, preferredMaxItems: 4, maxItems: 5 }
semantics: { conveys: [offers, feature-comparison], implies: [aligned-features] }
narrative: {"question":"Which plan differences remain after aligning price, cadence, limits, and capabilities?","goal":"A plan-feature matrix makes authored differences explicit without inventing parity.","arc":["establish-buyer-context","align-plans","compare-decisive-features","support-fit-based-choice"],"takeaway":"A plan-feature matrix makes authored differences explicit without inventing parity.","decisionSupport":"Use when feature identities align across plans; reject when features are not comparable."}
selection: { intents: [compare], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: pricing-cards }]
fallbacks: [pricing-cards, pricing-spotlight]
layout: { primitive: matrix }
accessibility: { readingOrder: source-order, textEquivalent: plan-feature-matrix }
slots: [{ name: plans, accepts: [pricing], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [pricing-cards], primitives: [matrix] }
contentBudget: { maxItems: 5, maxTextCharacters: 9000, maxWordsPerItem: 100, maxColumns: 6 }
examples: [pricing-comparison]
agentHints:
  useWhen: [feature-identities-align-across-plans]
  rejectWhen: [features-are-not-comparable]
  authoring: [Use identical feature wording when a feature is shared.]
staticFallback: pricing-cards
---
# Pricing Comparison

A plan-feature matrix makes authored differences explicit without inventing parity.
