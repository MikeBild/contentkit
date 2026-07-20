---
schemaVersion: 1
id: status-report
kind: report
status: stable
semantics: { conveys: [current-state, movement, exceptions, action], implies: [observation-window, targets-or-thresholds], rejects: [unbounded-metric-dump] }
narrative: { question: "What is the current state, what changed, and where is attention required?", goal: "Turn a set of operational signals into a prioritized account of health and action.", arc: [name-observation-window, state-overall-health, show-key-signals, surface-exceptions, assign-actions], takeaway: "The reader knows whether the system is healthy, what changed, and which exceptions require action." }
selection: { useWhen: [recurring-operational-review, comparable-signals-have-targets, exceptions-drive-action], rejectWhen: [metrics-have-no-shared-context, the-main-purpose-is-causal-analysis, no-time-window-is-defined] }
input: { required: [observation-window, metric-labels, typed-values-and-units, status-or-threshold, exceptions], optional: [trend, owner, next-action, comparison-period], constraints: [one-unit-per-comparable-series, distinguish-percentage-from-percentage-point, show-period-for-every-trend] }
authoring: { syntax: "composition Markdown", guidance: [Lead with overall state rather than a metric grid., Group signals by operational question., Show only exceptions that change interpretation or action.] }
compatiblePatterns: [grouped-dashboard, analytics-dashboard, operations-dashboard, scorecard]
examples: [grouped-dashboard, operations-dashboard]
---
# Status Report

A recurring status report orders health, movement, exceptions, and accountable action.
