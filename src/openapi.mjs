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
        'Release activation additionally emits `contentkit.content.published`,',
        '`contentkit.content.unpublished` and `contentkit.release.published` events in the same',
        'transaction as the pointer switch.',
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
          summary: 'Update site metadata, settings and domains',
          description:
            'Replaces `settings` in full — read the site first and merge, or unlisted keys are dropped. `domains` follows the same contract: an array replaces every hostname mapping (empty array removes all); omit it to leave the mappings alone. Builder-read settings are validated on write and reject the whole PATCH with 422: `settings.theme.tokens` accepts only the allowlisted design tokens (`background`, `foreground`, `muted`, `muted_foreground`, `border`, `primary`, `primary_foreground`, `radius`, `font_family`; values are strings or `{ light, dark }` string pairs of at most 256 bytes each without `<`, `settings.accent` stays the shorthand for `primary`), `settings.theme.custom_css` must be a string of at most 8192 bytes without `</style`, and `settings.content.show_extra` must be a boolean.',
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
          description:
            'Frontmatter may carry an author-owned `extra:` map of custom fields (max 32 keys matching `[a-z][a-z0-9_]{0,63}`; values are scalars, lists of scalars or flat maps of scalars; 16 KiB total) stored verbatim in the revision metadata, and `related: [slug, ...]` references to same-locale posts (max 8, no duplicates or self-reference) that lead the related-posts block at build time. Malformed values fail with 422.',
          security: secured,
          parameters: [siteParameter],
          requestBody: markdownBody,
          responses: { 201: { description: 'Draft created' } },
        },
      },
      '/v1/sites/{site}/published': {
        get: {
          summary: 'List published content as JSON (read API)',
          description:
            'Headless read access to everything currently published. Entries carry the item identity, the published revision fields and the revision `metadata` verbatim — the full frontmatter contract including author-owned `extra` fields. Sorted by `updated_at` descending with keyset pagination: pass `next_cursor` back as `cursor` (opaque). Responds with a weak ETag over the site publish epoch and honours `If-None-Match` with 304.',
          security: secured,
          parameters: [
            siteParameter,
            {
              name: 'kind',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['page', 'post', 'project'] },
            },
            { name: 'locale', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'tag', in: 'query', required: false, description: 'Exact tag match.', schema: { type: 'string' } },
            {
              name: 'updated_since',
              in: 'query',
              required: false,
              description: 'ISO 8601 timestamp; returns entries whose `updated_at` is strictly greater.',
              schema: { type: 'string', format: 'date-time' },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Page size (default 50; values above 200 are clamped).',
              schema: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
            },
            {
              name: 'cursor',
              in: 'query',
              required: false,
              description: 'Opaque keyset cursor from a previous response’s `next_cursor`.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: { description: 'Published entries and `next_cursor` (null on the last page)' },
            304: { description: 'Not modified (If-None-Match matched the publish-epoch ETag)' },
            404: { description: 'Site not found' },
            422: { description: 'Invalid kind, updated_since, limit or cursor' },
          },
        },
      },
      '/v1/sites/{site}/published/{kind}/{locale}/{slug}': {
        get: {
          summary: 'Read one published document as JSON (read API)',
          description:
            'The list entry shape plus `markdown` (the immutable revision source verbatim) and `html` (rendered on demand — HTML is never stored). Responds with a strong ETag over the revision source hash and the service version; honours `If-None-Match` with 304. Unknown, unpublished or mismatched kind/locale/slug is a 404.',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'kind', in: 'path', required: true, schema: { type: 'string', enum: ['page', 'post', 'project'] } },
            { name: 'locale', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: { description: 'Published document with markdown and rendered html' },
            304: { description: 'Not modified' },
            404: { description: 'Published content not found' },
          },
        },
      },
      '/v1/sites/{site}/search': {
        get: {
          summary: 'Full-text search over published content (read API)',
          description:
            'PostgreSQL full-text search across everything currently published: title, summary and tags weigh highest, body text lowest; drafts and archived revisions are invisible by construction. Results carry a relevance `rank` and a `headline` snippet with `<mark>` highlights. Locale-aware stemming (de → german, en → english, otherwise simple) — without `locale` the query is stemmed with `simple` against locale-stemmed vectors, so cross-locale search is best-effort while a locale-scoped query matches exactly. Responses are uncached (no ETag): they depend on the query text, not on a stored artifact. Published sites keep their static client-side search; this route is an API-host feature for headless consumers.',
          security: secured,
          parameters: [
            siteParameter,
            {
              name: 'q',
              in: 'query',
              required: true,
              description: 'Search terms (websearch syntax; trimmed, 1–200 characters).',
              schema: { type: 'string', minLength: 1, maxLength: 200 },
            },
            { name: 'locale', in: 'query', required: false, schema: { type: 'string' } },
            {
              name: 'kind',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['page', 'post', 'project'] },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Maximum results (default 20; values above 100 are clamped).',
              schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
            },
          ],
          responses: {
            200: { description: 'Ranked results with `<mark>` headlines' },
            404: { description: 'Site not found' },
            422: { description: 'Missing/overlong q, invalid kind or limit' },
          },
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
          description:
            'Accepts the same frontmatter contract as content creation, including the author-owned `extra:` custom-field map and `related: [slug, ...]` post references — both validated on write (422 on malformed values) and stored verbatim in the revision metadata.',
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
        delete: {
          summary: 'Delete read-aloud audio for a content item',
          description:
            'Removes every audio job for the item and every generated MP3 those jobs referenced (storage object and asset row), then schedules a debounced auto-rebuild — unless `settings.audio.auto_rebuild` is `false` — so the player and blogcast entry disappear from the live site. Returns `{item_id, deleted_jobs, deleted_assets, rebuild_scheduled}`. Re-enable narration afterwards with the backfill endpoint.',
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Audio jobs and assets deleted' },
            404: { description: 'Content item not found' },
          },
        },
      },
      '/v1/sites/{site}/audio/jobs': {
        get: {
          summary: 'List read-aloud audio jobs with a monthly budget summary',
          description:
            'Newest-first list of the site’s TTS jobs (id, item_id, slug, title, status, attempts, chars, error, timestamps) plus a `summary` with per-status counters, `chars_this_month` (characters of all non-skipped jobs created in the current UTC calendar month), `monthly_char_budget` from `settings.audio` and `budget_remaining`. An invalid `status` value is a 422.',
          security: secured,
          parameters: [
            siteParameter,
            {
              name: 'status',
              in: 'query',
              required: false,
              description: 'Filter by job status.',
              schema: { type: 'string', enum: ['pending', 'processing', 'done', 'failed', 'skipped'] },
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              description: 'Maximum jobs returned (default 100, capped at 500).',
              schema: { type: 'integer', default: 100, minimum: 1, maximum: 500 },
            },
          ],
          responses: {
            200: { description: 'Job list and summary' },
            404: { description: 'Site not found' },
            422: { description: 'Invalid status filter' },
          },
        },
      },
      '/v1/sites/{site}/audio/backfill': {
        post: {
          summary: 'Enqueue read-aloud audio jobs for published posts',
          description:
            'Walks the published posts newest-first and enqueues a TTS job for every post whose extracted speech text has no job yet, until the character budget is spent (`limit_chars`, falling back to `settings.audio.monthly_char_budget`, else unlimited). `dry_run: true` returns the selected posts, their character total and a cost estimate without enqueuing anything. An optional `slugs` array narrows the backfill to specific posts. `force: true` re-renders even when the speech text is unchanged (e.g. after a voice change) by resetting the existing job. Requires `settings.audio.enabled` (409 otherwise). Site audio settings: `settings.audio = { enabled, provider, voice, monthly_char_budget, auto_rebuild, blogcast_link, blogcast_image, blogcast_category }` (the deprecated `podcast_*` spellings are still read as fallbacks).',
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
      '/public/v1/posts/{post}/feedback': {
        post: {
          summary: 'Submit a one-click post feedback vote (up or down)',
          description:
            'Anonymous by design: the body carries only site_id and vote, no reader data is stored. Requires settings.feedback.enabled: true on the site; guarded by the honeypot and per-IP rate limit instead of a captcha.',
          responses: {
            201: { description: 'Accepted' },
            404: { description: 'Feedback disabled, or post not found' },
            422: { description: 'vote must be up or down' },
          },
        },
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
      '/v1/feedback': {
        get: {
          summary: 'Per-post feedback aggregates (up/down counts)',
          description: 'Optional query filters: site_id, post (content item id). Sorted by total votes, descending.',
          security: secured,
          responses: { 200: { description: 'Aggregated votes per post' } },
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
