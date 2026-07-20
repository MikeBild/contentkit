---
schemaVersion: 1
id: faq-columns
version: 1
status: stable
category: faq
scope: node
accepts: { nodeTypes: [faq], minItems: 4, preferredMaxItems: 10, maxItems: 16 }
semantics: { conveys: [question-answer, scanning], implies: [independent-answers] }
narrative: {"question":"Which short, independent questions can be scanned in parallel without losing answer context?","goal":"Two balanced columns for independently readable questions with a list fallback.","arc":["group-reader-questions","prioritize-common-blockers","answer-directly","link-to-next-action"],"takeaway":"Two balanced columns for independently readable questions with a list fallback.","decisionSupport":"Use when answers are short, fast scanning matters; reject when answers are long, sequence matters."}
selection: { intents: [explain, explore], canvases: [landscape, square, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: faq-list }]
fallbacks: [faq-list]
layout: { primitive: grid, columns: 2 }
accessibility: { readingOrder: source-order, textEquivalent: question-answer-list }
slots: [{ name: questions, accepts: [faq], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [disclosure] }
requires: { patterns: [faq-list], primitives: [grid, card] }
contentBudget: { maxItems: 16, maxTextCharacters: 12000, maxWordsPerItem: 120 }
examples: [faq-columns]
agentHints:
  useWhen: [answers-are-short, fast-scanning-matters]
  rejectWhen: [answers-are-long, sequence-matters]
  authoring: [Keep related questions adjacent in source order.]
staticFallback: faq-list
---
# FAQ Columns

Two balanced columns for independently readable questions with a list fallback.
