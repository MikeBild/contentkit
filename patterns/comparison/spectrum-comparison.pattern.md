---
schemaVersion: 1
id: spectrum-comparison
version: 1
status: stable
category: comparison
scope: node
accepts: { nodeTypes: [comparison], minItems: 2, preferredMaxItems: 4, maxItems: 6 }
semantics: { conveys: [continuum, relative-position], implies: [ordered-scale] }
narrative: {"question":"Where do alternatives sit along shared qualitative dimensions rather than binary categories?","goal":"Alternatives positioned along explicitly named qualitative criteria from low to high.","arc":["introduce-options","establish-shared-criteria","reveal-differences","support-choice"],"takeaway":"Alternatives positioned along explicitly named qualitative criteria from low to high.","decisionSupport":"Use when continuum, relative position; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [compare, explain], canvases: [landscape, square, flow], densities: [balanced, spacious] }
responsive: [{ maxWidth: 720, use: split-comparison }]
fallbacks: [split-comparison]
layout: { primitive: connector, shape: spectrum }
accessibility: { readingOrder: left-to-right, textEquivalent: ordered-list }
---
# Spectrum Comparison

Alternatives positioned along explicitly named qualitative criteria from low to high.
