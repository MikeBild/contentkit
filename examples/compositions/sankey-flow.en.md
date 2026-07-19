---
kind: page
layout: composition
title: Sankey Flow
summary: Weighted source-to-target connections explain how quantities move between stages.
locale: en
slug: pattern-sankey-flow
translationKey: pattern-sankey-flow
composition:
  format: infographic
  canvas: landscape
  intent: explain
  density: balanced
  preferredPattern: sankey-flow
---

:::chart{type="bar" shape="flow" title="Requests through the system" description="Request count between processing steps"}
| Source | Target | Count |
|---|---|---:|
| Input | Validated | 920 |
| Input | Rejected | 80 |
| Validated | Cache | 310 |
| Validated | Renderer | 610 |
| Cache | Delivered | 300 |
| Renderer | Delivered | 590 |
| Renderer | Errors | 20 |
:::
