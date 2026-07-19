---
schemaVersion: 1
id: record-cards
version: 1
status: stable
category: table
scope: node
accepts: { nodeTypes: [data-table], minItems: 1, preferredMaxItems: 12, maxItems: 200 }
semantics: { conveys: [records, labeled-fields], implies: [row-first-reading] }
narrative: {"question":"How can each record remain readable in a narrow container without losing typed field relationships?","goal":"Rows become labeled records without shrinking a wide table beyond readability.","arc":["define-records-and-fields","preserve-exact-values","support-scan-and-lookup","surface-exceptions"],"takeaway":"Rows become labeled records without shrinking a wide table beyond readability.","decisionSupport":"Use when compact width, row first reading; reject when cross row column comparison is primary."}
selection: { intents: [explore, status, compare], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
responsive: []
fallbacks: [stratified-story]
layout: { primitive: stack }
accessibility: { readingOrder: source-order, textEquivalent: record-list }
slots: [{ name: table, accepts: [data-table], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [filter, pagination] }
requires: { patterns: [], primitives: [stack, card] }
contentBudget: { maxItems: 200, maxTextCharacters: 50000, maxWordsPerItem: 80, maxTableRows: 200, maxColumns: 12 }
examples: [record-cards]
agentHints:
  useWhen: [compact-width, row-first-reading]
  rejectWhen: [cross-row-column-comparison-is-primary]
  authoring: [Put the identifying fields in keyColumns.]
staticFallback: record-cards
---
# Record Cards

Rows become labeled records without shrinking a wide table beyond readability.
