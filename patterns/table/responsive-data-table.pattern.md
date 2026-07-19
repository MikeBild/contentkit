---
schemaVersion: 1
id: responsive-data-table
version: 1
status: stable
category: table
scope: node
accepts: { nodeTypes: [data-table], minItems: 1, preferredMaxItems: 20, maxItems: 200 }
semantics: { conveys: [records, columns], implies: [tabular-comparison] }
narrative: {"question":"Which shared fields require accurate row comparison across wide and narrow containers?","goal":"A semantic table remains complete in HTML and reflows into records on compact widths.","arc":["define-records-and-fields","preserve-exact-values","support-scan-and-lookup","surface-exceptions"],"takeaway":"A semantic table remains complete in HTML and reflows into records on compact widths.","decisionSupport":"Use when column comparison matters; reject when records have no stable key."}
selection: { intents: [explore, status, compare], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: record-cards }]
fallbacks: [record-cards]
layout: { primitive: matrix }
accessibility: { readingOrder: source-order, textEquivalent: data-table }
slots: [{ name: table, accepts: [data-table], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [sort, filter, pagination] }
requires: { patterns: [record-cards], primitives: [matrix] }
contentBudget: { maxItems: 200, maxTextCharacters: 50000, maxWordsPerItem: 80, maxTableRows: 200, maxColumns: 12 }
examples: [responsive-data-table]
agentHints:
  useWhen: [column-comparison-matters]
  rejectWhen: [records-have-no-stable-key]
  authoring: [Choose a unique rowKey and explicit keyColumns.]
staticFallback: record-cards
---
# Responsive Data Table

A semantic table remains complete in HTML and reflows into records on compact widths.
