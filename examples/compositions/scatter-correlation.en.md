---
kind: page
layout: composition
title: Scatter Correlation
summary: Points positioned by two quantitative variables reveal association, clusters and outliers.
locale: en
slug: pattern-scatter-correlation
translationKey: pattern-scatter-correlation
composition:
  format: infographic
  canvas: landscape
  intent: explore
  density: balanced
  preferredPattern: scatter-correlation
---

:::chart{type="line" shape="xy" title="Load and latency" description="Requests per second and P95 latency by service" unit="ms"}
| Service | Requests/s | P95-Latency |
|---|---:|---:|
| Auth | 240 | 128 |
| Content | 420 | 166 |
| Search | 690 | 238 |
| Media | 330 | 312 |
| Build | 180 | 196 |
| Publish | 510 | 204 |
| Analytics | 760 | 286 |
:::
