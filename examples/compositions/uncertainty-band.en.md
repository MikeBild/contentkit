---
kind: page
layout: composition
title: Uncertainty Band
summary: An estimate line inside explicit lower and upper bounds communicates trend without false precision.
locale: en
slug: pattern-uncertainty-band
translationKey: pattern-uncertainty-band
composition:
  format: infographic
  canvas: landscape
  intent: explore
  density: balanced
  preferredPattern: uncertainty-band
---

:::chart{type="line" shape="uncertainty" title="Capacity forecast" description="Expected load with an 80 percent forecast interval" unit="%"}
| Month | Lower bound | Estimate | Upper bound |
|---|---:|---:|---:|
| August | 61 | 68 | 75 |
| September | 64 | 72 | 81 |
| October | 67 | 77 | 87 |
| November | 70 | 81 | 92 |
| December | 72 | 84 | 96 |
:::
