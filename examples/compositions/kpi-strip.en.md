---
kind: page
layout: composition
title: KPI Strip
summary: A compact horizontal run of peer metrics for a report or dashboard header.
locale: en
slug: pattern-kpi-strip
translationKey: pattern-kpi-strip
composition:
  format: infographic
  canvas: landscape
  intent: status
  density: compact
  preferredPattern: kpi-strip
---

::::group{columns="4" role="primary"}
::metric{label="Availability" value="99.98%" trend="on target"}

::metric{label="P95-Latency" value="184 ms" trend="−12 %"}

::metric{label="Releases" value="7" trend="today"}

::metric{label="Error rate" value="0.08%" trend="−0.03 pp"}

::metric{label="Queue" value="14" trend="stable"}
::::
