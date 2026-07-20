---
kind: page
layout: composition
title: Split Comparison
summary: Two subjects shown side by side using the same comparison dimensions.
locale: en
slug: pattern-split-comparison
translationKey: pattern-split-comparison
composition:
  format: infographic
  canvas: landscape
  intent: compare
  density: compact
  preferredPattern: split-comparison
---

::::comparison{title="REST and MCP" role="primary"}
:::side{label="REST"}
- Integration · individual per API
- Coupling · often high
- Reuse · limited
:::
:::side{label="MCP"}
- Integration · shared contract
- Coupling · clearly separated
- Reuse · across servers
:::
::::
