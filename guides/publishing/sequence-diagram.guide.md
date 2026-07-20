---
schemaVersion: 1
id: sequence-diagram
kind: diagram
status: stable
semantics: { conveys: [messages, participants, temporal-order], implies: [interaction-over-time], rejects: [static-topology] }
narrative: { question: "Who communicates with whom, in what order, and with what response?", goal: "Explain an interaction as messages exchanged between named participants over time.", arc: [introduce-participants, name-trigger, follow-request-and-response, expose-alternatives-or-failures, close-with-result], takeaway: "The reader understands the interaction order and each participant's responsibility." }
selection: { useWhen: [message-order-matters, participants-are-distinct, request-response-or-callbacks-occur], rejectWhen: [only-component-relationships-matter, no-temporal-order-exists, internal-algorithm-steps-dominate] }
input: { required: [participants, ordered-messages, initiator, result], optional: [activation, alternatives, loops, errors], constraints: [use-consistent-participant-names, label-every-message-with-purpose, keep-primary-path-readable-without-branches] }
authoring: { syntax: "Mermaid sequenceDiagram", guidance: [Order participants by the main interaction path., Describe message intent rather than transport trivia., Move rare failures to a separate diagram when they obscure the primary path.] }
compatiblePatterns: [connected-process, swimlane-process, vertical-journey]
examples: [connected-process]
---
# Sequence Diagram

A sequence diagram explains ordered communication between participants from trigger to result.
