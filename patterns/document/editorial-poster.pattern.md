---
schemaVersion: 1
id: editorial-poster
version: 1
status: stable
category: document
scope: document
accepts: { nodeTypes: [hero, metric, process, comparison, timeline, chart, group], minItems: 2, maxItems: 12 }
semantics: { conveys: [overview, hierarchy], implies: [single-primary-message] }
narrative: { question: "What single message must be understood first, and which few facts make it memorable?", goal: "Lead with one dominant statement and support it with a small number of high-value facts.", arc: [state-primary-message, add-essential-context, present-memorable-evidence, close-with-one-takeaway], takeaway: "The reader retains one central message and the evidence that gives it meaning.", decisionSupport: "Use for one dominant message; reject documents with several equal conclusions or dense reference material." }
selection: { intents: [explain], canvases: [portrait, square], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: stratified-story }]
fallbacks: [stratified-story]
layout: { primitive: frame, flow: poster }
accessibility: { readingOrder: source-order, textEquivalent: structured-text }
---
# Editorial Poster

A strong primary statement followed by a small number of supporting facts.
