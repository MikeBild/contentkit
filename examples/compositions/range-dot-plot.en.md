---
kind: page
layout: composition
title: Range Dot Plot
summary: Labeled intervals with explicit lower and upper endpoints for comparing ranges.
locale: en
slug: pattern-range-dot-plot
translationKey: pattern-range-dot-plot
composition:
  format: infographic
  canvas: landscape
  intent: compare
  density: compact
  preferredPattern: range-dot-plot
---

:::chart{type="bar" shape="range" orientation="horizontal" title="Delivery ranges" description="Expected duration by workstream with lower and upper bounds" unit="days"}
| Workstream | Lower bound | Upper bound |
|---|---:|---:|
| Semantics | 8 | 12 |
| Renderer | 11 | 17 |
| API | 6 | 10 |
| Documentation | 5 | 9 |
| Validierung | 9 | 14 |
:::
