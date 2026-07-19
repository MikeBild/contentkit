---
schemaVersion: 1
id: uncertainty-band
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [uncertainty], minItems: 3, preferredMaxItems: 16, maxItems: 36 }
semantics: { conveys: [trend, uncertainty], implies: [lower-estimate-upper] }
narrative: { question: "How does an estimate change over time, and how uncertain is it at each point?", goal: "Present the central estimate together with explicit lower and upper bounds.", arc: [define-estimate-and-confidence-meaning, follow-central-trend, inspect-band-width, distinguish-signal-from-uncertainty], takeaway: "The reader understands both the expected trend and how confidently it can be interpreted.", decisionSupport: "Use only when lower, estimate, and upper values share a defined statistical or operational meaning." }
selection: { intents: [explore, explain], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: [detailed-chart]
layout: { primitive: frame, content: interval-band }
accessibility: { readingOrder: source-order, textEquivalent: table }
---
# Uncertainty Band

An estimate line inside explicit lower and upper bounds communicates trend without false precision.
