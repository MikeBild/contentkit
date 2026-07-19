---
schemaVersion: 1
id: analytics-dashboard
version: 1
status: stable
category: dashboard
scope: document
accepts: { nodeTypes: [hero, metric, chart, data-table, dashboard-section, group], minItems: 3, maxItems: 24 }
semantics: { conveys: [overview, analytical-evidence], implies: [summary-before-detail] }
narrative: {"question":"Which trends and segments explain the current outcome, and which signal deserves investigation?","goal":"Lead metrics, one primary analysis and supporting evidence form a coherent dashboard.","arc":["state-overall-health","show-priority-signals","surface-exceptions","connect-exceptions-to-action"],"takeaway":"Lead metrics, one primary analysis and supporting evidence form a coherent dashboard.","decisionSupport":"Use when metrics lead to analytical evidence; reject when document has no summary or evidence."}
selection: { intents: [status, explore], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: stratified-story }]
fallbacks: [grouped-dashboard, stratified-story]
layout: { primitive: grid, columns: 3 }
accessibility: { readingOrder: source-order, textEquivalent: structured-text }
slots:
  - { name: summary, accepts: [hero, metric, dashboard-section], min: 1, max: 8, required: true }
  - { name: evidence, accepts: [chart, data-table, group], min: 1, max: 16, required: true }
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [stratified-story], primitives: [grid, stack] }
contentBudget: { maxItems: 24, maxTextCharacters: 30000, maxWordsPerItem: 100, maxTableRows: 200 }
examples: [analytics-dashboard]
agentHints:
  useWhen: [metrics-lead-to-analytical-evidence]
  rejectWhen: [document-has-no-summary-or-evidence]
  authoring: [Order summary nodes before detailed evidence.]
staticFallback: stratified-story
---
# Analytics Dashboard

Lead metrics, one primary analysis and supporting evidence form a coherent dashboard.
