---
kind: page
layout: composition
title: Distribution Boxplot
summary: Five-number summaries compare median, quartiles and total spread across groups.
locale: en
slug: pattern-distribution-boxplot
translationKey: pattern-distribution-boxplot
composition:
  format: infographic
  canvas: landscape
  intent: compare
  density: compact
  preferredPattern: distribution-boxplot
---

:::chart{type="bar" shape="boxplot" orientation="horizontal" title="Build distribution" description="Build duration by environment as a five-number summary" unit="s"}
| Environment | Minimum | Q1 | Median | Q3 | Maximum |
|---|---:|---:|---:|---:|---:|
| Development | 1.2 | 1.7 | 2.1 | 2.8 | 4.2 |
| Staging | 1.8 | 2.4 | 2.9 | 3.6 | 5.1 |
| Production | 2.0 | 2.7 | 3.2 | 3.9 | 5.8 |
:::
