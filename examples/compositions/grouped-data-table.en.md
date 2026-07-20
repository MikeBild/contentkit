---
title: Grouped Data Table
locale: en
slug: grouped-data-table
summary: Authored record groups add scan structure while preserving one semantic table.
layout: composition
composition: { format: report, canvas: landscape, intent: explore, preferredPattern: grouped-data-table }
---
:::data-table{title="Release status" rowKey="Release" keyColumns="Release,Environment" columnRoles="Release:key,Environment:text,Status:status,Duration:number" defaultSort="Environment" role="primary"}
| Release | Environment | Status | Duration |
| --- | --- | --- | ---: |
| 2026.07.19-1 | Production | Active | 42 s |
| 2026.07.19-2 | Production | Active | 38 s |
| 2026.07.19-3 | Staging | Review | 31 s |
| 2026.07.19-4 | Staging | Ready | 29 s |
| 2026.07.19-5 | Development | Active | 24 s |
| 2026.07.19-6 | Development | Active | 25 s |
:::
