---
schemaVersion: 1
id: pyramid
version: 1
status: stable
category: structure
scope: node
accepts: { nodeTypes: [hierarchy], minItems: 3, maxItems: 7 }
semantics: { conveys: [rank, accumulation], implies: [ordered-importance] }
narrative: {"question":"Which levels represent increasing foundation, priority, or scarcity, and is that hierarchy semantically justified?","goal":"A ranked or cumulative hierarchy whose shape intentionally communicates order.","arc":["establish-boundary-or-root","group-elements","connect-relationships","reveal-structural-meaning"],"takeaway":"A ranked or cumulative hierarchy whose shape intentionally communicates order.","decisionSupport":"Use when rank, accumulation; choose another pattern when its semantic implications would be misleading."}
selection: { intents: [explain], canvases: [portrait, square], densities: [balanced, spacious] }
fallbacks: [layer-stack]
layout: { primitive: layers, shape: widening }
accessibility: { readingOrder: top-to-bottom, textEquivalent: ordered-list }
---
# Pyramid

A ranked or cumulative hierarchy whose shape intentionally communicates order.
