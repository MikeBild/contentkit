---
schemaVersion: 1
id: bento-summary
version: 1
status: stable
category: document
scope: document
accepts: { nodeTypes: [hero, metric, process, comparison, timeline, chart, group], minItems: 3, maxItems: 12 }
semantics: { conveys: [overview, grouped-summary], implies: [independent-modules] }
narrative: { question: "How can one overview connect several related facts while keeping each fact independently understandable?", goal: "Create a coherent summary from modular facts with one clear entry point and visible hierarchy.", arc: [establish-primary-message, introduce-key-signal, scan-independent-supporting-facts, reconnect-details-to-overview], takeaway: "The reader understands the whole and can still inspect each supporting fact on its own.", decisionSupport: "Use when modules are related but independently readable; reject a continuous argument that depends on strict paragraph order." }
selection: { intents: [explain, status], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: stratified-story }]
fallbacks: [grouped-dashboard]
layout: { primitive: grid, columns: 3 }
accessibility: { readingOrder: source-order, textEquivalent: structured-text }
---
# Bento Summary

An asymmetric summary grid for several related but independently readable facts.
