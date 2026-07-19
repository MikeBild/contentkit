---
schemaVersion: 1
id: file-code
version: 1
status: stable
category: code
scope: node
accepts: { nodeTypes: [code-example], minItems: 2, preferredMaxItems: 6, maxItems: 8 }
semantics: { conveys: [files, implementation], implies: [file-structure] }
narrative: {"question":"Which source file matters, what is its role, and which implementation details deserve explanation?","goal":"An authored file index and a code surface communicate a small implementation structure.","arc":["state-task-and-result","establish-prerequisites","show-code-in-reading-order","verify-output"],"takeaway":"An authored file index and a code surface communicate a small implementation structure.","decisionSupport":"Use when variants have authored file names; reject when file structure is not authored."}
selection: { intents: [explain, explore], canvases: [landscape, square, flow], densities: [compact, balanced] }
responsive: [{ maxWidth: 720, use: code-walkthrough }]
fallbacks: [tabbed-code, code-walkthrough]
layout: { primitive: split, columns: 2 }
accessibility: { readingOrder: source-order, textEquivalent: file-and-code-list }
slots: [{ name: variants, accepts: [code-example], min: 1, max: 1, required: true }]
capabilities: { outputs: [html, svg, png, print], interactions: [tabs, copy] }
requires: { patterns: [code-walkthrough], primitives: [split, stack] }
contentBudget: { maxItems: 8, maxTextCharacters: 30000, maxWordsPerItem: 300, maxCodeLines: 120 }
examples: [file-code]
agentHints:
  useWhen: [variants-have-authored-file-names]
  rejectWhen: [file-structure-is-not-authored]
  authoring: [Provide file on each variant.]
staticFallback: code-walkthrough
---
# File Code

An authored file index and a code surface communicate a small implementation structure.
