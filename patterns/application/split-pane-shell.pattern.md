---
schemaVersion: 1
id: split-pane-shell
version: 1
status: stable
category: application
scope: node
accepts: { nodeTypes: [application-shell], minItems: 3, preferredMaxItems: 5, maxItems: 5 }
semantics: { conveys: [workspace, primary-secondary-detail], implies: [simultaneous-regions] }
narrative: {"question":"Which two related contexts must remain visible together so the user can inspect or act without losing place?","goal":"Navigation, main work and secondary detail form a controlled three-region application frame.","arc":["establish-navigation-and-context","focus-primary-task","place-supporting-tools","preserve-orientation"],"takeaway":"Navigation, main work and secondary detail form a controlled three-region application frame.","decisionSupport":"Use when main and secondary regions must remain visible; reject when secondary content is optional on small screens."}
selection: { intents: [explore, compare], canvases: [landscape, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 1024, use: topbar-shell }]
fallbacks: [sidebar-shell, topbar-shell]
layout: { primitive: split, columns: 3 }
accessibility: { readingOrder: source-order, textEquivalent: application-regions }
slots: [{ name: regions, accepts: [application-shell], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [navigation, drawer] }
requires: { patterns: [topbar-shell], primitives: [split, stack] }
contentBudget: { maxItems: 5, maxTextCharacters: 8000, maxWordsPerItem: 100 }
examples: [split-pane-shell]
agentHints:
  useWhen: [main-and-secondary-regions-must-remain-visible]
  rejectWhen: [secondary-content-is-optional-on-small-screens]
  authoring: [Provide an explicit secondary region.]
staticFallback: topbar-shell
---
# Split Pane Shell

Navigation, main work and secondary detail form a controlled three-region application frame.
