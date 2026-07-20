---
schemaVersion: 1
id: stratified-story
version: 1
status: stable
category: document
scope: document
accepts: { nodeTypes: [hero, metric, process, comparison, timeline, chart, group], minItems: 2, maxItems: 24 }
semantics: { conveys: [top-down-narrative], implies: [decreasing-emphasis] }
narrative: { question: "How can the most important conclusion be understood first and then progressively explained?", goal: "Layer a top-down explanation from primary conclusion through supporting evidence to optional detail.", arc: [state-conclusion, explain-major-reasons, provide-supporting-evidence, disclose-optional-detail], takeaway: "The reader can stop at any depth while retaining a correct understanding of the main conclusion.", decisionSupport: "Use when information has clear decreasing importance; reject stories whose meaning depends on suspense or chronology." }
selection: { intents: [explain, sequence], canvases: [portrait, landscape, flow], densities: [compact, balanced, spacious] }
fallbacks: []
layout: { primitive: stack, flow: vertical }
accessibility: { readingOrder: source-order, textEquivalent: structured-text }
---
# Stratified Story

A vertical narrative that moves from the main message into supporting detail.
