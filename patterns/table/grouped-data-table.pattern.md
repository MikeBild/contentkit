---
schemaVersion: 1
id: grouped-data-table
version: 1
status: stable
category: table
scope: node
accepts: { nodeTypes: [data-table], minItems: 4, preferredMaxItems: 30, maxItems: 200 }
semantics: { conveys: [records, groups], implies: [authored-group-column] }
narrative: {"question":"Which exact records must be inspected within meaningful groups while preserving shared columns?","goal":"Authored record groups add scan structure while preserving one semantic table.","arc":["define-records-and-fields","preserve-exact-values","support-scan-and-lookup","surface-exceptions"],"takeaway":"Authored record groups add scan structure while preserving one semantic table.","decisionSupport":"Use when an authored column defines meaningful groups; reject when groups would be derived or invented."}
selection: { intents: [explore, status], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: record-cards }]
fallbacks: [responsive-data-table, record-cards]
layout: { primitive: matrix }
accessibility: { readingOrder: source-order, textEquivalent: grouped-data-table }
slots: [{ name: table, accepts: [data-table], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [sort, filter, pagination] }
requires: { patterns: [record-cards], primitives: [matrix, stack] }
contentBudget: { maxItems: 200, maxTextCharacters: 50000, maxWordsPerItem: 80, maxTableRows: 200, maxColumns: 12 }
examples: [grouped-data-table]
agentHints:
  useWhen: [an-authored-column-defines-meaningful-groups]
  rejectWhen: [groups-would-be-derived-or-invented]
  authoring: [Use columnRoles to identify group and status meaning.]
staticFallback: record-cards
---
# Grouped Data Table

Authored record groups add scan structure while preserving one semantic table.
