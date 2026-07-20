---
kind: page
layout: composition
title: Bullet Scoreboard
summary: Compact target bars that compare actual progress with an explicit reference marker.
locale: en
slug: pattern-bullet-scoreboard
translationKey: pattern-bullet-scoreboard
composition:
  format: infographic
  canvas: landscape
  intent: status
  density: compact
  preferredPattern: bullet-scoreboard
---

::::group{columns="1" role="primary"}
::progress{label="Performance" value="94" max="100"}

::progress{label="Accessibility" value="91" max="100"}

::progress{label="Test coverage" value="86" max="100"}

::progress{label="Documentation" value="82" max="100"}

::progress{label="Security" value="97" max="100"}
::::
