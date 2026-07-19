---
title: Operations Dashboard
locale: en
slug: operations-dashboard
summary: Current operational signals, progress and exception detail share one ordered surface.
layout: composition
composition: { format: report, canvas: landscape, intent: status, preferredPattern: operations-dashboard }
---
:::dashboard-section{title="Live Operations" description="As of 14:00 UTC" state="normal" role="primary"}
:::
:::metric{label="Availability" value="99.99%" period="24 hours" status="stable"}
:::
:::progress{label="Monthly budget" value="68" max="100"}
:::
:::card{title="Two warnings"}
The PNG worker is above its latency target. One publication is waiting for approval.
:::
