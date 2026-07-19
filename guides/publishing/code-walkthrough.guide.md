---
schemaVersion: 1
id: code-walkthrough-guide
kind: code
status: stable
semantics: { conveys: [implementation, sequence, expected-result], implies: [executable-or-verifiable-example], rejects: [unexplained-code-dump] }
narrative: { question: "How can the reader perform one concrete task and verify the result?", goal: "Connect purpose, prerequisites, ordered code, and observable outcome into a reproducible explanation.", arc: [state-task-and-result, establish-prerequisites, execute-minimal-steps, explain-consequential-lines, verify-output], takeaway: "The reader can reproduce the task and knows how to confirm that it worked." }
selection: { useWhen: [a-concrete-task-can-be-reproduced, code-is-the-clearest-evidence, an-observable-result-exists], rejectWhen: [code-is-incidental, variants-need-a-feature-comparison, prerequisites-cannot-be-stated] }
input: { required: [task, prerequisites, language, code, expected-result], optional: [file-path, variants, explanation, failure-case], constraints: [keep-each-example-runnable-or-explicitly-partial, state-secret-placeholders, limit-one-purpose-per-example] }
authoring: { syntax: "code-example directive", guidance: [Lead with the outcome rather than the language name., Explain only lines that change understanding., Include a verification command or expected output.] }
compatiblePatterns: [code-walkthrough, file-code, tabbed-code]
examples: [code-walkthrough, file-code]
---
# Code Walkthrough

A code walkthrough turns source into a reproducible task with prerequisites, explanation, and verification.
