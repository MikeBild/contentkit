---
schemaVersion: 1
id: operations-dashboard
version: 1
status: stable
category: dashboard
scope: document
accepts: { nodeTypes: [metric, progress, chart, data-table, dashboard-section, group, card], minItems: 3, maxItems: 24 }
semantics: { conveys: [operational-status, exceptions], implies: [current-state] }
narrative: {"question":"Is the operation healthy now, which exception threatens it, and who must respond?","goal":"Current operational signals, progress and exception detail share one ordered surface.","arc":["state-overall-health","show-priority-signals","surface-exceptions","connect-exceptions-to-action"],"takeaway":"Current operational signals, progress and exception detail share one ordered surface.","decisionSupport":"Use when current status and exceptions dominate; reject when the document is a historical narrative."}
selection: { intents: [status], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: stratified-story }]
fallbacks: [table-dashboard, grouped-dashboard]
layout: { primitive: grid, columns: 3 }
accessibility: { readingOrder: source-order, textEquivalent: structured-text }
slots:
  - { name: status, accepts: [metric, progress, dashboard-section], min: 1, max: 10, required: true }
  - { name: detail, accepts: [chart, data-table, group, card], min: 1, max: 16, required: true }
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [stratified-story], primitives: [grid, stack] }
contentBudget: { maxItems: 24, maxTextCharacters: 30000, maxWordsPerItem: 100, maxTableRows: 200 }
examples: [operations-dashboard]
agentHints:
  useWhen: [current-status-and-exceptions-dominate]
  rejectWhen: [the-document-is-a-historical-narrative]
  authoring: [Author state labels explicitly and include stale or error states when relevant.]
staticFallback: stratified-story
---
# Operations Dashboard

Current operational signals, progress and exception detail share one ordered surface.
