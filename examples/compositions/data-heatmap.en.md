---
kind: page
layout: composition
title: Data Heatmap
summary: A quantitative matrix uses ordered intensity while preserving labeled rows and columns.
locale: en
slug: pattern-data-heatmap
translationKey: pattern-data-heatmap
composition:
  format: infographic
  canvas: landscape
  intent: explore
  density: compact
  preferredPattern: data-heatmap
---

:::chart{type="bar" shape="matrix" title="Service activity" description="Normalized activity by service and weekday"}
| Service | Mo | Di | Mi | Do | Fr |
|---|---:|---:|---:|---:|---:|
| API | 72 | 81 | 88 | 79 | 66 |
| Build | 48 | 65 | 91 | 74 | 57 |
| Search | 68 | 73 | 77 | 84 | 71 |
| Publishing | 35 | 58 | 82 | 69 | 93 |
| Media | 55 | 62 | 70 | 76 | 64 |
:::
