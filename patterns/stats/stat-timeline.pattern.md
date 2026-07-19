---
schemaVersion: 1
id: stat-timeline
version: 1
status: stable
category: stats
scope: node
accepts: { nodeTypes: [metric], minItems: 2, preferredMaxItems: 6, maxItems: 12 }
semantics: { conveys: [metrics, change-over-time], implies: [ordered-periods] }
narrative: {"question":"How did a key statistic change across named moments, and which transition matters most?","goal":"Authored period labels turn metric values into a chronological sequence.","arc":["establish-context","emphasize-the-fact","show-comparison-or-time","state-implication"],"takeaway":"Authored period labels turn metric values into a chronological sequence.","decisionSupport":"Use when every metric has an authored period; reject when source order is not chronological."}
selection: { intents: [status, sequence], canvases: [portrait, landscape, flow], densities: [balanced] }
responsive: [{ maxWidth: 720, use: featured-stat }]
fallbacks: [stats-inline, featured-stat]
layout: { primitive: sequence }
accessibility: { readingOrder: source-order, textEquivalent: metric-sequence }
slots: [{ name: metrics, accepts: [metric], min: 2, max: 12, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [] }
requires: { patterns: [featured-stat], primitives: [sequence] }
contentBudget: { maxItems: 12, maxTextCharacters: 4000, maxWordsPerItem: 40 }
examples: [stat-timeline]
agentHints:
  useWhen: [every-metric-has-an-authored-period]
  rejectWhen: [source-order-is-not-chronological]
  authoring: [Never infer periods or trends.]
staticFallback: featured-stat
---
# Stat Timeline

Authored period labels turn metric values into a chronological sequence.
