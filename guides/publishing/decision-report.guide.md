---
schemaVersion: 1
id: decision-report
kind: report
status: stable
semantics: { conveys: [recommendation, evidence, consequence], implies: [decision-owner, actionable-choice], rejects: [evidence-without-conclusion] }
narrative: { question: "What should be decided, why, and what happens next?", goal: "Move from a clear recommendation through decisive evidence to an owned next action.", arc: [state-recommendation, establish-decision-context, present-decisive-evidence, explain-risk-and-tradeoffs, assign-next-action], takeaway: "The reader knows the recommended choice, the evidence behind it, and the next accountable action." }
selection: { useWhen: [a-specific-choice-must-be-made, evidence-and-consequences-can-be-stated, an-owner-can-act], rejectWhen: [the-purpose-is-open-ended-exploration, no-conclusion-is-supported, alternatives-are-not-comparable] }
input: { required: [decision-question, recommendation, supporting-evidence, risks-or-tradeoffs, owner, next-action], optional: [deadline, confidence, alternatives], constraints: [one-primary-recommendation, distinguish-facts-from-judgment, every-action-needs-an-owner] }
authoring: { syntax: "composition Markdown", guidance: [Use a primary hero or callout for the recommendation., Place no more than three decisive evidence blocks before tradeoffs., End with an explicit owner and action.] }
compatiblePatterns: [executive-brief, stratified-story, comparison-matrix]
examples: [executive-brief]
---
# Decision Report

A recommendation-led report connects evidence, consequences, and ownership to a concrete decision.
