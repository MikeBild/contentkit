---
schemaVersion: 1
id: stats-inline
version: 1
status: stable
category: stats
scope: node
accepts: { nodeTypes: [metric], minItems: 1, preferredMaxItems: 6, maxItems: 12 }
semantics: { conveys: [metrics, scanning], implies: [peer-values] }
narrative: {"question":"Which concise facts can support nearby prose without interrupting its reading flow?","goal":"A compact row of peer metrics with authored context and status.","arc":["establish-context","emphasize-the-fact","show-comparison-or-time","state-implication"],"takeaway":"A compact row of peer metrics with authored context and status.","decisionSupport":"Use when metrics are peers; reject when one metric is the clear lead."}
selection: { intents: [status, explain], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: featured-stat }]
fallbacks: [featured-stat]
layout: { primitive: grid, columns: 4 }
accessibility: { readingOrder: source-order, textEquivalent: metric-list }
slots: [{ name: metrics, accepts: [metric], min: 1, max: 12, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [featured-stat], primitives: [grid] }
contentBudget: { maxItems: 12, maxTextCharacters: 4000, maxWordsPerItem: 32 }
examples: [stats-inline]
agentHints:
  useWhen: [metrics-are-peers]
  rejectWhen: [one-metric-is-the-clear-lead]
  authoring: [Author period and unit when the value is otherwise ambiguous.]
staticFallback: featured-stat
---
# Inline Stats

A compact row of peer metrics with authored context and status.
