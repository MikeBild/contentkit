---
schemaVersion: 1
id: faq-list
version: 1
status: stable
category: faq
scope: node
accepts: { nodeTypes: [faq], minItems: 1, preferredMaxItems: 10, maxItems: 24 }
semantics: { conveys: [question-answer, support], implies: [source-order] }
narrative: {"question":"Which questions should be answered in a single predictable reading order from common to specific?","goal":"A complete vertical question-and-answer sequence with optional HTML disclosure.","arc":["group-reader-questions","prioritize-common-blockers","answer-directly","link-to-next-action"],"takeaway":"A complete vertical question-and-answer sequence with optional HTML disclosure.","decisionSupport":"Use when questions are independent, source order is clear; reject when answers must be compared side by side."}
selection: { intents: [explain, explore], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
responsive: []
fallbacks: [stratified-story]
layout: { primitive: stack }
accessibility: { readingOrder: source-order, textEquivalent: question-answer-list }
slots: [{ name: questions, accepts: [faq], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [disclosure] }
requires: { patterns: [], primitives: [stack, card] }
contentBudget: { maxItems: 24, maxTextCharacters: 18000, maxWordsPerItem: 180 }
examples: [faq-list]
agentHints:
  useWhen: [questions-are-independent, source-order-is-clear]
  rejectWhen: [answers-must-be-compared-side-by-side]
  authoring: [Write complete answers because static output never hides required information.]
staticFallback: faq-list
---
# FAQ List

A complete vertical question-and-answer sequence with optional HTML disclosure.
