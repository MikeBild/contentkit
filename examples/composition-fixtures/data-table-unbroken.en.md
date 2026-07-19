---
title: Long technical identifiers
locale: en
slug: fixture-data-table-unbroken
summary: Unbreakable tokens must not widen the container.
layout: composition
composition: { format: report, canvas: portrait, intent: status, preferredPattern: record-cards }
---
:::data-table{title="Jobs" rowKey="Job" keyColumns="Job,Status" role="primary" state="stale"}
| Job | Status | Reference |
| --- | --- | --- |
| compile-1 | stable | urn:contentkit:composition:01JZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ |
| compile-2 | review | https://example.invalid/a-very-long-and-deliberately-unbroken-reference-token-for-responsive-validation |
| compile-3 | stable | sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa |
:::
