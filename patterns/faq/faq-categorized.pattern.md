---
schemaVersion: 1
id: faq-categorized
version: 1
status: stable
category: faq
scope: node
accepts: { nodeTypes: [faq], minItems: 4, preferredMaxItems: 16, maxItems: 24 }
semantics: { conveys: [question-answer, categories], implies: [topic-groups] }
narrative: {"question":"Which question groups reflect distinct reader intents, and which answers remove the largest blockers?","goal":"Topic groups help readers locate one answer without changing source order.","arc":["group-reader-questions","prioritize-common-blockers","answer-directly","link-to-next-action"],"takeaway":"Topic groups help readers locate one answer without changing source order.","decisionSupport":"Use when questions have authored categories; reject when categories would be invented."}
selection: { intents: [explain, explore], canvases: [portrait, landscape, flow], densities: [balanced] }
responsive: [{ maxWidth: 720, use: faq-list }]
fallbacks: [faq-columns, faq-list]
layout: { primitive: grid, columns: 2 }
accessibility: { readingOrder: source-order, textEquivalent: categorized-question-list }
slots: [{ name: questions, accepts: [faq], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [disclosure] }
requires: { patterns: [faq-list], primitives: [grid, stack] }
contentBudget: { maxItems: 24, maxTextCharacters: 18000, maxWordsPerItem: 140 }
examples: [faq-categorized]
agentHints:
  useWhen: [questions-have-authored-categories]
  rejectWhen: [categories-would-be-invented]
  authoring: [Provide category on every question or choose faq-list.]
staticFallback: faq-list
---
# Categorized FAQ

Topic groups help readers locate one answer without changing source order.
