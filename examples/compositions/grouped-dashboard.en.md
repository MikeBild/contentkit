---
kind: page
layout: composition
title: Grouped Dashboard
summary: A dashboard that groups operational information into clearly bounded areas.
locale: en
slug: pattern-grouped-dashboard
translationKey: pattern-grouped-dashboard
composition:
  format: infographic
  canvas: landscape
  intent: status
  density: compact
  preferredPattern: grouped-dashboard
---

::::group{columns="2" role="primary"}
:::card{title="Operations"}
99,98 % Availability · no active incident
:::

:::card{title="Delivery"}
42 Releases · Median 2,4 seconds
:::

:::card{title="Quality"}
366 unit tests · 94% coverage
:::

:::card{title="Content"}
1,284 documents · 86 new this quarter
:::
::::
