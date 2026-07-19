---
schemaVersion: 1
id: dashboard-detail
version: 1
status: stable
category: dashboard
scope: document
accepts: { nodeTypes: [hero, metric, chart, data-table, dashboard-section, group, card], minItems: 2, maxItems: 24 }
semantics: { conveys: [entity-detail, supporting-evidence], implies: [one-subject] }
narrative: {"question":"What is happening to one focal metric, which evidence explains it, and what action follows?","goal":"A subject summary and its detailed evidence remain distinct and responsive.","arc":["state-overall-health","show-priority-signals","surface-exceptions","connect-exceptions-to-action"],"takeaway":"A subject summary and its detailed evidence remain distinct and responsive.","decisionSupport":"Use when one subject has summary and detail; reject when multiple peer subjects need comparison."}
selection: { intents: [explain, status, explore], canvases: [portrait, landscape, flow], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: stratified-story }]
fallbacks: [executive-brief, stratified-story]
layout: { primitive: split, columns: 2 }
accessibility: { readingOrder: source-order, textEquivalent: structured-text }
slots:
  - { name: subject, accepts: [hero, metric, dashboard-section, card], min: 1, max: 8, required: true }
  - { name: evidence, accepts: [chart, data-table, group], min: 1, max: 16, required: true }
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [stratified-story], primitives: [split, stack] }
contentBudget: { maxItems: 24, maxTextCharacters: 30000, maxWordsPerItem: 100, maxTableRows: 200 }
examples: [dashboard-detail]
agentHints:
  useWhen: [one-subject-has-summary-and-detail]
  rejectWhen: [multiple-peer-subjects-need-comparison]
  authoring: [Keep the subject summary first and evidence complete.]
staticFallback: stratified-story
---
# Dashboard Detail

A subject summary and its detailed evidence remain distinct and responsive.
