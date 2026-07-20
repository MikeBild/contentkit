---
schemaVersion: 1
id: analytical-report
kind: report
status: stable
semantics: { conveys: [question, evidence, interpretation, limitations], implies: [traceable-data, analytical-method], rejects: [unsupported-causality] }
narrative: { question: "What does the evidence show, how should it be interpreted, and what remains uncertain?", goal: "Guide the reader from an analytical question through evidence to a bounded conclusion.", arc: [state-question-and-scope, define-measures-and-method, present-evidence-in-logical-order, interpret-patterns, state-limitations-and-conclusion], takeaway: "The reader understands the supported conclusion, the evidence behind it, and the limits of that conclusion." }
selection: { useWhen: [evidence-must-be-interpreted, multiple-views-support-one-question, limitations-matter], rejectWhen: [only-current-status-is-needed, a-decision-is-already-settled, no-traceable-data-exists] }
input: { required: [analytical-question, scope, measures-and-units, evidence, interpretation, limitations], optional: [hypothesis, segments, confidence, recommended-follow-up], constraints: [every-chart-needs-a-question, label-observation-window, separate-observation-from-inference] }
authoring: { syntax: "composition Markdown", guidance: [Choose each visual by the relationship in the evidence., Place interpretation directly after the evidence it explains., End with a bounded conclusion rather than a metric recap.] }
compatiblePatterns: [magazine-story, stratified-story, detailed-chart, small-multiples]
examples: [magazine-story, detailed-chart]
---
# Analytical Report

An evidence-led report explains a question, the observed pattern, its interpretation, and its limits.
