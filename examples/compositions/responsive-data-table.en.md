---
title: Responsive Data Table
locale: en
slug: responsive-data-table
summary: A semantic table remains complete in HTML and reflows into records on compact widths.
layout: composition
composition: { format: report, canvas: landscape, intent: status, preferredPattern: responsive-data-table }
---
:::data-table{title="Service status" description="Current state of publishing services" rowKey="Service" keyColumns="Service,Status" columnRoles="Service:key,Status:status,Latency:number,Region:text" defaultSort="Service" role="primary"}
| Service | Status | Latency | Region |
| --- | --- | ---: | --- |
| Compile API | Stable | 184 ms | eu-central |
| Registry API | Stable | 42 ms | global |
| SVG Worker | Stable | 228 ms | eu-central |
| PNG Worker | Monitor | 480 ms | eu-central |
| Publisher | Stable | 310 ms | eu-west |
| Search | Stable | 38 ms | global |
:::
