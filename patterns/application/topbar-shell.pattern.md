---
schemaVersion: 1
id: topbar-shell
version: 1
status: stable
category: application
scope: node
accepts: { nodeTypes: [application-shell], minItems: 1, preferredMaxItems: 5, maxItems: 5 }
semantics: { conveys: [application-navigation, compact-workspace], implies: [top-level-navigation] }
narrative: {"question":"How can global navigation and actions remain available without competing with the main workspace?","goal":"A compact navigation region leads the controlled application content areas.","arc":["establish-navigation-and-context","focus-primary-task","place-supporting-tools","preserve-orientation"],"takeaway":"A compact navigation region leads the controlled application content areas.","decisionSupport":"Use when compact navigation, narrow width; reject when persistent sidebar context is essential."}
selection: { intents: [explore, status], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
responsive: []
fallbacks: [stratified-story]
layout: { primitive: stack }
accessibility: { readingOrder: source-order, textEquivalent: application-regions }
slots: [{ name: regions, accepts: [application-shell], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [navigation, drawer] }
requires: { patterns: [], primitives: [stack] }
contentBudget: { maxItems: 5, maxTextCharacters: 8000, maxWordsPerItem: 100 }
examples: [topbar-shell]
agentHints:
  useWhen: [compact-navigation, narrow-width]
  rejectWhen: [persistent-sidebar-context-is-essential]
  authoring: [Keep primary navigation short enough for a compact region.]
staticFallback: topbar-shell
---
# Topbar Shell

A compact navigation region leads the controlled application content areas.
