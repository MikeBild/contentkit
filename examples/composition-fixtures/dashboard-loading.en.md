---
title: Dashboard is being prepared
locale: en
slug: fixture-dashboard-loading
summary: A loading state remains understandable as a static message.
layout: composition
composition: { format: report, canvas: landscape, intent: status, preferredPattern: operations-dashboard }
---
:::dashboard-section{title="Live operations" description="Data retrieval in progress" role="primary" state="loading"}
:::
:::metric{label="Last confirmed state" value="13:00 UTC" status="stale"}
:::
:::card{title="Note"}
The current query is running. ContentKit does not show invented intermediate values.
:::
