---
kind: page
layout: report
title: Q2 Business Review
locale: en
slug: q2-business-review
translationKey: q2-business-review
summary: Auditable quarterly snapshot of revenue, reliability, delivery and customer mix.
date: 2026-07-01
---

# Q2 Business Review

This report freezes the approved Q2 state. Its tables are the source data; every chart is a static release asset derived from them.

::::report-grid{columns="4"}
::metric{label="Revenue" value="€1.42M" trend="+12.8% QoQ" tone="positive"}

::metric{label="Gross margin" value="68.4%" trend="+2.1 pp" tone="positive"}

::metric{label="Open risks" value="3" trend="1 critical" tone="negative"}

::metric{label="SLA attainment" value="99.93%" trend="Within target" tone="neutral"}

:::report-card{title="Review status" span="2"}
Finance review :badge[Approved]{tone="positive"} · Operations review :badge[Follow-up]{tone="warning"}

::progress{label="Quarterly objectives completed" value="8" max="10"}
:::

:::report-card{title="Decision" span="2"}
Approve the infrastructure expansion while keeping the enterprise migration risk open until the July checkpoint.
:::

:::chart{type="bar" title="Revenue versus plan" description="Monthly revenue and plan for April through June in thousands of euros" unit="€k" span="2"}
| Month | Revenue | Plan |
|---|---:|---:|
| Apr | 438 | 425 |
| May | 471 | 450 |
| Jun | 512 | 480 |
:::

:::chart{type="line" title="Availability" description="Weekly service availability during the final six weeks of Q2" unit="%" span="2"}
| Week | Availability |
|---|---:|
| 21 | 99.91 |
| 22 | 99.96 |
| 23 | 99.89 |
| 24 | 99.98 |
| 25 | 99.95 |
| 26 | 99.93 |
:::

:::chart{type="area" title="Delivery throughput" description="Completed product and platform work items by month" stacked="true" span="2"}
| Month | Product | Platform |
|---|---:|---:|
| Apr | 18 | 11 |
| May | 22 | 14 |
| Jun | 25 | 17 |
:::

:::chart{type="donut" title="Revenue by segment" description="Share of Q2 revenue by customer segment" unit="€k" span="2"}
| Segment | Revenue |
|---|---:|
| Enterprise | 781 |
| Mid-market | 426 |
| Self-service | 214 |
:::
::::

## Exceptions requiring follow-up

| Owner | Finding | Due |
|---|---|---|
| Finance | Reconcile two late June invoices | 2026-07-18 |
| Operations | Close the enterprise migration risk | 2026-07-25 |
| Product | Confirm the Q3 adoption baseline | 2026-07-31 |
