---
kind: page
layout: composition
title: Table Dashboard
summary: A repeated row-and-column structure for direct comparison across shared dimensions.
locale: en
slug: pattern-table-dashboard
translationKey: pattern-table-dashboard
composition:
  format: infographic
  canvas: landscape
  intent: compare
  density: compact
  preferredPattern: table-dashboard
---

::::group{columns="3" role="primary"}
:::card{title="Development"}
Fast iteration · sample data · daily
:::

:::card{title="Staging"}
Production-like · anonymized data · per release
:::

:::card{title="Production"}
Highly available · real data · controlled approval
:::
::::
