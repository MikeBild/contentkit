---
schemaVersion: 1
id: magazine-story
version: 1
status: stable
category: document
scope: document
accepts: { nodeTypes: [hero, metric, card, process, timeline], minItems: 3, maxItems: 10 }
semantics: { conveys: [narrative, hierarchy], implies: [editorial-reading-order] }
narrative: { question: "How can a complex idea unfold as a readable argument from opening premise to conclusion?", goal: "Create an editorial reading path that alternates explanation, evidence, and reflection.", arc: [open-with-thesis, build-context, introduce-evidence, deepen-interpretation, resolve-with-conclusion], takeaway: "The reader follows a coherent argument and understands how each section supports the conclusion.", decisionSupport: "Use for a continuous explanatory narrative; reject independent modules that can be read in any order." }
selection: { intents: [explain, explore], canvases: [portrait, landscape], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: stratified-story }]
fallbacks: [stratified-story]
layout: { primitive: frame, flow: magazine }
accessibility: { readingOrder: source-order, textEquivalent: structured-text }
---
# Magazine Story

An editorial lead with a large opening statement and staggered supporting facts.
