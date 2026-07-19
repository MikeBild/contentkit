---
schemaVersion: 1
id: code-walkthrough
version: 1
status: stable
category: code
scope: node
accepts: { nodeTypes: [code-example], minItems: 1, preferredMaxItems: 5, maxItems: 8 }
semantics: { conveys: [implementation, sequence], implies: [source-order] }
narrative: {"question":"How can the reader complete a technical task step by step and verify the final result?","goal":"A readable vertical sequence for one or more complete code variants.","arc":["state-task-and-result","establish-prerequisites","show-code-in-reading-order","verify-output"],"takeaway":"A readable vertical sequence for one or more complete code variants.","decisionSupport":"Use when variants are read in source order, compact width; reject when variants need side by side comparison."}
selection: { intents: [explain, sequence], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
responsive: []
fallbacks: [stratified-story]
layout: { primitive: stack }
accessibility: { readingOrder: source-order, textEquivalent: code-variant-list }
slots: [{ name: variants, accepts: [code-example], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [copy] }
requires: { patterns: [], primitives: [stack, card] }
contentBudget: { maxItems: 8, maxTextCharacters: 30000, maxWordsPerItem: 300, maxCodeLines: 120 }
examples: [code-walkthrough]
agentHints:
  useWhen: [variants-are-read-in-source-order, compact-width]
  rejectWhen: [variants-need-side-by-side-comparison]
  authoring: [Keep each code block independently understandable.]
staticFallback: code-walkthrough
---
# Code Walkthrough

A readable vertical sequence for one or more complete code variants.
