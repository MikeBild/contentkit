---
schemaVersion: 1
id: hero-banner
version: 1
status: stable
category: metrics
scope: node
accepts: { nodeTypes: [hero], minItems: 1, maxItems: 1 }
semantics: { conveys: [primary-message], implies: [highest-emphasis] }
narrative: {"question":"What single message and supporting context must orient the reader before anything else?","goal":"A dominant title and concise explanation that establish the primary message.","arc":["name-the-measure","show-value-and-unit","add-target-period-or-trend","state-meaning"],"takeaway":"A dominant title and concise explanation that establish the primary message.","decisionSupport":"Use when primary message; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [explain, status], canvases: [portrait, landscape, square, flow], densities: [balanced, spacious] }
fallbacks: []
layout: { primitive: frame, emphasis: primary }
accessibility: { readingOrder: source-order, textEquivalent: structured-text }
---
# Hero Banner

A dominant title and concise explanation that establish the primary message.
