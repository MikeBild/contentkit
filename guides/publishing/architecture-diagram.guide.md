---
schemaVersion: 1
id: architecture-diagram
kind: diagram
status: stable
semantics: { conveys: [components, boundaries, dependencies, interfaces], implies: [static-system-structure], rejects: [precise-runtime-order] }
narrative: { question: "Which components exist, where are the boundaries, and how do dependencies cross them?", goal: "Build a correct mental model of system structure and responsibility.", arc: [establish-system-boundary, group-components-by-responsibility, connect-meaningful-dependencies, identify-external-interfaces-and-risks], takeaway: "The reader can locate responsibilities, dependencies, and boundary crossings in the system." }
selection: { useWhen: [system-structure-is-the-question, boundaries-have-meaning, dependency-direction-is-known], rejectWhen: [message-order-is-primary, quantity-flows-between-nodes, components-lack-defined-responsibility] }
input: { required: [system-boundary, components, responsibilities, directed-dependencies], optional: [external-actors, trust-boundaries, protocols, deployment-zones], constraints: [use-one-abstraction-level-per-view, label-boundary-crossings, avoid-decorative-connections] }
authoring: { syntax: "Mermaid flowchart or semantic relationship", guidance: [Group by responsibility rather than visual symmetry., Label connections with their semantic purpose., Create separate views for context and internal detail.] }
compatiblePatterns: [architecture-map, layer-stack, hub-and-spoke, concentric-layers]
examples: [architecture-map]
---
# Architecture Diagram

An architecture diagram explains components, responsibilities, boundaries, and directed dependencies.
