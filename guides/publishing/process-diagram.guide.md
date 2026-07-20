---
schemaVersion: 1
id: process-diagram
kind: diagram
status: stable
semantics: { conveys: [ordered-stages, handoffs, direction], implies: [sequence-or-dependency], rejects: [unordered-association] }
narrative: { question: "What happens in which order, and where do responsibility or artifacts move?", goal: "Explain a directed sequence from trigger through stages to outcome.", arc: [name-trigger, follow-stages-in-order, expose-handoffs-and-branches, arrive-at-outcome], takeaway: "The reader can follow the process and identify each consequential handoff." }
selection: { useWhen: [order-changes-meaning, stages-have-clear-labels, handoffs-or-branches-matter], rejectWhen: [items-are-only-related, the-process-is-actually-cyclical, sequence-is-unknown] }
input: { required: [trigger, ordered-stages, directed-edges, outcome], optional: [roles, decisions, artifacts, failure-paths], constraints: [prefer-seven-or-fewer-primary-stages, label-meaningful-branches, avoid-crossing-connectors] }
authoring: { syntax: "Mermaid flowchart or semantic process", guidance: [Use verbs for stages., Use decision labels that explain branch meaning., Prefer swimlanes when ownership is the main question.] }
compatiblePatterns: [connected-process, vertical-journey, chevron-process, swimlane-process]
examples: [connected-process, swimlane-process]
---
# Process Diagram

A process diagram tells a directed story from trigger through stages, handoffs, and outcome.
