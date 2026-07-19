---
kind: page
layout: composition
title: Metric Wall
summary: A regular collection of peer metrics for fast scanning.
locale: en
slug: pattern-metric-wall
translationKey: pattern-metric-wall
composition:
  format: infographic
  canvas: landscape
  intent: status
  density: compact
  preferredPattern: metric-wall
---

::::group{columns="3" role="primary"}
::metric{label="Releases" value="42" trend="+12 %" tone="positive"}

::metric{label="Build time" value="2.4 s" trend="−18%" tone="positive"}

::metric{label="Error rate" value="0.08%" trend="−0.03 pp" tone="positive"}

::metric{label="Coverage" value="94 %" trend="+3 pp" tone="positive"}

::metric{label="Documents" value="1,284" trend="+86" tone="neutral"}

::metric{label="Availability" value="99.98%" tone="neutral"}
::::
