---
schemaVersion: 1
id: dumbbell-change
version: 1
status: stable
category: data
scope: node
accepts: { nodeTypes: [chart], dataShapes: [change], minItems: 2, preferredMaxItems: 10, maxItems: 16 }
semantics: { conveys: [change, paired-values], implies: [exactly-two-states] }
narrative: { question: "How far and in which direction did each category move between two states?", goal: "Compare paired values while emphasizing the distance between them.", arc: [name-the-two-states, align-categories, connect-paired-values, compare-direction-and-distance], takeaway: "The reader can identify the largest gains, losses, and unchanged categories.", decisionSupport: "Use for exactly two comparable states; use a timeline or line chart for three or more periods." }
selection: { intents: [compare, status], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
fallbacks: [slope-chart]
layout: { primitive: connector, content: paired-dots }
accessibility: { readingOrder: row-order, textEquivalent: table }
---
# Dumbbell Change

Two values per category connected to emphasize distance and direction of change.
