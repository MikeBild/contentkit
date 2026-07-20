# Product analytics API

ContentKit exposes bounded, site-scoped aggregates from its own PostgreSQL
database. These endpoints are a generic product capability: ContentKit does
not know about a reporting cockpit, a workflow engine or a central report
store. A collector can call the API with an existing site-scoped
`content:read` key.

## Endpoints

All endpoints are `GET /v1/sites/{site}/stats/{kind}`:

| Kind | Measures |
|---|---|
| `releases` | builds started/completed/failed/activated, release vs preview builds, files, bytes and build duration |
| `content` | items, revisions, publications, assets and asset bytes |
| `decks` | plans, validations, sync/async compiles, previews, releases, outcomes, cache results, slides, SVG/PNG components, duration and output bytes |
| `readers` | successful, failed and rate-limited authentication attempts plus sessions created |
| `webhooks` | outbox events, deliveries and their current outcome |
| `audio` | jobs and current outcome, synthesized characters and audio duration |
| `engagement` | comments, contact submissions and anonymous up/down feedback |

Common query parameters are `bucket=hour|day|month|year`, RFC 3339 `from` and
`to`, and `tz=UTC`. The default is the previous 24 hours in hourly buckets.
UTC-only bucketing makes repeated collection deterministic across daylight
saving changes. Windows are capped at 31 days for hourly, 366 days for daily,
five years for monthly and ten years for yearly requests. Invalid or excessive
windows return 422.

```bash
curl "$CONTENTKIT_URL/v1/sites/$SITE/stats/content?bucket=hour&from=2026-07-18T10:00:00Z&to=2026-07-18T12:00:00Z" \
  -H "Authorization: Bearer $CONTENTKIT_READ_KEY"
```

The response is a dense series; empty buckets contain zeros. `from` is
inclusive and `to` exclusive.

```json
{
  "bucket": "hour",
  "tz": "UTC",
  "from": "2026-07-18T10:00:00.000Z",
  "to": "2026-07-18T12:00:00.000Z",
  "buckets": [
    { "ts": "2026-07-18T10:00:00.000Z", "items_created": 2 },
    { "ts": "2026-07-18T11:00:00.000Z", "items_created": 0 }
  ],
  "totals": { "items_created": 2 }
}
```

## Privacy and operations

Responses never contain Markdown, reader identities, API keys, webhook
endpoints or payloads, storage paths, row identifiers or error details. The
reader-auth fact table itself stores only site, one of
`success|failed|rate_limited`, and timestamp; it never stores username, IP,
session ID or failure detail. These events are removed by the existing
maintenance run after `CONTENTKIT_PRODUCT_STATS_RETENTION_DAYS` (400 by
default).

Deck build facts follow the same retention. They contain only site, operation,
sync/async execution, outcome, cache result and bounded numeric counters. They
never store source Markdown, a deck title or URL, a job ID, an API key or an
author/reader identity.

The API continues an incoming W3C `traceparent`, returns the server span in a
`traceparent` response header and emits `trace_id`, `span_id` and
`parent_span_id` in structured request logs. Logs also carry
`service.name=contentkit`, the service version and
`deployment.environment.name`, configured by
`CONTENTKIT_DEPLOYMENT_ENVIRONMENT`.

External acquisition, campaign, SEO and revenue data do not belong in this
API. Collect those systems from their own APIs and join them downstream using
explicit dimensions and time windows. For hourly collection, use a fixed
`[from,to)` window and idempotently replace or content-address the resulting
snapshot; do not infer deltas by subtracting two partially overlapping calls.
