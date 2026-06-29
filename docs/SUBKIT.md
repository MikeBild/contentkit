# Subkit integration

Contentkit uses Subkit for governed scheduling and notifications. Contentkit
never stores the target notification credential.

## Connector

Create a bearer-auth HTTP connector for
`https://contentkit-api.mikebild.dev` and discover
`/openapi.json`. Give its Contentkit API key only these scopes:

```text
content:read content:write release:write moderation:write
```

## Scheduled publishing workflow

Create and approve a workflow named `contentkit-publish-due`:

- Trigger: `schedule`, cron `* * * * *`, timezone `Europe/Berlin`.
- One request step: `POST /v1/publish-due` through the Contentkit connector.
- Mark the step as a write and use a minute-derived idempotency key.

Contentkit groups due revisions per site and builds one consistent release.

## Notification workflow

Create a generic HTTP connector for the final notification endpoint, including
its credential. Then create and approve a request-triggered workflow named
`contentkit-notify` with this input contract:

```json
{
  "type": "object",
  "required": ["id", "timestamp", "type", "body"],
  "properties": {
    "id": {"type": "string"},
    "timestamp": {"type": "number"},
    "type": {"type": "string"},
    "body": {"type": "object"}
  }
}
```

The workflow:

1. accepts only `contentkit.contact.submitted`,
   `contentkit.comment.submitted`, `contentkit.comment.approved` and
   `contentkit.release.failed`;
2. validates `input.body.event_id`, `site`, `summary` and `resource`;
3. posts the normalized body to the target connector;
4. uses `input.body.event_id` as the request idempotency key.

Bind the committed workflow through authenticated Subkit binding CRUD rather
than an insecure `verify: none` trigger:

```bash
curl -X POST https://subkit-api.mikebild.dev/v1/webhooks/inbound \
  -H "Authorization: Bearer $SUBKIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug":"contentkit-notifications",
    "workflow_id":"<contentkit-notify-workflow-id>",
    "verifier":"standard",
    "secret":"<same value as CONTENTKIT_SUBKIT_WEBHOOK_SECRET>",
    "native_verifier_config":{
      "events":[
        "contentkit.contact.submitted",
        "contentkit.comment.submitted",
        "contentkit.comment.approved",
        "contentkit.release.failed"
      ]
    },
    "active":true
  }'
```

Subkit checks the five-minute timestamp window and HMAC signature, deduplicates
`webhook-id`, queues one execution and audits the downstream delivery.

## Provisioning order

The workflows cannot be committed safely before the Contentkit management
endpoint resolves and its scoped API credential exists:

1. bootstrap and deploy Contentkit;
2. create the scoped Contentkit API key;
3. author and commit `contentkit-publish-due`, including its schedule;
4. choose the concrete notification connector and credential;
5. author and commit `contentkit-notify`;
6. create the signed inbound binding and verify one test event end to end.

Never substitute a placeholder credential or downgrade the inbound verifier to
`none` merely to make provisioning pass.
