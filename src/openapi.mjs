export function openApi(config) {
  const secured = [{ bearerAuth: [] }, { apiKeyAuth: [] }]
  const siteParameter = { name: 'site', in: 'path', required: true, schema: { type: 'string' } }
  const jsonBody = (required = []) => ({
    required: true,
    content: { 'application/json': { schema: { type: 'object', required } } },
  })
  const markdownBody = {
    required: true,
    content: {
      'text/markdown': { schema: { type: 'string' } },
      'multipart/form-data': {
        schema: { type: 'object', properties: { document: { type: 'string', format: 'binary' } } },
      },
    },
  }
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Contentkit API',
      version: config.version,
      description: [
        'API-first Markdown CMS publishing immutable multilingual static-site releases.',
        '',
        '## Authentication',
        '',
        'Management endpoints accept a scoped API key as either `Authorization: Bearer <key>`',
        'or `X-API-Key: <key>`. Keys look like `ck_<43-char base64url>` and the raw value is',
        'returned only once, by `POST /v1/api-keys` (and never listed or recoverable again).',
        'Keys are stored as `HMAC-SHA256(key = CONTENTKIT_KEY_PEPPER, message = raw key)` in hex;',
        'only a short `key_prefix` (the first 11 characters, e.g. `ck_A1b2C3d4`) is kept in clear',
        'for identification.',
        '',
        '### 401 vs 403 — these mean different things',
        '',
        '- **401 `{"error":"unauthorized"}`** — the key was missing, malformed, revoked, expired,',
        '  or its HMAC hash did not match any stored key. The credential itself was not accepted.',
        '  A `WWW-Authenticate: Bearer` header is returned. Do **not** re-scope the key; check that',
        "  you sent the exact raw key and that the server's `CONTENTKIT_KEY_PEPPER` matches the one",
        '  in force when the key was created.',
        '- **403 `{"error":"insufficient_scope","scope":"<required>","site":"<site-id>"}`** — the key',
        '  is valid and recognized, but lacks the scope (or the per-site grant) that the endpoint',
        '  requires. The `scope` field names the scope you need; `site` appears when the check was',
        '  site-scoped. Fix by using a key that carries that scope for that site.',
        '',
        '### Scopes',
        '',
        '| Scope | Grants |',
        '|---|---|',
        '| `content:read` | List content items and immutable revisions |',
        '| `content:write` | Upload Markdown/assets and create revisions |',
        '| `release:write` | Build previews, publish/activate releases, scheduled publish, unpublish |',
        '| `site:admin` | Create/update sites, manage API keys and webhook endpoints |',
        '| `moderation:write` | List/moderate comments and contact submissions |',
        '| `*` | Global wildcard; held only by the bootstrap key, never grantable via `/v1/api-keys` |',
        '',
        'A key may also be restricted to specific `site_ids`. An empty `site_ids` is global for the',
        "key's scopes; a non-empty list authorizes only those sites (a mismatch yields 403).",
        '',
        '## Webhooks',
        '',
        '`POST /v1/sites/{site}/webhooks` registers a delivery endpoint and returns a `whsec_<base64url>`',
        'signing secret **once** (also on `/rotate`); it is encrypted at rest and never listed again.',
        'Deliveries are signed with Standard Webhooks headers: `webhook-id` (unique per delivery — dedupe',
        'on it), `webhook-timestamp` (unix seconds), `webhook-type`, and',
        '`webhook-signature: v1,<base64 HMAC-SHA256 of "{webhook-id}.{webhook-timestamp}.{raw-body}">`.',
        'Consumers verify by recomputing that HMAC with the endpoint secret and comparing in constant time.',
        'Note: the HMAC key is the **entire secret string including the `whsec_` prefix**, used as raw UTF-8',
        'bytes — do not strip `whsec_` or base64-decode it (this differs from the reference Standard',
        'Webhooks libraries). Also reject deliveries whose timestamp is outside your tolerance window.',
      ].join('\n'),
    },
    servers: [{ url: config.publicUrl }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Scoped API key as `Authorization: Bearer ck_...`. Bad/missing/revoked keys return 401; valid keys missing the required scope return 403.',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Scoped API key sent as `X-API-Key: ck_...` (alternative to the bearer header).',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
            request_id: { type: 'string' },
            scope: { type: 'string', description: 'On 403 insufficient_scope: the scope the endpoint requires.' },
            site: { type: 'string', description: 'On a site-scoped 403: the site the check was performed against.' },
          },
        },
      },
      responses: {
        Unauthorized: {
          description:
            'Missing, malformed, revoked, expired or unrecognized key (hash mismatch). The credential itself was not accepted.',
          headers: { 'WWW-Authenticate': { schema: { type: 'string' }, description: 'Always `Bearer`.' } },
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'unauthorized' } },
          },
        },
        Forbidden: {
          description: 'The key is valid but lacks the required scope or per-site grant.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                error: 'insufficient_scope',
                scope: 'site:admin',
                site: '00000000-0000-0000-0000-000000000000',
              },
            },
          },
        },
      },
    },
    paths: {
      '/': { get: { summary: 'Service descriptor', responses: { 200: { description: 'Service descriptor' } } } },
      '/health': { get: { summary: 'Liveness', responses: { 200: { description: 'OK' } } } },
      '/ready': {
        get: { summary: 'Readiness', responses: { 200: { description: 'Ready' }, 503: { description: 'Draining' } } },
      },
      '/metrics': { get: { summary: 'Prometheus metrics', responses: { 200: { description: 'Metrics' } } } },
      '/openapi.json': {
        get: { summary: 'OpenAPI 3.1 specification', responses: { 200: { description: 'OpenAPI specification' } } },
      },
      '/llms.txt': {
        get: { summary: 'LLM documentation index', responses: { 200: { description: 'LLM documentation index' } } },
      },
      '/llms-full.txt': {
        get: { summary: 'Full LLM documentation', responses: { 200: { description: 'Full LLM documentation' } } },
      },
      '/v1/sites': {
        post: {
          summary: 'Create a site',
          security: secured,
          requestBody: jsonBody(['name', 'base_url', 'default_locale']),
          responses: { 201: { description: 'Created' } },
        },
      },
      '/v1/sites/{site}': {
        get: {
          summary: 'Read site metadata and settings',
          description:
            'Read the site row before a partial update: `PATCH` replaces `settings` wholesale, so send back the full object.',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: { description: 'Site' }, 404: { description: 'Site not found' } },
        },
        patch: {
          summary: 'Update site metadata and settings',
          description: 'Replaces `settings` in full — read the site first and merge, or unlisted keys are dropped.',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(),
          responses: { 200: { description: 'Updated' } },
        },
      },
      '/v1/sites/{site}/content': {
        get: {
          summary: 'List content',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: { description: 'Content list' } },
        },
        post: {
          summary: 'Create content and its first draft revision',
          security: secured,
          parameters: [siteParameter],
          requestBody: markdownBody,
          responses: { 201: { description: 'Draft created' } },
        },
      },
      '/v1/content/{item}/revisions': {
        get: {
          summary: 'List immutable revisions',
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Revision list' } },
        },
        put: {
          summary: 'Create another immutable revision',
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: markdownBody,
          responses: { 201: { description: 'Revision created' } },
        },
      },
      '/v1/content/{item}/published': {
        delete: {
          summary: 'Unpublish a content item from the live site',
          description:
            'Builds and activates a release without the item: its published revision is archived, published_revision_id is cleared and the item drops out of future snapshots. Reversible by publishing one of its revisions again.',
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Item unpublished; new release active' },
            409: { description: 'Item is not published' },
          },
        },
      },
      '/v1/content/{item}/audio': {
        get: {
          summary: 'Read-aloud audio status for a content item',
          description:
            'Returns the newest read-aloud (TTS) job for the item — status pending/processing/done/failed/skipped, or `none` when no job exists — plus the stable `/media/<asset-id>/<filename>` URL and duration once the MP3 is done.',
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Audio job status and asset URL' },
            404: { description: 'Content item not found' },
          },
        },
      },
      '/v1/sites/{site}/audio/backfill': {
        post: {
          summary: 'Enqueue read-aloud audio jobs for published posts',
          description:
            'Walks the published posts newest-first and enqueues a TTS job for every post whose extracted speech text has no job yet, until the character budget is spent (`limit_chars`, falling back to `settings.audio.monthly_char_budget`, else unlimited). `dry_run: true` returns the selected posts, their character total and a cost estimate without enqueuing anything. Requires `settings.audio.enabled` (409 otherwise). Site audio settings: `settings.audio = { enabled, provider, voice, monthly_char_budget }`.',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(),
          responses: {
            200: { description: 'Enqueued jobs (or the dry-run estimate)' },
            409: { description: 'Audio is not enabled for this site' },
          },
        },
      },
      '/v1/sites/{site}/previews': {
        post: {
          summary: 'Build a time-limited preview',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(),
          responses: { 201: { description: 'Preview built' } },
        },
      },
      '/v1/sites/{site}/releases': {
        get: {
          summary: 'List releases newest first',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: { description: 'Release list' } },
        },
        post: {
          summary: 'Build and atomically activate a release',
          description:
            'Overlays revision_ids on the currently published set and removes retire_item_ids from it; items in neither keep their published revision. Retired items get published_revision_id cleared and their live revision archived.',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(),
          responses: { 201: { description: 'Release active' } },
        },
      },
      '/v1/sites/{site}/releases/{release}/activate': {
        post: {
          summary: 'Activate a prior release',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'release', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'Release active' } },
        },
      },
      '/v1/publish-due': {
        post: {
          summary: 'Publish scheduled revisions grouped by site',
          security: secured,
          responses: { 200: { description: 'Publish results' } },
        },
      },
      '/v1/maintenance/storage-gc': {
        post: {
          summary: 'Garbage-collect old release objects and reap stuck builds',
          description:
            'Cron-triggered lifecycle sweep. Deletes storage objects and rows for releases past the retention window that are not active, within the rollback keep-window, or referenced by a live preview token; reaps builds stuck in building. Requires an unrestricted release:write key.',
          security: secured,
          responses: { 200: { description: 'Sweep counts' }, 403: { description: 'Requires an unrestricted key' } },
        },
      },
      '/public/v1/contact': {
        post: { summary: 'Submit a contact request', responses: { 201: { description: 'Accepted' } } },
      },
      '/public/v1/posts/{post}/comments': {
        post: { summary: 'Submit a guest comment for moderation', responses: { 201: { description: 'Accepted' } } },
      },
      '/v1/comments': {
        get: {
          summary: 'List the moderation queue',
          security: secured,
          responses: { 200: { description: 'Comment list' } },
        },
      },
      '/v1/comments/{comment}': {
        patch: {
          summary: 'Approve or reject a comment',
          security: secured,
          parameters: [{ name: 'comment', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: jsonBody(['status']),
          responses: { 200: { description: 'Moderated' } },
        },
      },
      '/v1/contact-submissions': {
        get: {
          summary: 'List contact submissions',
          security: secured,
          responses: { 200: { description: 'Submission list' } },
        },
      },
      '/v1/contact-submissions/{id}': {
        patch: {
          summary: 'Mark a contact submission read or closed',
          security: secured,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: jsonBody(['status']),
          responses: { 200: { description: 'Updated' } },
        },
      },
      '/v1/api-keys': {
        post: {
          summary: 'Create a scoped API key',
          security: secured,
          requestBody: jsonBody(['name', 'scopes']),
          responses: { 201: { description: 'Created; raw key returned once' } },
        },
      },
      '/v1/sites/{site}/webhooks': {
        get: {
          summary: 'List webhook endpoints',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: { description: 'Endpoint list (no secrets)' } },
        },
        post: {
          summary: 'Register a webhook endpoint',
          description:
            'Creates a signed delivery endpoint. events filters by type (empty = all); a whsec_ secret is returned once. Delivery uses Standard Webhooks headers (webhook-id/-timestamp/-signature).',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(['url']),
          responses: {
            201: { description: 'Endpoint created; secret returned once' },
            422: { description: 'Invalid or private (SSRF-blocked) url' },
          },
        },
      },
      '/v1/sites/{site}/webhooks/{endpoint}': {
        patch: {
          summary: 'Update or enable/disable a webhook endpoint',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'endpoint', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody(),
          responses: { 200: { description: 'Updated' }, 404: { description: 'Not found' } },
        },
        delete: {
          summary: 'Delete a webhook endpoint',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'endpoint', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'Deleted' }, 404: { description: 'Not found' } },
        },
      },
      '/v1/sites/{site}/webhooks/{endpoint}/rotate': {
        post: {
          summary: 'Rotate a webhook endpoint signing secret',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'endpoint', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'New secret returned once' }, 404: { description: 'Not found' } },
        },
      },
      '/v1/webhook-deliveries': {
        get: {
          summary: 'List webhook deliveries for observability',
          security: secured,
          responses: { 200: { description: 'Delivery list' } },
        },
      },
      '/v1/webhook-deliveries/{delivery}/retry': {
        post: {
          summary: 'Manually redeliver a webhook',
          security: secured,
          parameters: [{ name: 'delivery', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Delivery re-queued' }, 404: { description: 'Not found' } },
        },
      },
    },
  }
  // Every secured operation shares the same auth failure modes: 401 when the key
  // is not accepted and 403 when it is valid but under-scoped. Attach both without
  // clobbering any operation-specific override (e.g. storage-gc's tailored 403).
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item)) {
      if (!operation || !operation.security) continue
      operation.responses ??= {}
      operation.responses['401'] ??= { $ref: '#/components/responses/Unauthorized' }
      operation.responses['403'] ??= { $ref: '#/components/responses/Forbidden' }
    }
  }
  return spec
}
