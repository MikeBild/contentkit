---
title: Record Cards
locale: en
slug: record-cards
summary: Rows become labeled records without shrinking a wide table beyond readability.
layout: composition
composition: { format: report, canvas: portrait, intent: status, preferredPattern: record-cards }
---
:::data-table{title="Service status" rowKey="Service" keyColumns="Service,Status" columnRoles="Service:key,Status:status,Latency:number" role="primary"}
| Service | Status | Latency | Owner |
| --- | --- | ---: | --- |
| Compile API | Stable | 184 ms | Platform |
| Registry API | Stable | 42 ms | Content |
| SVG Worker | Stable | 228 ms | Visual |
| PNG Worker | Monitor | 480 ms | Visual |
:::
