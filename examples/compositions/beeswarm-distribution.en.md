---
kind: page
layout: composition
title: Beeswarm Distribution
summary: Individual observations are packed without overlap to expose distribution shape and unusual values.
locale: en
slug: pattern-beeswarm-distribution
translationKey: pattern-beeswarm-distribution
composition:
  format: infographic
  canvas: landscape
  intent: explore
  density: balanced
  preferredPattern: beeswarm-distribution
---

:::chart{type="bar" shape="samples" title="Response times" description="Individual P95 response-time observations by environment" unit="ms"}
| Environment | Measurement |
|---|---:|
| Dev | 118 |
| Dev | 126 |
| Dev | 131 |
| Dev | 134 |
| Dev | 142 |
| Dev | 151 |
| Dev | 166 |
| Staging | 139 |
| Staging | 148 |
| Staging | 154 |
| Staging | 161 |
| Staging | 169 |
| Staging | 181 |
| Staging | 204 |
| Production | 152 |
| Production | 159 |
| Production | 167 |
| Production | 174 |
| Production | 186 |
| Production | 198 |
| Production | 236 |
:::
