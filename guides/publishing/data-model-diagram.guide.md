---
schemaVersion: 1
id: data-model-diagram
kind: diagram
status: stable
semantics: { conveys: [entities, relationships, cardinality], implies: [structural-data-model], rejects: [runtime-message-flow] }
narrative: { question: "Which entities exist, how are they related, and what cardinality constrains those relationships?", goal: "Explain a data domain through stable entities, identifiers, and relationship rules.", arc: [introduce-domain, define-core-entities, connect-relationships, expose-cardinality-and-ownership, identify-boundary-cases], takeaway: "The reader understands the domain structure and the rules connecting its entities." }
selection: { useWhen: [entities-have-stable-identities, relationship-cardinality-matters, schema-structure-is-primary], rejectWhen: [runtime-order-is-primary, components-are-services-not-data-entities, relationships-are-only-conceptual] }
input: { required: [entities, primary-identifiers, relationships, cardinalities], optional: [attributes, ownership, optionality, constraints], constraints: [show-only-decision-relevant-attributes, label-cardinality, keep-one-domain-boundary-per-view] }
authoring: { syntax: "Mermaid erDiagram or classDiagram", guidance: [Start with core entities and add attributes only when they explain a rule., Make optionality and cardinality explicit., Use an architecture diagram for service dependencies.] }
compatiblePatterns: [tree-hierarchy, architecture-map, hub-and-spoke]
examples: [tree-hierarchy]
---
# Data Model Diagram

A data model diagram explains stable entities, identifiers, relationships, and cardinality rules.
