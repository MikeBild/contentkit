---
schemaVersion: 1
id: sidebar-shell
version: 1
status: stable
category: application
scope: node
accepts: { nodeTypes: [application-shell], minItems: 2, preferredMaxItems: 5, maxItems: 5 }
semantics: { conveys: [application-navigation, workspace], implies: [persistent-navigation] }
narrative: {"question":"How can persistent navigation preserve orientation while leaving enough room for the primary task?","goal":"A controlled application frame with navigation, toolbar, main and optional secondary regions.","arc":["establish-navigation-and-context","focus-primary-task","place-supporting-tools","preserve-orientation"],"takeaway":"A controlled application frame with navigation, toolbar, main and optional secondary regions.","decisionSupport":"Use when navigation is a persistent primary region; reject when the output is only an infographic."}
selection: { intents: [explore, status], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: topbar-shell }]
fallbacks: [topbar-shell]
layout: { primitive: split, columns: 2 }
accessibility: { readingOrder: source-order, textEquivalent: application-regions }
slots: [{ name: regions, accepts: [application-shell], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [navigation, drawer] }
requires: { patterns: [topbar-shell], primitives: [split, stack] }
contentBudget: { maxItems: 5, maxTextCharacters: 8000, maxWordsPerItem: 100 }
examples: [sidebar-shell]
agentHints:
  useWhen: [navigation-is-a-persistent-primary-region]
  rejectWhen: [the-output-is-only-an-infographic]
  authoring: [Provide unique navigation and main regions.]
staticFallback: topbar-shell
---
# Sidebar Shell

A controlled application frame with navigation, toolbar, main and optional secondary regions.
