---
kind: page
layout: composition
title: Scorecard
summary: A set of evaluated metrics with explicit status or threshold meaning.
locale: en
slug: pattern-scorecard
translationKey: pattern-scorecard
composition:
  format: infographic
  canvas: landscape
  intent: status
  density: compact
  preferredPattern: scorecard
---

::::group{columns="1" role="primary"}
::progress{label="Tests" value="98" max="100"}

::progress{label="Barrierefreiheit" value="92" max="100"}

::progress{label="Documentation" value="87" max="100"}

::progress{label="Performance" value="95" max="100"}

::progress{label="Security Review" value="90" max="100"}
::::
