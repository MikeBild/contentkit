---
schemaVersion: 1
id: executive-brief
version: 1
status: stable
category: document
scope: document
accepts: { nodeTypes: [hero, metric, card, chart, group], minItems: 3, maxItems: 12 }
semantics: { conveys: [summary, decision-support], implies: [primary-recommendation] }
narrative: { question: "What should be decided, which evidence matters most, and what action follows?", goal: "Compress recommendation, decisive evidence, tradeoffs, and ownership into one decision-ready view.", arc: [state-recommendation, establish-urgency-and-scope, present-decisive-evidence, expose-risk-and-tradeoffs, assign-next-action], takeaway: "The reader knows the recommended decision, why it is supported, and who acts next.", decisionSupport: "Use only when a supported recommendation exists; reject neutral exploration or evidence without a conclusion." }
selection: { intents: [status, explain], canvases: [portrait, landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: stratified-story }]
fallbacks: [stratified-story]
layout: { primitive: frame, flow: executive-brief }
accessibility: { readingOrder: source-order, textEquivalent: structured-text }
---
# Executive Brief

A decision-led summary with recommendation, evidence and named next actions.
