---
schemaVersion: 1
id: tabbed-code
version: 1
status: stable
category: code
scope: node
accepts: { nodeTypes: [code-example], minItems: 2, preferredMaxItems: 4, maxItems: 8 }
semantics: { conveys: [equivalent-variants, implementation], implies: [one-task-many-languages] }
narrative: {"question":"How can equivalent implementations be compared without repeating the surrounding explanation?","goal":"Equivalent implementations share one frame while static output lists every variant.","arc":["state-task-and-result","establish-prerequisites","show-code-in-reading-order","verify-output"],"takeaway":"Equivalent implementations share one frame while static output lists every variant.","decisionSupport":"Use when variants solve the same task; reject when variants form a sequence."}
selection: { intents: [explain, explore], canvases: [portrait, landscape, square, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: code-walkthrough }]
fallbacks: [code-walkthrough]
layout: { primitive: stack }
accessibility: { readingOrder: source-order, textEquivalent: code-variant-list }
slots: [{ name: variants, accepts: [code-example], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [tabs, copy] }
requires: { patterns: [code-walkthrough], primitives: [stack, card] }
contentBudget: { maxItems: 8, maxTextCharacters: 30000, maxWordsPerItem: 300, maxCodeLines: 120 }
examples: [tabbed-code]
agentHints:
  useWhen: [variants-solve-the-same-task]
  rejectWhen: [variants-form-a-sequence]
  authoring: [Mark one authored default variant and keep every variant complete.]
staticFallback: code-walkthrough
---
# Tabbed Code

Equivalent implementations share one frame while static output lists every variant.
