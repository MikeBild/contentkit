---
schemaVersion: 1
id: state-diagram
kind: diagram
status: stable
semantics: { conveys: [states, transitions, guards], implies: [finite-state-model], rejects: [task-sequence-without-state] }
narrative: { question: "Which states can an entity occupy, and what causes each valid transition?", goal: "Explain lifecycle rules through states, events, guards, and terminal conditions.", arc: [name-initial-state, trace-primary-transition-path, expose-guards-and-alternatives, identify-terminal-or-recovery-states], takeaway: "The reader understands valid states and the events that move the entity between them." }
selection: { useWhen: [state-controls-behavior, transitions-have-events-or-guards, invalid-transitions-matter], rejectWhen: [steps-do-not-describe-persistent-state, only-chronological-events-are-known, ownership-is-the-main-question] }
input: { required: [entity, states, initial-state, transitions, transition-events], optional: [guards, terminal-states, recovery-paths, nested-states], constraints: [name-states-as-conditions, name-transitions-as-events, make-terminal-states-explicit] }
authoring: { syntax: "Mermaid stateDiagram-v2", guidance: [Keep states distinct from actions., Put conditions on transitions rather than inside state names., Separate exceptional recovery flows if they dominate the primary lifecycle.] }
compatiblePatterns: [circular-lifecycle, vertical-journey, connected-process]
examples: [circular-lifecycle]
---
# State Diagram

A state diagram tells the lifecycle of one entity through valid states and guarded transitions.
