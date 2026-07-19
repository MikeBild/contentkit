---
schemaVersion: 1
id: pricing-addons
version: 1
status: stable
category: pricing
scope: node
accepts: { nodeTypes: [pricing], minItems: 2, preferredMaxItems: 5, maxItems: 5 }
semantics: { conveys: [base-offer, additions], implies: [one-base-many-addons] }
narrative: {"question":"Which optional additions extend a base offer, and which user need justifies each cost?","goal":"A primary offer and optional additions are separated without obscuring total authored prices.","arc":["establish-buyer-context","align-plans","compare-decisive-features","support-fit-based-choice"],"takeaway":"A primary offer and optional additions are separated without obscuring total authored prices.","decisionSupport":"Use when first plan is a base offer, remaining plans are additions; reject when plans are peer alternatives."}
selection: { intents: [explain, compare], canvases: [portrait, landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: pricing-spotlight }]
fallbacks: [pricing-cards]
layout: { primitive: split, columns: 2 }
accessibility: { readingOrder: source-order, textEquivalent: plan-list }
slots: [{ name: plans, accepts: [pricing], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [pricing-spotlight], primitives: [split, card] }
contentBudget: { maxItems: 5, maxTextCharacters: 9000, maxWordsPerItem: 100 }
examples: [pricing-addons]
agentHints:
  useWhen: [first-plan-is-a-base-offer, remaining-plans-are-additions]
  rejectWhen: [plans-are-peer-alternatives]
  authoring: [Order the base plan first and name additions explicitly.]
staticFallback: pricing-spotlight
---
# Pricing Add-ons

A primary offer and optional additions are separated without obscuring total authored prices.
