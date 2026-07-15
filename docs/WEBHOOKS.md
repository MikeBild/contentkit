# Webhooks

Contentkit notifies external systems about content events through signed
outbound webhooks following the
[Standard Webhooks](https://www.standardwebhooks.com/) specification.
Contentkit never stores the credentials of downstream systems — a receiver
only shares a signing secret with Contentkit.

## Events

| Event type | Cause |
|---|---|
| `contentkit.contact.submitted` | A contact form submission was accepted |
| `contentkit.comment.submitted` | A comment was submitted for moderation |
| `contentkit.comment.approved` | A comment was approved |
| `contentkit.release.failed` | A release or preview build failed |
| `contentkit.content.published` | An item's published revision changed during release activation |
| `contentkit.content.unpublished` | A published item was retired by a release |
| `contentkit.release.published` | A release was activated (including rollbacks and empty releases) |

Every payload contains `event_id`, `type`, `site`, `occurred_at`, `summary`,
`resource` and event-specific `data`.

Content events are enqueued in the same database transaction that switches the
published pointers, and only for real transitions — republishing an already
published revision emits nothing. A `contentkit.content.published` payload:

```json
{
  "event_id": "<uuid>",
  "type": "contentkit.content.published",
  "site": { "id": "<uuid>", "name": "Example" },
  "occurred_at": "2026-07-15T12:00:00.000Z",
  "data": {
    "item_id": "<uuid>",
    "kind": "post",
    "locale": "de",
    "translation_key": "hello-world",
    "slug": "hello-world",
    "title": "Hello World",
    "revision_id": "<uuid>",
    "release_id": "<uuid>"
  },
  "resource": { "kind": "content", "id": "<item uuid>" },
  "summary": "Content published"
}
```

`contentkit.content.unpublished` carries the same `data` shape with
`revision_id` set to the until-now published (retired) revision. Payloads
deliberately contain no absolute URLs — the URL layout belongs to the site
builder, not the CMS.

Boundary: a rollback and a release with empty `revision_ids` move no item
pointers, so they emit no `content.*` events — only
`contentkit.release.published` (with `published_count`/`unpublished_count`
of the activation, `0`/`0` and reason `rollback` for rollbacks).

## Registering endpoints

Register HTTPS endpoints per site with `POST /v1/sites/{site}/webhooks`
(requires `site:admin`). Each endpoint gets its own `whsec_` signing secret,
returned once on creation and on `/rotate`, and an optional `events` filter
(empty means all events). Endpoint URLs are SSRF-validated on registration:
private, loopback, link-local and cloud-metadata targets are rejected.

Alternatively, a single built-in endpoint can be configured through the
environment; it receives all events from all sites:

```bash
CONTENTKIT_WEBHOOK_URL=https://hooks.example.com/contentkit-notifications
CONTENTKIT_WEBHOOK_SECRET=whsec_...
```

## Verifying deliveries

Each delivery carries the Standard Webhooks headers:

- `webhook-id` — unique delivery ID (use it for deduplication)
- `webhook-timestamp` — Unix seconds; reject anything outside a five-minute window
- `webhook-type` — the event type
- `webhook-signature` — `v1,<base64 HMAC-SHA256 of "id.timestamp.body">`

The whole secret string (including the `whsec_` prefix) is the HMAC key,
used verbatim. Example verification in Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(secret, headers, rawBody) {
  const age = Math.abs(Date.now() / 1000 - Number(headers['webhook-timestamp']))
  if (!(age <= 300)) return false
  const expected = `v1,${createHmac('sha256', secret)
    .update(`${headers['webhook-id']}.${headers['webhook-timestamp']}.${rawBody}`)
    .digest('base64')}`
  const given = Buffer.from(headers['webhook-signature'] || '')
  return given.length === Buffer.byteLength(expected) &&
    timingSafeEqual(given, Buffer.from(expected))
}
```

Never accept unsigned deliveries. Respond with a 2xx status once the event is
persisted; any other response triggers a retry.

## Delivery guarantees

Deliveries are queued in a PostgreSQL outbox and retried with exponential
backoff (base 10 s, capped at 30 min, with jitter) up to
`CONTENTKIT_WEBHOOK_MAX_ATTEMPTS` times. An endpoint that keeps failing is
automatically disabled after `CONTENTKIT_WEBHOOK_CIRCUIT_THRESHOLD` exhausted
deliveries; re-enable it with `PATCH /v1/sites/{site}/webhooks/{endpoint}`.
Inspect and replay deliveries with `GET /v1/webhook-deliveries` and
`POST /v1/webhook-deliveries/{delivery}/retry`.

## Scheduled publishing

Contentkit publishes date-scheduled revisions when something calls:

```text
POST /v1/publish-due
Authorization: Bearer <key with release:write>
```

Any external scheduler works — a cron job, a CI schedule or a workflow
engine. A typical setup calls the endpoint every minute:

```bash
* * * * * curl -sf -X POST "$CONTENTKIT_URL/v1/publish-due" \
    -H "Authorization: Bearer $CONTENTKIT_PUBLISH_API_KEY"
```

Contentkit groups due revisions per site and builds one consistent release per
site; a failure for one site never blocks the others. Releases are atomic, but
the endpoint exposes no idempotency header — if your scheduler can retry,
derive an idempotency key in the scheduling layer (for example from the
minute timestamp).
