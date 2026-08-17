import { registerMcpAuthOpenApi } from './oauth/openapi.mjs'

export function openApi(config) {
  const secured = [{ oauth2: [] }, { bearerAuth: [] }, { apiKeyAuth: [] }]
  const siteParameter = { name: 'site', in: 'path', required: true, schema: { type: 'string' } }
  // The engagement and delivery lists are cross-site by nature: without a filter
  // they answer for every site the credential reaches. `site_id` is what narrows
  // one of them to a single site, and it has to be documented — a client that
  // can only learn about it by reading routes.mjs will forget it, and a console
  // list that silently mixes two sites is worse than one that fails.
  const siteFilterParameter = {
    name: 'site_id',
    in: 'query',
    required: false,
    description: 'Restrict the result to one site. Omitted, the result covers every site this credential may reach.',
    schema: { type: 'string', format: 'uuid' },
  }
  const statsParameters = [
    siteParameter,
    {
      name: 'bucket',
      in: 'query',
      schema: { type: 'string', enum: ['hour', 'day', 'month', 'year'], default: 'hour' },
    },
    { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
    { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
    { name: 'tz', in: 'query', schema: { type: 'string', enum: ['UTC'], default: 'UTC' } },
  ]
  const usageStatsParameters = (dimensions) => [
    ...statsParameters,
    {
      name: 'traffic_class',
      in: 'query',
      schema: { type: 'string', enum: ['organic', 'synthetic', 'internal', 'all'], default: 'organic' },
    },
    {
      name: 'group_by',
      in: 'query',
      description: `Comma-separated list of at most two dimensions: ${dimensions.join(', ')}.`,
      schema: { type: 'string' },
    },
  ]
  const jsonBody = (requiredOrSchema = []) => ({
    required: true,
    content: {
      'application/json': {
        schema: Array.isArray(requiredOrSchema) ? { type: 'object', required: requiredOrSchema } : requiredOrSchema,
      },
    },
  })
  // A 2xx that names its schema. A response described in prose only generates
  // no client type, and the client then guesses the shape — which is how the
  // console came to read `delivery.event`, `endpoint.active` and
  // `created.api_key`, three fields the server has never sent.
  const jsonResponse = (description, schema) => ({ description, content: { 'application/json': { schema } } })
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
  const listOf = (name) => ({ type: 'array', items: ref(name) })
  const deletedResponse = (description, extra = {}) =>
    jsonResponse(description, {
      type: 'object',
      required: ['deleted'],
      properties: { deleted: { type: 'boolean' }, ...extra },
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
        'Remote MCP and API clients may instead use the built-in OAuth 2.1 authorization-code',
        'flow with PKCE-S256. Consent is bounded to the scopes the client requested.',
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
        '| `content:read` | Read content/revisions and site-scoped product statistics |',
        '| `content:write` | Upload Markdown/assets and create revisions |',
        '| `deck:render` | Compile trusted deck Markdown with the isolated Slidev renderer |',
        '| `release:preview` | Build isolated, expiring named previews without changing the live site |',
        '| `release:write` | Build previews, publish/activate releases, scheduled publish, unpublish |',
        '| `site:admin` | Update granted sites and manage their API keys/webhooks; only unrestricted principals may create sites |',
        '| `access:admin` | Manage reader users, groups and rules |',
        '| `webhook:admin` | Manage webhook endpoints and deliveries |',
        '| `api-key:admin` | List, create and revoke API keys |',
        '| `identity:admin` | Pre-provision and revoke exact OIDC identity grants |',
        '| `audit:read` | Read redacted append-only audit events |',
        '| `stats:read` | Read privacy-bounded product and MCP usage statistics |',
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
        '`contentkit.content.unpublished`, `contentkit.deck.published` and',
        '`contentkit.release.published` events in the same transaction as the pointer switch.',
      ].join('\n'),
    },
    servers: [{ url: config.publicUrl }],
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          description: 'OAuth 2.1 authorization code with PKCE-S256 for interactive clients.',
          flows: {
            authorizationCode: {
              authorizationUrl: `${config.publicUrl}/v1/oauth/authorize`,
              tokenUrl: `${config.publicUrl}/v1/oauth/token`,
              scopes: {
                'mcp:read': 'Published reads and bounded product statistics',
                'mcp:authoring': 'Drafts, revisions, compositions, decks and previews',
                'mcp:admin': 'Administration bounded by the live identity grant',
              },
            },
          },
        },
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
        ApiKeySummary: {
          type: 'object',
          description: 'An API key without its stored verifier. The raw key exists only in the creation response.',
          required: ['id', 'name', 'key_prefix', 'scopes', 'created_at'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            key_prefix: { type: 'string' },
            scopes: { type: 'array', items: { type: 'string' } },
            site_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
            expires_at: { type: ['string', 'null'], format: 'date-time' },
            revoked_at: { type: ['string', 'null'], format: 'date-time' },
            last_used_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        IdentityGrantSummary: {
          type: 'object',
          description: 'An identity grant without the source credential material.',
          required: ['id', 'provider_id', 'subject', 'product_scopes'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            provider_id: { type: 'string' },
            issuer: { type: ['string', 'null'] },
            subject: { type: 'string' },
            email: { type: ['string', 'null'] },
            display_name: { type: ['string', 'null'] },
            role: { type: ['string', 'null'] },
            grant_source: { type: ['string', 'null'] },
            product_scopes: { type: 'array', items: { type: 'string' } },
            site_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
            revoked_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        AuditEvent: {
          type: 'object',
          description: 'A redacted audit record. Metadata never carries credentials, content or email addresses.',
          required: ['id', 'actor_type', 'action', 'result', 'created_at'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            actor_type: { type: 'string' },
            actor_id: { type: ['string', 'null'] },
            actor_label: { type: ['string', 'null'] },
            action: { type: 'string' },
            resource_type: { type: ['string', 'null'] },
            resource_id: { type: ['string', 'null'] },
            resource_label: { type: ['string', 'null'] },
            site_id: { type: ['string', 'null'], format: 'uuid' },
            site_label: { type: ['string', 'null'] },
            result: { type: 'string' },
            transport: { type: ['string', 'null'] },
            metadata: { type: ['object', 'null'], additionalProperties: true },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
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
        AccessUser: {
          type: 'object',
          required: ['id', 'site_id', 'username', 'display_name', 'active', 'groups'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            username: { type: 'string' },
            display_name: { type: 'string' },
            active: { type: 'boolean' },
            groups: { type: 'array', items: { type: 'string' } },
          },
        },
        AccessGroup: {
          type: 'object',
          required: ['id', 'site_id', 'slug', 'name'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
            name: { type: 'string' },
          },
        },
        AccessRule: {
          type: 'object',
          required: ['id', 'site_id', 'match', 'path', 'group_slugs', 'user_ids'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            match: { enum: ['exact', 'prefix'] },
            path: { type: 'string', pattern: '^/' },
            group_slugs: { type: 'array', items: { type: 'string' } },
            user_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
            rebuild_required: { type: 'boolean' },
          },
        },
        ReadinessReport: {
          type: 'object',
          description: 'Answered with 200 while ready and 503 while draining or initializing — the body is the same.',
          required: ['status', 'version', 'inflight'],
          properties: {
            status: { type: 'string', enum: ['ready', 'draining', 'initializing'] },
            version: { type: 'string' },
            inflight: { type: 'integer', description: 'Release builds currently running.' },
            deck_inflight: { type: 'integer' },
            deck_queued: { type: 'integer' },
          },
        },
        DeckThemeList: {
          type: 'object',
          required: ['themes', 'default'],
          properties: {
            themes: { type: 'array', items: { type: 'string' } },
            default: { type: 'string' },
          },
        },
        DeckTemplateList: {
          type: 'object',
          required: ['schema_version', 'templates', 'ids', 'default', 'registry_sha256'],
          properties: {
            schema_version: { type: 'string' },
            templates: {
              type: 'object',
              additionalProperties: true,
              description: 'Narrative slots, required roles, defaults and visual contract, keyed by template id.',
            },
            ids: { type: 'array', items: { type: 'string' } },
            default: { type: 'string' },
            registry_sha256: { type: 'string' },
          },
        },
        AccessGroupMembers: {
          allOf: [
            { $ref: '#/components/schemas/AccessGroup' },
            {
              type: 'object',
              required: ['user_ids'],
              properties: { user_ids: { type: 'array', items: { type: 'string', format: 'uuid' } } },
            },
          ],
          description: 'A group plus the membership the PUT installed. The list replaces, it never merges.',
        },
        Comment: {
          type: 'object',
          required: ['id', 'site_id', 'content_item_id', 'author_name', 'body', 'status', 'created_at'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            content_item_id: { type: 'string', format: 'uuid' },
            author_name: { type: 'string' },
            author_email: { type: ['string', 'null'] },
            body: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            moderated_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        ContactSubmission: {
          type: 'object',
          required: ['id', 'site_id', 'name', 'email', 'body', 'status', 'created_at'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            email: { type: 'string' },
            body: { type: 'string', description: 'The message itself. There is no `message` field.' },
            status: { type: 'string', enum: ['new', 'read', 'closed'] },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        FeedbackAggregate: {
          type: 'object',
          description: 'Anonymous up/down votes summed per post. There are no individual vote records to read.',
          required: ['content_item_id', 'site_id', 'up', 'down'],
          properties: {
            content_item_id: { type: 'string', format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            up: { type: 'integer' },
            down: { type: 'integer' },
          },
        },
        WebhookEndpoint: {
          type: 'object',
          description:
            'A subscription without its signing secret. Enablement is `disabled_at`: a timestamp means paused, null means live.',
          required: ['id', 'site_id', 'url', 'events', 'description', 'created_at'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            url: { type: 'string', format: 'uri' },
            events: {
              type: 'array',
              items: { type: 'string' },
              description: 'Event filter. Empty means every event.',
            },
            description: { type: 'string' },
            disabled_at: { type: ['string', 'null'], format: 'date-time' },
            consecutive_failures: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        CreatedWebhookEndpoint: {
          allOf: [
            { $ref: '#/components/schemas/WebhookEndpoint' },
            {
              type: 'object',
              required: ['secret'],
              properties: {
                secret: {
                  type: 'string',
                  description: 'The signing secret, in this response and never again. A later GET omits it.',
                },
              },
            },
          ],
        },
        WebhookSecret: {
          type: 'object',
          description: 'The rotated signing secret. It is returned once here and is unreadable afterwards.',
          required: ['id', 'secret'],
          properties: { id: { type: 'string', format: 'uuid' }, secret: { type: 'string' } },
        },
        WebhookDelivery: {
          type: 'object',
          description: 'One attempt ledger row. The event name is `type`; there is no `event` field.',
          required: ['id', 'site_id', 'event_id', 'type', 'status', 'attempts', 'created_at'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            endpoint_id: { type: ['string', 'null'], format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            event_id: { type: 'string', format: 'uuid' },
            type: { type: 'string' },
            payload: { type: 'object', additionalProperties: true },
            status: { type: 'string', enum: ['pending', 'delivered', 'failed'] },
            attempts: { type: 'integer' },
            next_attempt_at: { type: ['string', 'null'], format: 'date-time' },
            last_error: { type: ['string', 'null'] },
            response_status: { type: ['integer', 'null'] },
            delivered_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        Release: {
          type: 'object',
          description:
            'A built, immutable snapshot. A preview is activatable only through guarded promotion with its exact manifest digest and unchanged base publish epoch.',
          required: ['id', 'site_id', 'kind', 'status', 'reason', 'revision_ids', 'file_count', 'created_at'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            kind: { type: 'string', enum: ['release', 'preview'] },
            status: {
              type: 'string',
              enum: ['building', 'preview', 'ready', 'active', 'superseded', 'failed'],
            },
            reason: { type: 'string' },
            revision_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
            retire_item_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
            base_publish_epoch: { type: ['integer', 'null'] },
            manifest_sha256: { type: ['string', 'null'], pattern: '^[0-9a-f]{64}$' },
            storage_prefix: { type: ['string', 'null'] },
            file_count: { type: 'integer' },
            error: { type: ['string', 'null'] },
            completed_at: { type: ['string', 'null'], format: 'date-time' },
            activated_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        ReleaseBuildResult: {
          type: 'object',
          description: 'What a build or an activation answers. It is not a release row.',
          required: ['release_id', 'active'],
          properties: {
            release_id: { type: 'string', format: 'uuid' },
            file_count: { type: 'integer' },
            manifest_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
            active: { type: 'boolean' },
          },
        },
        CreatedApiKey: {
          allOf: [
            { $ref: '#/components/schemas/ApiKeySummary' },
            {
              type: 'object',
              required: ['key'],
              properties: {
                key: {
                  type: 'string',
                  description: 'The raw key, in this response only. ContentKit stores a hash and cannot show it again.',
                },
              },
            },
          ],
        },
        IdentityGrantConflict: {
          type: 'object',
          description:
            'One grant exists per provider/issuer/subject, revoked rows included. `id` names the row to edit or restore.',
          required: ['error'],
          properties: {
            error: { type: 'string', enum: ['identity_grant_exists'] },
            id: { type: ['string', 'null'], format: 'uuid' },
            hint: { type: 'string' },
          },
        },
        RevokedResource: {
          type: 'object',
          required: ['revoked', 'id'],
          properties: { revoked: { type: 'boolean' }, id: { type: 'string', format: 'uuid' } },
        },
        AudioJob: {
          type: 'object',
          required: ['id', 'item_id', 'status', 'attempts', 'created_at'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            item_id: { type: 'string', format: 'uuid' },
            slug: { type: ['string', 'null'] },
            title: { type: ['string', 'null'] },
            status: { type: 'string', enum: ['pending', 'processing', 'done', 'failed', 'skipped'] },
            attempts: { type: 'integer' },
            chars: { type: ['integer', 'null'] },
            error: { type: ['string', 'null'] },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        AudioJobList: {
          type: 'object',
          description: 'The page of jobs plus a `summary`; the budget lives in the summary, not beside it.',
          required: ['jobs', 'summary'],
          properties: {
            jobs: { type: 'array', items: { $ref: '#/components/schemas/AudioJob' } },
            summary: {
              type: 'object',
              additionalProperties: true,
              required: ['chars_this_month', 'monthly_char_budget', 'budget_remaining'],
              properties: {
                pending: { type: 'integer' },
                processing: { type: 'integer' },
                done: { type: 'integer' },
                failed: { type: 'integer' },
                skipped: { type: 'integer' },
                chars_this_month: { type: 'integer' },
                monthly_char_budget: { type: ['integer', 'null'] },
                budget_remaining: { type: ['integer', 'null'] },
              },
            },
          },
        },
        ReportSeriesSetting: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label', 'nav_order', 'lead_cadence'],
          properties: {
            id: {
              type: 'string',
              pattern: '^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$',
              description: 'Stable series ID used in frontmatter and `/{locale}/reports/{id}/`.',
            },
            label: { type: 'string', minLength: 1, maxLength: 120 },
            nav_order: { type: 'integer', description: 'Ascending navigation order.' },
            lead_cadence: {
              type: 'string',
              enum: ['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
            },
          },
        },
        SitePresentationSettings: {
          type: 'object',
          additionalProperties: true,
          properties: {
            preset: {
              type: 'string',
              enum: ['portfolio', 'product-docs', 'wiki', 'knowledge-base', 'product', 'changelog'],
            },
            report_series: {
              type: 'array',
              maxItems: 32,
              items: { $ref: '#/components/schemas/ReportSeriesSetting' },
            },
          },
        },
        SiteSettings: {
          type: 'object',
          additionalProperties: true,
          properties: {
            presentation: { $ref: '#/components/schemas/SitePresentationSettings' },
          },
          description:
            'Site configuration stored as one object. Unknown settings are preserved; builder-owned settings are validated on write.',
        },
        SitePatch: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            base_url: { type: 'string', format: 'uri' },
            default_locale: { type: 'string' },
            domains: { type: 'array', items: { type: 'string' } },
            settings: { $ref: '#/components/schemas/SiteSettings' },
          },
        },
        SiteCreateInput: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'base_url', 'default_locale'],
          description:
            'Everything a site needs in one request: metadata, the initial locale set, the verified hostnames and the settings preset. Sending `locales`, `domains` and `settings` here is the difference between one write and a site that exists without its preset because the second request failed.',
          properties: {
            name: { type: 'string' },
            slug: { type: 'string', description: 'Slugified server-side; derived from `name` when omitted.' },
            description: { type: 'string' },
            base_url: {
              type: 'string',
              format: 'uri',
              description: 'Absolute HTTP(S) URL without credentials; a trailing slash is stripped.',
            },
            default_locale: {
              type: 'string',
              description:
                'IETF language tag such as `de` or `en-us`, case-folded. Always stored as a locale row too — the root redirect and the 404 page target it.',
            },
            locales: {
              type: 'array',
              maxItems: 32,
              items: { type: 'string' },
              description:
                'Additional locales to build, validated and case-folded exactly like `default_locale`, which is always included. At most 32 in total: each one adds a full page tree to every release.',
            },
            domains: {
              type: 'array',
              items: { type: 'string' },
              description: 'Hostnames to map to this site, stored as verified.',
            },
            settings: { $ref: '#/components/schemas/SiteSettings' },
          },
        },
        Site: {
          type: 'object',
          additionalProperties: true,
          required: ['id', 'slug', 'name', 'base_url', 'default_locale', 'settings'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            base_url: { type: 'string', format: 'uri' },
            default_locale: { type: 'string' },
            settings: { $ref: '#/components/schemas/SiteSettings' },
          },
        },
        SiteLocaleInput: {
          type: 'object',
          additionalProperties: false,
          required: ['locale'],
          properties: {
            locale: {
              type: 'string',
              description:
                'IETF language tag such as `de` or `en-us`. Case-folded on write: locale rows are stored lowercase, so `DE` and `de` are the same locale.',
            },
          },
        },
        SiteLocaleRow: {
          type: 'object',
          required: ['locale', 'created_at'],
          properties: {
            locale: { type: 'string', description: 'The stored, lowercased locale.' },
            created_at: { type: ['string', 'null'], format: 'date-time' },
          },
        },
        SiteLocaleList: {
          type: 'object',
          required: ['site_id', 'default_locale', 'locales', 'builds', 'max_locales'],
          description:
            'The site locale set as stored, plus what a release would actually emit. The two differ for a site that carries no locale rows at all: the builder falls back to `default_locale`, so such a site builds exactly one tree that no row records.',
          properties: {
            site_id: { type: 'string', format: 'uuid' },
            default_locale: {
              type: 'string',
              description:
                'The locale `/` redirects to and the fallback 404 page is built from. It can never be removed.',
            },
            locales: {
              type: 'array',
              items: { $ref: '#/components/schemas/SiteLocaleRow' },
              description: 'The stored locale rows, ascending. Empty for a site provisioned without any.',
            },
            builds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'The locales the next release emits a page tree for: the stored rows, or `default_locale` alone when there are none. Content may only be ingested and published into these.',
            },
            max_locales: {
              type: 'integer',
              description: 'The hard cap on locale rows per site — every row multiplies the build matrix.',
            },
          },
        },
        SiteLocale: {
          type: 'object',
          required: ['site_id', 'locale', 'locales', 'rebuild_required'],
          properties: {
            site_id: { type: 'string', format: 'uuid' },
            locale: { type: 'string', description: 'The stored, lowercased locale.' },
            created_at: { type: ['string', 'null'], format: 'date-time' },
            locales: {
              type: 'array',
              items: { type: 'string' },
              description: 'Every locale the site now builds, ascending.',
            },
            rebuild_required: {
              type: 'boolean',
              description: 'Always true: nothing is served under `/<locale>/` until the next release build.',
            },
          },
        },
        SiteLocaleRemoved: {
          type: 'object',
          required: ['deleted', 'site_id', 'locale', 'draft_items', 'locales', 'rebuild_required'],
          properties: {
            deleted: { type: 'boolean' },
            site_id: { type: 'string', format: 'uuid' },
            locale: { type: 'string' },
            draft_items: {
              type: 'integer',
              description:
                'Content items left behind in that locale with no published revision — drafts and items that were unpublished earlier alike. The removal only succeeds when nothing there is published or scheduled, so this is every remaining item. None is deleted, but the builder no longer has a tree to emit them into.',
            },
            locales: {
              type: 'array',
              items: { type: 'string' },
              description: 'Every locale the site still builds, ascending.',
            },
            rebuild_required: { type: 'boolean' },
          },
        },
        ContentItem: {
          type: 'object',
          description:
            'A content item merged with its newest revision. Title, slug, summary and tags live on the revision; latest_revision_id binds those fields to that immutable revision, while published_revision_id separately identifies what is live.',
          required: ['id', 'site_id', 'kind', 'locale', 'translation_key'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            site_id: { type: 'string', format: 'uuid' },
            kind: { type: 'string', enum: ['page', 'post', 'project', 'deck'] },
            locale: { type: 'string' },
            translation_key: { type: 'string' },
            published_revision_id: { type: ['string', 'null'], format: 'uuid' },
            title: { type: ['string', 'null'] },
            slug: { type: ['string', 'null'] },
            summary: { type: ['string', 'null'] },
            tags: { type: ['array', 'null'], items: { type: 'string' } },
            latest_revision_id: { type: ['string', 'null'], format: 'uuid' },
            latest_revision_status: {
              type: ['string', 'null'],
              enum: ['draft', 'scheduled', 'published', 'archived', null],
            },
            latest_revision_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        PublishedEntry: {
          type: 'object',
          required: [
            'item_id',
            'kind',
            'locale',
            'translation_key',
            'slug',
            'title',
            'summary',
            'tags',
            'metadata',
            'report_series',
            'revision_id',
            'published_at',
            'updated_at',
          ],
          properties: {
            item_id: { type: 'string', format: 'uuid' },
            kind: { type: 'string', enum: ['page', 'post', 'project', 'deck'] },
            locale: { type: 'string' },
            translation_key: { type: 'string' },
            slug: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            metadata: {
              type: 'object',
              description: 'Validated revision metadata using snake_case field names.',
              additionalProperties: true,
            },
            report_series: {
              type: ['string', 'null'],
              description:
                'Registered report-series ID authored as frontmatter `reportSeries`; null for legacy/unassigned reports and non-report content.',
            },
            revision_id: { type: 'string', format: 'uuid' },
            revision_sha256: {
              type: 'string',
              pattern: '^[0-9a-f]{64}$',
              description:
                'Immutable source hash exposed by published list entries for privacy-bounded inventory consumers; omitted from single-document responses.',
            },
            published_at: { type: ['string', 'null'], format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        PublishedList: {
          type: 'object',
          required: ['items', 'next_cursor'],
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/PublishedEntry' } },
            next_cursor: { type: ['string', 'null'] },
          },
        },
        PublishedDocument: {
          allOf: [
            { $ref: '#/components/schemas/PublishedEntry' },
            {
              type: 'object',
              required: ['markdown', 'html', 'semantic', 'narrative', 'composition', 'diagnostics', 'accessible_text'],
              properties: {
                markdown: { type: 'string' },
                html: { type: 'string' },
                semantic: { type: ['object', 'null'] },
                narrative: { type: ['object', 'null'] },
                composition: { type: ['object', 'null'] },
                diagnostics: { type: 'array', items: { type: 'object' } },
                accessible_text: { type: ['string', 'null'] },
                representations: { type: ['object', 'null'] },
              },
            },
          ],
        },
        ProductStats: {
          type: 'object',
          required: ['bucket', 'tz', 'from', 'to', 'buckets', 'totals'],
          properties: {
            bucket: { type: 'string', enum: ['hour', 'day', 'month', 'year'] },
            tz: { const: 'UTC' },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            buckets: {
              type: 'array',
              items: {
                type: 'object',
                required: ['ts'],
                properties: { ts: { type: 'string', format: 'date-time' } },
                additionalProperties: { type: 'number' },
              },
            },
            totals: { type: 'object', additionalProperties: { type: 'number' } },
          },
        },
        UsageMetric: {
          type: 'object',
          required: ['value', 'value_state', 'value_kind'],
          properties: {
            value: { type: ['number', 'null'] },
            value_state: {
              type: 'string',
              enum: ['observed', 'zero', 'missing', 'unknown', 'estimated', 'not-applicable'],
            },
            value_kind: {
              type: 'string',
              enum: ['count', 'gauge', 'duration', 'ratio', 'rate', 'percentage', 'data-size', 'tokens', 'currency'],
            },
            numerator: { type: 'number' },
            denominator: { type: 'number' },
          },
          additionalProperties: false,
        },
        UsageStats: {
          type: 'object',
          required: [
            'schema_version',
            'surface',
            'bucket',
            'tz',
            'from',
            'to',
            'traffic_class',
            'group_by',
            'buckets',
            'totals',
            'quality',
          ],
          properties: {
            schema_version: { const: 'contentkit.usage-stats.v1' },
            surface: { enum: ['http', 'compositions', 'mcp'] },
            bucket: { type: 'string', enum: ['hour', 'day', 'month', 'year'] },
            tz: { const: 'UTC' },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            traffic_class: { enum: ['organic', 'synthetic', 'internal', 'all'] },
            group_by: { type: 'array', maxItems: 2, items: { type: 'string' } },
            buckets: {
              type: 'array',
              items: {
                type: 'object',
                required: ['ts', 'dimensions', 'metrics'],
                properties: {
                  ts: { type: 'string', format: 'date-time' },
                  dimensions: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
                  metrics: {
                    type: 'object',
                    additionalProperties: { $ref: '#/components/schemas/UsageMetric' },
                  },
                },
              },
            },
            totals: {
              type: 'array',
              description: 'Full-window aggregates; distinct actors and sessions are recomputed, never summed.',
              items: {
                type: 'object',
                required: ['dimensions', 'metrics'],
                properties: {
                  dimensions: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
                  metrics: {
                    type: 'object',
                    additionalProperties: { $ref: '#/components/schemas/UsageMetric' },
                  },
                },
              },
            },
            quality: {
              type: 'object',
              required: ['sampled', 'unique_count_method', 'actor_scope', 'content_captured'],
              properties: {
                sampled: { const: false },
                unique_count_method: { const: 'exact_window' },
                actor_scope: { const: 'contentkit_site_local_hmac' },
                content_captured: { const: false },
                dropped_events: { type: 'integer', minimum: 0 },
                retention_days: { type: 'integer', minimum: 31 },
              },
            },
          },
        },
        SemanticNode: {
          type: 'object',
          required: ['id', 'type', 'role'],
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'hero',
                'metric',
                'process',
                'comparison',
                'timeline',
                'hierarchy',
                'relationship',
                'chart',
                'progress',
                'badge',
                'card',
                'group',
                'faq',
                'code-example',
                'pricing',
                'gallery',
                'data-table',
                'dashboard-section',
                'application-shell',
                'diagram',
              ],
            },
            role: { type: 'string', enum: ['primary', 'supporting', 'evidence'] },
            value_state: {
              type: 'string',
              enum: ['observed', 'zero', 'missing', 'unknown', 'estimated', 'not-applicable'],
              description: 'Metric evidence state; distinguishes an observed zero from absent or unknown evidence.',
            },
            value_kind: {
              type: 'string',
              enum: ['count', 'gauge', 'duration', 'ratio', 'rate', 'percentage', 'data-size', 'tokens', 'currency'],
            },
            sample_size: { type: ['integer', 'null'], minimum: 0 },
            numerator: { type: ['number', 'null'] },
            denominator: { type: ['number', 'null'], exclusiveMinimum: 0 },
            period_start: { type: ['string', 'null'], format: 'date-time' },
            period_end: { type: ['string', 'null'], format: 'date-time' },
            provenance: { type: ['string', 'null'], maxLength: 160 },
            data_shape: {
              type: 'string',
              enum: [
                'series',
                'range',
                'change',
                'diverging',
                'likert',
                'xy',
                'boxplot',
                'matrix',
                'waterfall',
                'hierarchy',
                'flow',
                'uncertainty',
                'calendar',
                'geo-point',
                'geo-region',
                'samples',
              ],
              description: 'Typed table contract for chart nodes; present as `series` when no shape is authored.',
            },
            narrative: {
              type: 'object',
              description:
                'Instance-level communication intent. Chart nodes expose question, communication_goal, intended_insight, action and limitation. Diagram nodes expose the matching publishing guide, story arc and authored overrides.',
              additionalProperties: true,
            },
            diagram_kind: {
              type: 'string',
              enum: ['process', 'sequence', 'state', 'data-model', 'architecture', 'technical'],
              description: 'Technical diagram story inferred from a Mermaid declaration.',
            },
            publishing_guide: {
              type: 'string',
              description: 'Stable `/v1/publishing-guides/{guide}` identifier for authoring and selection guidance.',
            },
          },
          additionalProperties: true,
        },
        SemanticDocument: {
          type: 'object',
          required: ['schema_version', 'title', 'locale', 'nodes'],
          properties: {
            schema_version: { const: '1' },
            title: { type: 'string' },
            summary: { type: 'string' },
            locale: { type: 'string' },
            presentation: {
              type: 'string',
              enum: ['prose', 'embedded', 'document'],
              description:
                'How the Semantic AST participates in the document: prose has no semantic blocks, embedded augments a normal article or page, and document resolves the complete composition pipeline.',
            },
            nodes: { type: 'array', items: { $ref: '#/components/schemas/SemanticNode' } },
          },
        },
        PatternCandidate: {
          type: 'object',
          required: ['pattern', 'score', 'eligible', 'reasons', 'rejections'],
          properties: {
            pattern: { type: 'string' },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            eligible: { type: 'boolean' },
            reasons: { type: 'array', items: { type: 'string' } },
            rejections: { type: 'array', items: { type: 'string' } },
            responsive_pattern: { type: ['string', 'null'] },
          },
        },
        PatternDescriptor: {
          type: 'object',
          required: [
            'schema_version',
            'id',
            'version',
            'status',
            'category',
            'scope',
            'accepts',
            'narrative',
            'selection',
            'layout',
            'slots',
            'capabilities',
            'rendering_strategy',
            'requires',
            'content_budget',
            'input_contract',
            'examples',
            'spec_examples',
            'agent_hints',
            'static_fallback',
          ],
          properties: {
            schema_version: { const: 1 },
            id: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,63}$' },
            version: { type: 'integer', minimum: 1 },
            status: { type: 'string', enum: ['experimental', 'stable', 'deprecated'] },
            category: {
              type: 'string',
              enum: [
                'document',
                'metrics',
                'stats',
                'process',
                'comparison',
                'timeline',
                'structure',
                'data',
                'faq',
                'code',
                'pricing',
                'gallery',
                'table',
                'dashboard',
                'application',
              ],
            },
            scope: { type: 'string', enum: ['document', 'node'] },
            accepts: {
              type: 'object',
              required: ['node_types', 'data_shapes', 'min_items', 'preferred_max_items', 'max_items'],
              properties: {
                node_types: { type: 'array', items: { type: 'string' } },
                data_shapes: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: [
                      'series',
                      'range',
                      'change',
                      'diverging',
                      'likert',
                      'xy',
                      'boxplot',
                      'matrix',
                      'waterfall',
                      'hierarchy',
                      'flow',
                      'uncertainty',
                      'calendar',
                      'geo-point',
                      'geo-region',
                      'samples',
                    ],
                  },
                  description: 'Empty means any compatible node shape; otherwise agents must match one exactly.',
                },
                min_items: { type: 'integer', minimum: 1 },
                preferred_max_items: { type: 'integer', minimum: 1 },
                max_items: { type: 'integer', minimum: 1 },
              },
            },
            semantics: { type: 'object' },
            narrative: {
              type: 'object',
              required: ['question', 'communication_goal', 'story_arc', 'reader_takeaway', 'decision_support'],
              properties: {
                question: { type: 'string', minLength: 12, maxLength: 500 },
                communication_goal: { type: 'string', minLength: 12, maxLength: 500 },
                story_arc: { type: 'array', minItems: 1, items: { type: 'string' } },
                reader_takeaway: { type: 'string', minLength: 12, maxLength: 500 },
                decision_support: { type: 'string', minLength: 12, maxLength: 500 },
              },
            },
            selection: { type: 'object' },
            responsive: { type: 'array', items: { type: 'object' } },
            fallbacks: { type: 'array', items: { type: 'string' } },
            layout: { type: 'object' },
            accessibility: { type: 'object' },
            slots: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'accepts', 'min', 'max', 'required'],
                properties: {
                  name: { type: 'string' },
                  accepts: { type: 'array', items: { type: 'string' } },
                  min: { type: 'integer', minimum: 0 },
                  max: { type: 'integer', minimum: 1 },
                  required: { type: 'boolean' },
                },
              },
            },
            capabilities: {
              type: 'object',
              required: ['outputs', 'interactions'],
              properties: {
                outputs: { type: 'array', items: { enum: ['html', 'svg', 'png', 'print'] } },
                interactions: { type: 'array', items: { type: 'string' } },
              },
            },
            rendering_strategy: {
              type: 'object',
              required: ['primary_output', 'alternatives', 'html_fidelity', 'png_role', 'rationale'],
              properties: {
                primary_output: { type: 'string', enum: ['html', 'svg'] },
                alternatives: { type: 'array', items: { type: 'string', enum: ['html', 'svg', 'png'] } },
                html_fidelity: { const: 'layout-equivalent' },
                png_role: { const: 'derived-static-export' },
                rationale: { type: 'string' },
              },
            },
            requires: {
              type: 'object',
              required: ['patterns', 'primitives'],
              properties: {
                patterns: { type: 'array', items: { type: 'string' } },
                primitives: { type: 'array', items: { type: 'string' } },
              },
            },
            content_budget: {
              type: 'object',
              required: [
                'max_items',
                'max_text_characters',
                'max_words_per_item',
                'max_code_lines',
                'max_table_rows',
                'max_media',
                'max_columns',
                'max_title_characters',
                'max_summary_characters',
                'max_label_characters',
                'max_body_characters',
                'max_series',
                'max_categories',
              ],
              additionalProperties: { type: 'integer', minimum: 0 },
            },
            input_contract: {
              type: 'object',
              required: ['schema_version', 'value_semantics', 'fields', 'units', 'temporal'],
              properties: {
                schema_version: { const: '1' },
                value_semantics: { type: 'array', items: { type: 'string' } },
                fields: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['field', 'semantic_role', 'accepted_values', 'required'],
                    properties: {
                      field: { type: 'string' },
                      semantic_role: { type: 'string' },
                      accepted_values: { type: 'array', items: { type: 'string' } },
                      required: { type: 'boolean' },
                      max_characters: { type: 'integer', minimum: 1 },
                      max_items: { type: 'integer', minimum: 1 },
                    },
                  },
                },
                units: { type: 'object', additionalProperties: true },
                temporal: { type: 'object', additionalProperties: true },
              },
            },
            examples: { type: 'array', items: { type: 'string' } },
            spec_examples: {
              type: 'array',
              items: {
                type: 'object',
                required: ['kind'],
                properties: {
                  kind: { type: 'string', enum: ['positive', 'counterexample'] },
                  id: { type: 'string' },
                  expected_pattern: { type: 'string' },
                  markdown: { type: 'string' },
                  reason: { type: 'string' },
                  guidance: { type: 'string' },
                },
              },
            },
            agent_hints: {
              type: 'object',
              required: ['use_when', 'reject_when', 'authoring'],
              properties: {
                use_when: { type: 'array', items: { type: 'string' } },
                reject_when: { type: 'array', items: { type: 'string' } },
                authoring: { type: 'array', items: { type: 'string' } },
              },
            },
            static_fallback: { type: ['string', 'null'] },
            documentation: { type: 'string' },
          },
        },
        PublishingGuide: {
          type: 'object',
          required: [
            'schema_version',
            'id',
            'kind',
            'status',
            'title',
            'summary',
            'semantics',
            'narrative',
            'selection',
            'input_contract',
            'authoring',
            'compatible_patterns',
            'examples',
          ],
          properties: {
            schema_version: { const: '1' },
            id: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,63}$' },
            kind: { type: 'string', enum: ['report', 'diagram', 'code'] },
            status: { type: 'string', enum: ['stable', 'experimental'] },
            title: { type: 'string' },
            summary: { type: 'string' },
            semantics: {
              type: 'object',
              required: ['conveys', 'implies', 'rejects'],
              properties: {
                conveys: { type: 'array', items: { type: 'string' } },
                implies: { type: 'array', items: { type: 'string' } },
                rejects: { type: 'array', items: { type: 'string' } },
              },
            },
            narrative: {
              type: 'object',
              required: ['question', 'communication_goal', 'story_arc', 'reader_takeaway'],
              properties: {
                question: { type: 'string' },
                communication_goal: { type: 'string' },
                story_arc: { type: 'array', minItems: 2, items: { type: 'string' } },
                reader_takeaway: { type: 'string' },
              },
            },
            selection: {
              type: 'object',
              required: ['use_when', 'reject_when'],
              properties: {
                use_when: { type: 'array', items: { type: 'string' } },
                reject_when: { type: 'array', items: { type: 'string' } },
              },
            },
            input_contract: {
              type: 'object',
              required: ['required', 'optional', 'constraints'],
              properties: {
                required: { type: 'array', items: { type: 'string' } },
                optional: { type: 'array', items: { type: 'string' } },
                constraints: { type: 'array', items: { type: 'string' } },
              },
            },
            authoring: {
              type: 'object',
              required: ['syntax', 'guidance'],
              properties: {
                syntax: { type: 'string' },
                guidance: { type: 'array', items: { type: 'string' } },
              },
            },
            compatible_patterns: { type: 'array', items: { type: 'string' } },
            examples: { type: 'array', items: { type: 'string' } },
            documentation: { type: 'string' },
            source_path: { type: 'string' },
          },
        },
        CompositionDiagnostic: {
          type: 'object',
          required: ['code', 'severity'],
          properties: {
            code: {
              type: 'string',
              enum: [
                'pattern.unknown',
                'pattern.incompatible',
                'pattern.fallback',
                'text.reflow',
                'text.truncated',
                'items.omitted',
                'content.budget-exceeded',
                'capability.unavailable',
                'pattern.degraded',
                'asset.missing',
                'narrative.evidence-missing',
                'narrative.story-mismatch',
                'semantic.unit-incompatible',
                'content.density-exceeded',
                'container.height-insufficient',
                'rendering.degraded',
                'preview.asset-unresolved',
              ],
            },
            severity: { type: 'string', enum: ['info', 'warning', 'error'] },
            message: { type: 'string' },
            requested_pattern: { type: 'string' },
            resolved_pattern: { type: 'string' },
          },
          additionalProperties: true,
        },
        LayoutTree: {
          type: 'object',
          required: ['schema_version', 'type', 'box', 'children'],
          properties: {
            schema_version: { const: '1' },
            type: { type: 'string' },
            box: { type: 'object' },
            children: { type: 'array', items: { $ref: '#/components/schemas/LayoutPrimitive' } },
            responsive: { type: 'object' },
          },
          additionalProperties: true,
        },
        LayoutPrimitive: {
          type: 'object',
          required: ['type'],
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'layout-region',
                'region',
                'text',
                'shape',
                'image',
                'chart',
                'table',
                'disclosure',
                'connector',
                'connector-group',
              ],
            },
            semantic_type: { type: 'string' },
            role: { type: 'string' },
            box: { type: 'object' },
            source_node_ids: { type: 'array', items: { type: 'string' } },
            style: { type: 'object' },
            from: { type: 'object' },
            to: { type: 'object' },
            children: { type: 'array', items: { $ref: '#/components/schemas/LayoutPrimitive' } },
          },
          additionalProperties: true,
        },
        RenderTree: {
          type: 'object',
          required: ['schema_version', 'type', 'box'],
          properties: {
            schema_version: { const: '1' },
            type: { const: 'svg' },
            box: { type: 'object' },
            children: { type: 'array', items: { $ref: '#/components/schemas/RenderPrimitive' } },
            accessibility: { type: 'object' },
          },
          additionalProperties: true,
        },
        RenderPrimitive: {
          type: 'object',
          required: ['type'],
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'layer',
                'adapter',
                'region',
                'text',
                'shape',
                'image',
                'chart',
                'table',
                'disclosure',
                'connector',
                'connector-group',
              ],
            },
            semantic_type: { type: 'string' },
            role: { type: 'string' },
            box: { type: 'object' },
            source_node_ids: { type: 'array', items: { type: 'string' } },
            style: { type: 'object' },
            from: { type: 'object' },
            to: { type: 'object' },
            children: { type: 'array', items: { $ref: '#/components/schemas/RenderPrimitive' } },
          },
          additionalProperties: true,
        },
        NarrativePlan: {
          type: 'object',
          properties: {
            schema_version: { const: '1' },
            intent: { type: 'string', enum: ['explain', 'compare', 'sequence', 'status', 'explore'] },
            target_audience: { type: ['string', 'null'], maxLength: 240 },
            question: { type: ['string', 'null'], maxLength: 500 },
            communication_goal: { type: ['string', 'null'], maxLength: 500 },
            thesis: { type: ['string', 'null'], maxLength: 500 },
            conclusion: { type: ['string', 'null'], maxLength: 500 },
            action: { type: ['string', 'null'], maxLength: 500 },
            limitations: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 500 } },
            disclosure: { type: 'string', enum: ['overview', 'progressive', 'complete'] },
            story_arc: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 120 } },
          },
          additionalProperties: true,
        },
        CompositionAction: {
          type: 'object',
          anyOf: [{ required: ['markdown'] }, { required: ['semantic'] }],
          properties: {
            markdown: { type: 'string', maxLength: 262144 },
            semantic: { $ref: '#/components/schemas/SemanticDocument' },
            narrative: { $ref: '#/components/schemas/NarrativePlan' },
            pattern: { type: 'string' },
            format: { type: 'string', enum: ['infographic', 'report'] },
            canvas: { type: 'string', enum: ['portrait', 'landscape', 'square', 'flow'] },
            intent: { type: 'string', enum: ['explain', 'compare', 'sequence', 'status', 'explore'] },
            density: { type: 'string', enum: ['compact', 'balanced', 'spacious'] },
            scheme: { type: 'string', enum: ['light', 'dark'] },
            viewport: {
              type: 'object',
              required: ['width', 'height'],
              properties: {
                width: { type: 'integer', minimum: 320, maximum: 4096 },
                height: { type: 'integer', minimum: 320, maximum: 4096 },
              },
            },
            container: {
              type: 'object',
              required: ['width'],
              properties: {
                width: { type: 'integer', minimum: 240, maximum: 4096 },
                height: { type: 'integer', minimum: 240, maximum: 4096 },
              },
              description: 'Actual embedding bounds. Width must not exceed viewport width.',
            },
            capabilities: { type: 'array', maxItems: 16, uniqueItems: true, items: { type: 'string' } },
            outputs: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: { enum: ['model', 'html', 'svg', 'png', 'print'] },
            },
            html_presentation: {
              type: 'string',
              enum: ['semantic', 'visual'],
              default: 'semantic',
              description:
                'Semantic preserves document-native HTML. Visual uses the resolved layout contract while retaining native HTML accessibility.',
            },
          },
        },
        CompositionCompile: {
          allOf: [{ $ref: '#/components/schemas/CompositionAction' }, { type: 'object', required: ['markdown'] }],
        },
        CompositionCompileResult: {
          type: 'object',
          required: [
            'schema_version',
            'semantic',
            'narrative',
            'composition',
            'layout',
            'render_tree',
            'diagnostics',
            'accessible_text',
            'rendering',
            'renders',
            'hashes',
          ],
          properties: {
            schema_version: { const: '1' },
            semantic: { $ref: '#/components/schemas/SemanticDocument' },
            narrative: { type: 'object' },
            composition: { type: 'object' },
            layout: { $ref: '#/components/schemas/LayoutTree' },
            render_tree: { $ref: '#/components/schemas/RenderTree' },
            diagnostics: { type: 'array', items: { $ref: '#/components/schemas/CompositionDiagnostic' } },
            accessible_text: { type: 'string' },
            rendering: {
              type: 'object',
              required: ['html_presentation', 'fidelity', 'canonical_static_output', 'png_role'],
              properties: {
                html_presentation: { type: 'string', enum: ['semantic', 'visual'] },
                fidelity: { type: 'string', enum: ['semantic', 'layout-equivalent'] },
                canonical_static_output: { const: 'svg' },
                png_role: { const: 'derived-static-export' },
              },
            },
            renders: {
              type: 'object',
              properties: {
                html: { type: 'string' },
                print_html: { type: 'string' },
                svg: { type: 'string' },
                png_base64: { type: 'string', contentEncoding: 'base64' },
                png_media_type: { const: 'image/png' },
              },
            },
            hashes: { type: 'object', additionalProperties: { type: 'string' } },
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
      '/': {
        get: {
          operationId: 'serviceDescriptor',
          summary: 'Service descriptor',
          responses: { 200: { description: 'Service descriptor' } },
        },
      },
      '/health': {
        get: {
          operationId: 'healthCheck',
          summary: 'Liveness',
          responses: {
            200: { description: 'OK', content: { 'text/plain': { schema: { type: 'string', const: 'ok' } } } },
          },
        },
      },
      '/ready': {
        get: {
          operationId: 'readinessCheck',
          summary: 'Readiness',
          responses: {
            200: jsonResponse('Ready', ref('ReadinessReport')),
            503: jsonResponse('Draining or still initializing', ref('ReadinessReport')),
          },
        },
      },
      '/metrics': {
        get: {
          operationId: 'prometheusMetrics',
          summary: 'Prometheus metrics',
          responses: { 200: { description: 'Metrics' } },
        },
      },
      '/openapi.json': {
        get: {
          operationId: 'openApiDocument',
          summary: 'OpenAPI 3.1 specification',
          responses: { 200: { description: 'OpenAPI specification' } },
        },
      },
      '/.well-known/service-descriptor.json': {
        get: {
          operationId: 'wellKnownServiceDescriptor',
          summary:
            'Version and a sha256 per self-description artifact — one small GET that tells a watcher whether anything changed, instead of it downloading every document to find out',
          responses: { 200: { description: 'Service descriptor' } },
        },
      },
      '/llms.txt': {
        get: {
          operationId: 'llmsIndex',
          summary: 'LLM documentation index',
          responses: { 200: { description: 'LLM documentation index' } },
        },
      },
      '/llms-full.txt': {
        get: {
          operationId: 'llmsFull',
          summary: 'Full LLM documentation',
          responses: { 200: { description: 'Full LLM documentation' } },
        },
      },
      '/_contentkit/login': {
        get: {
          operationId: 'readerLoginForm',
          summary: 'Show the site reader login form',
          responses: { 200: { description: 'HTML login form with CSRF token' } },
        },
        post: {
          operationId: 'readerLogin',
          summary: 'Create a reader session',
          description:
            'Site-host form endpoint. Accepts username, password, csrf and a same-origin return_to path; sets the HttpOnly reader-session cookie and redirects with 303.',
          responses: {
            303: { description: 'Signed in' },
            401: { description: 'Invalid credentials' },
            403: { description: 'Invalid CSRF token' },
            429: { description: 'Login rate limited' },
          },
        },
      },
      '/_contentkit/logout': {
        post: {
          operationId: 'readerLogout',
          summary: 'Revoke the current reader session',
          responses: { 303: { description: 'Signed out' } },
        },
      },
      '/_contentkit/session': {
        get: {
          operationId: 'readerSession',
          summary: 'Describe the current site reader session',
          responses: { 200: { description: 'Reader and group projection' }, 401: { description: 'Not signed in' } },
        },
      },
      '/_contentkit/navigation.json': {
        get: {
          operationId: 'readerNavigation',
          summary: 'Navigation entries visible to the current reader',
          responses: { 200: { description: 'Authorized release navigation' }, 401: { description: 'Not signed in' } },
        },
      },
      '/_contentkit/search-index.json': {
        get: {
          operationId: 'readerSearchIndex',
          summary: 'Protected search entries visible to the current reader',
          responses: {
            200: { description: 'Authorized release search records' },
            401: { description: 'Not signed in' },
          },
        },
      },
      '/v1/sites': {
        get: {
          operationId: 'siteList',
          summary: 'List the sites this credential may read',
          description:
            'Ordered by name. A credential restricted to specific sites sees only those; an unrestricted one sees every site. Without this a caller cannot discover which sites exist and can only address a slug it already knows.',
          security: secured,
          responses: {
            200: {
              description: 'Sites visible to this credential',
              content: {
                'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Site' } } },
              },
            },
          },
        },
        post: {
          operationId: 'siteCreate',
          summary: 'Create a site (unrestricted site administrator)',
          description:
            'Creates the site row, its locale rows, its hostname mappings and its settings in one request. `slug` is derived from `name` when omitted. `default_locale` and every entry in `locales` must be an IETF language tag content can carry (`de`, `en-us`) — the same validation `POST /v1/sites/{site}/locales` applies, so the two doors cannot disagree; a tag like `Deutsch` is a 422 rather than a locale row no document could ever use. Locales are case-folded and de-duplicated, `default_locale` is always among them, and at most 32 are stored: each one adds a page tree to every release. `settings` is validated exactly as in `PATCH`. Content can only be ingested and published into a locale this site builds, so send the full set here rather than discovering the refusal later.',
          security: secured,
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('SiteCreateInput') } },
          },
          responses: {
            201: {
              description: 'Created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Site' } } },
            },
            403: { description: 'A site-restricted administrator cannot create a global site' },
            422: jsonResponse(
              'A required field is missing, `base_url` is not an absolute HTTP(S) URL, a locale is not an IETF language tag, more than 32 locales were requested, or `settings` failed validation',
              ref('Error'),
            ),
          },
        },
      },
      '/v1/sites/{site}': {
        get: {
          operationId: 'siteGet',
          summary: 'Read site metadata and settings',
          description:
            'Read the site row before a partial update: `PATCH` replaces `settings` wholesale, so send back the full object. The response carries a strong `ETag` over that row; send it back as `If-Match` on the `PATCH` to be told about a concurrent write instead of overwriting it.',
          security: secured,
          parameters: [
            siteParameter,
            {
              name: 'If-None-Match',
              in: 'header',
              required: false,
              description: 'The ETag of a previously read site row.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: {
              description: 'Site',
              headers: {
                ETag: { description: 'Strong validator over the site row.', schema: { type: 'string' } },
              },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Site' } } },
            },
            304: { description: 'The site row is unchanged' },
            404: { description: 'Site not found' },
          },
        },
        patch: {
          operationId: 'siteUpdate',
          summary: 'Update site metadata, settings and domains',
          description:
            'Replaces `settings` in full — read the site first and merge, or unlisted keys are dropped. `domains` follows the same contract: an array replaces every hostname mapping (empty array removes all); omit it to leave the mappings alone. `settings.presentation.preset` accepts `portfolio`, `product-docs`, `wiki`, `knowledge-base`, `product` or `changelog`; product docs require 1–32 unique version IDs, labels up to 120 characters and exactly one current version. Optional `settings.presentation.report_series` is an array of up to 32 unique `ReportSeriesSetting` objects (`id`, `label`, integer `nav_order`, `lead_cadence`). Builder-read settings are validated on write and reject the whole PATCH with 422. Theme tokens accept only the documented allowlist, including `chart_1` through `chart_5` for report SVGs; scalar and `{ light, dark }` values apply to both the page and server-rendered charts. `settings.theme.custom_css` is limited to 8192 bytes without `</style`, and `settings.content.show_extra` must be a boolean. Optional `If-Match` with the ETag from `GET` makes the update conditional: a site written by someone else in the meantime answers 412 instead of dropping their change. `locales` is not part of this body. `default_locale` is validated against the stored locale rows, and the rows themselves are read with `GET /v1/sites/{site}/locales` and changed one at a time through `POST /v1/sites/{site}/locales` and `DELETE /v1/sites/{site}/locales/{locale}`, so each removal is refused on its own grounds — the locale that still has published or scheduled content is named, and the rest of the set is untouched. `POST /v1/sites` does accept the whole list at once, because a site being created has no content to orphan. `default_locale` and the locale rows are one invariant across two tables: this write and the locale writes take the same row lock, so a concurrent `PATCH {default_locale}` and `DELETE .../locales/{locale}` cannot both succeed.',
          security: secured,
          parameters: [
            siteParameter,
            {
              name: 'If-Match',
              in: 'header',
              required: false,
              description: 'The ETag the caller read. `*` matches any existing site.',
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SitePatch' } } },
          },
          responses: {
            200: {
              description: 'Updated',
              headers: {
                ETag: { description: 'Strong validator over the updated site row.', schema: { type: 'string' } },
              },
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Site' } } },
            },
            412: {
              description: 'If-Match did not match: the site changed since it was read',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
        delete: {
          operationId: 'siteDelete',
          summary: 'Delete a site and everything it owns',
          description:
            'Irreversible and total. Deleting a site removes its content items and every immutable revision of them, all releases and previews together with their storage objects, every uploaded and narrated asset, readers, reader groups, access rules and sessions, comments, contact submissions, feedback votes, webhook endpoints and their deliveries, audio jobs, domains and locales. Published pages stop being served at once. Audit events survive with their site reference cleared. A site that still owns content, releases or readers answers 409 and names the counts; `purge=true` is the explicit acknowledgement of those numbers and performs the cascade. API keys and identity grants are not deleted — they keep referring to a site id that no longer exists.',
          security: secured,
          parameters: [
            siteParameter,
            {
              name: 'purge',
              in: 'query',
              required: false,
              description: 'Must be `true` to delete a site that still owns content, releases or readers.',
              schema: { type: 'boolean', default: false },
            },
          ],
          responses: {
            200: {
              description: 'Site and everything it owned deleted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['site_id', 'deleted', 'content_items', 'releases', 'readers', 'removed_objects'],
                    properties: {
                      site_id: { type: 'string', format: 'uuid' },
                      deleted: { type: 'boolean' },
                      content_items: { type: 'integer' },
                      releases: { type: 'integer' },
                      readers: { type: 'integer' },
                      assets: { type: 'integer' },
                      removed_objects: { type: 'integer', description: 'Storage objects deleted.' },
                    },
                  },
                },
              },
            },
            404: { description: 'Site not found' },
            409: {
              description: 'The site is not empty and purge was not requested; the body carries the counts',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['error', 'content_items', 'releases', 'readers'],
                    properties: {
                      error: { type: 'string' },
                      content_items: { type: 'integer' },
                      releases: { type: 'integer' },
                      readers: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/v1/sites/{site}/locales': {
        get: {
          operationId: 'siteLocaleList',
          summary: 'List the locales a site builds (site:admin)',
          description:
            'The locale set is what decides how many page trees a release contains, and the `Site` row does not carry it — this is the read path the two writes below depend on. `locales` are the stored rows; `builds` is what the next release actually emits, which is the stored set or `default_locale` alone when a site carries no rows (the builder falls back to it, so such a site builds exactly one tree that no row records). Content may only be ingested and published into a locale in `builds`. `max_locales` is the hard cap on rows.',
          security: secured,
          parameters: [siteParameter],
          responses: {
            200: jsonResponse('The stored locale rows and the set the next release builds', ref('SiteLocaleList')),
            404: jsonResponse('Site not found', ref('Error')),
          },
        },
        post: {
          operationId: 'siteLocaleAdd',
          summary: 'Add a locale to a site (site:admin)',
          description:
            'Locale rows are the build matrix: the site builder emits one page tree per locale, so a language without a row is one this site can never serve — and content in it is refused on ingest and on publish. `POST /v1/sites` writes the initial rows and `PATCH /v1/sites/{site}` only validates `default_locale` against them — this is the only way to add one afterwards. The locale is case-folded (`DE` and `de` are the same row) and must be an IETF language tag content can carry (`de`, `en-us`). A locale the site already has answers 409, and a site already at `max_locales` (32) answers 422: each row adds a full page tree — home, listings, tags, feeds, 404 — to every release. Live traffic is unaffected until the next release is built, which is what `rebuild_required` reports.',
          security: secured,
          parameters: [siteParameter],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('SiteLocaleInput') } },
          },
          responses: {
            201: jsonResponse('Locale added; `locales` is the full resulting set', ref('SiteLocale')),
            404: jsonResponse('Site not found', ref('Error')),
            409: jsonResponse('The site already has this locale', ref('Error')),
            422: jsonResponse(
              '`locale` is missing, not an IETF language tag such as `de` or `en-us`, or the site already builds the maximum number of locales',
              ref('Error'),
            ),
          },
        },
      },
      '/v1/sites/{site}/locales/{locale}': {
        delete: {
          operationId: 'siteLocaleRemove',
          summary: 'Remove a locale from a site (site:admin)',
          description:
            "Refused with 409 in two cases: the locale is the site's `default_locale` — the root redirect and the fallback 404 page target it, and a site cannot have a default it does not build; point `default_locale` at another locale first, then remove this one — or the locale still carries content the site publishes, in which case the error names both counts: items with a published revision, and items with a revision that is `scheduled` and would be published by the next `POST /v1/publish-due` into a locale the build no longer emits. Unpublish the former and cancel the latter first. Items with neither are left in place and reported as `draft_items`; no content is ever deleted here. Removal does not stop content from re-entering the locale in the past tense — it is the door, not a retroactive sweep: ingest and publish both refuse a locale the site does not build, so nothing new arrives in it afterwards. The locale segment is case-folded, and one the site does not have answers 404.",
          security: secured,
          parameters: [
            siteParameter,
            {
              name: 'locale',
              in: 'path',
              required: true,
              description: 'The site locale to remove, case-insensitive.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            200: jsonResponse('Locale removed; `locales` is the full resulting set', ref('SiteLocaleRemoved')),
            404: jsonResponse('Site not found, or the site does not have this locale', ref('Error')),
            409: jsonResponse(
              'The locale is the site default_locale, or it still has published or scheduled content; the error names both counts',
              ref('Error'),
            ),
          },
        },
      },
      '/v1/sites/{site}/access/users': {
        get: {
          operationId: 'accessUserList',
          summary: 'List site reader accounts',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: jsonResponse('Users without password hashes', listOf('AccessUser')) },
        },
        post: {
          operationId: 'accessUserCreate',
          summary: 'Create a site reader account',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(['username', 'password']),
          responses: { 201: jsonResponse('Reader created; password is never returned', ref('AccessUser')) },
        },
      },
      '/v1/sites/{site}/access/users/{user}': {
        patch: {
          operationId: 'accessUserUpdate',
          summary: 'Update a reader, password, active state or groups',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'user', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody(),
          responses: {
            200: jsonResponse('Updated', ref('AccessUser')),
            404: { description: 'Reader not found' },
          },
        },
        delete: {
          operationId: 'accessUserDelete',
          summary: 'Delete a reader and its sessions',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'user', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: deletedResponse('Deleted'), 404: { description: 'Reader not found' } },
        },
      },
      '/v1/sites/{site}/access/users/{user}/revoke-sessions': {
        post: {
          operationId: 'accessUserRevokeSessions',
          summary: 'Revoke every session for one reader',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'user', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: jsonResponse('Revocation count', {
              type: 'object',
              required: ['revoked'],
              properties: { revoked: { type: 'integer' } },
            }),
          },
        },
      },
      '/v1/sites/{site}/access/groups': {
        get: {
          operationId: 'accessGroupList',
          summary: 'List reader groups',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: jsonResponse('Groups', listOf('AccessGroup')) },
        },
        post: {
          operationId: 'accessGroupCreate',
          summary: 'Create a reader group',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(['slug']),
          responses: { 201: jsonResponse('Group created', ref('AccessGroup')) },
        },
      },
      '/v1/sites/{site}/access/groups/{group}': {
        patch: {
          operationId: 'accessGroupUpdate',
          summary: 'Rename a reader group',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'group', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody(),
          responses: { 200: jsonResponse('Updated', ref('AccessGroup')) },
        },
        delete: {
          operationId: 'accessGroupDelete',
          summary: 'Delete an unreferenced reader group',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'group', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: deletedResponse('Deleted'),
            409: jsonResponse('Group is referenced by a rule', ref('Error')),
          },
        },
      },
      '/v1/sites/{site}/access/groups/{group}/members': {
        put: {
          operationId: 'accessGroupMembersReplace',
          summary: 'Replace a reader group membership list',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'group', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody(['user_ids']),
          responses: { 200: jsonResponse('Membership replaced', ref('AccessGroupMembers')) },
        },
      },
      '/v1/sites/{site}/access/rules': {
        get: {
          operationId: 'accessRuleList',
          summary: 'List draft access rules',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: jsonResponse('Rules', listOf('AccessRule')) },
        },
        post: {
          operationId: 'accessRuleCreate',
          summary: 'Create a draft exact or prefix access rule',
          description: 'The rule becomes live atomically with the next preview/release build.',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(['path']),
          responses: { 201: jsonResponse('Rule created; rebuild_required is true', ref('AccessRule')) },
        },
      },
      '/v1/sites/{site}/access/rules/{rule}': {
        patch: {
          operationId: 'accessRuleUpdate',
          summary: 'Update a draft access rule',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'rule', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody(),
          responses: { 200: jsonResponse('Updated; rebuild_required is true', ref('AccessRule')) },
        },
        delete: {
          operationId: 'accessRuleDelete',
          summary: 'Delete a draft access rule',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'rule', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: deletedResponse('Deleted; rebuild_required is true', { rebuild_required: { type: 'boolean' } }),
          },
        },
      },
      '/v1/sites/{site}/content': {
        get: {
          operationId: 'contentList',
          summary: 'List content items in the authoring workspace',
          description:
            'Newest first. Each item is merged with its newest revision, so `title`, `slug`, `summary` and `tags` are present without a second call; `latest_revision_id` and `latest_revision_status` identify and describe that revision, while `published_revision_id` is what says whether the item is live. Optional `kind` and `locale` filters.',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'kind', in: 'query', schema: { type: 'string', enum: ['page', 'post', 'project', 'deck'] } },
            { name: 'locale', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Content items, newest first, each merged with its newest revision',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/ContentItem' } },
                },
              },
            },
          },
        },
        post: {
          operationId: 'contentCreate',
          summary: 'Create content and its first draft revision',
          description:
            "Frontmatter supports the controlled layouts `standard`, `docs`, `wiki`, `knowledge`, `landing`, `changelog`, `composition` and `deck`; `report` remains a compatibility alias for report compositions. `kind: deck` requires `layout: deck` and accepts bounded `deck.template`, `deck.theme`, `deck.visualScheme`, `deck.maxSlides` and `deck.firstSlide`; selected templates validate explicit per-slide `deckRole` narrative slots before rendering. Semantic directives become SVG/PNG-enhanced self-contained Slidev output at preview/release time. Normal articles and pages may embed selected semantic directives as responsive HTML information islands (`semantic.presentation: embedded`) without turning the entire document into a visual composition or implicitly producing SVG/PNG. Full visual compositions use a versioned Semantic AST plus declarative repository-owned Pattern Packages and render responsive HTML, standalone light/dark SVG and PNG (`semantic.presentation: document`). Documents without semantic directives report `semantic.presentation: prose`. `composition.format` is `infographic` or `report`; reports may use `reportCadence` with `hourly`, `daily`, `weekly`, `monthly`, `quarterly` or `yearly` and may select a configured series with `reportSeries`. `reportSeries` is invalid on non-report compositions; a preview or release rejects IDs absent from `settings.presentation.report_series`. Document narrative fields are `audience`, `question`, `goal`, `thesis`, `conclusion`, `action`, bounded `limitations` and `disclosure`. Semantic directives are `hero`, `metric`, `process`, `comparison`, `timeline`, `hierarchy`, `relationship`, `chart`, `progress`, `badge`, `card`, `group`, `faq`, `question`, `code-example`, `variant`, `pricing`, `plan`, `gallery`, `figure`, `data-table`, `dashboard-section`, `application-shell` and `region`. Authors may request a pattern but cannot provide geometry, CSS, executable code or renderer specifications. Charts remain table-driven: `type` supports `bar`, `line`, `area` and `donut`, while optional `shape` declares a validated information form such as range, change, diverging, Likert, XY, boxplot, matrix, waterfall, hierarchy, flow, uncertainty, calendar, geographic point/region or samples. Optional `question`, `insight`, `action` and `limitation` attributes preserve the chart instance's communication intent. Mermaid fences are classified as process, sequence, state, data-model or architecture evidence and may use the same quoted narrative metadata after the fence language. Hierarchical pages use `docKey`, `docsVersion`, `parent`, `navTitle` and `navOrder`; a document can grant reader groups with `access`. It may also carry an author-owned `extra:` map and `related: [slug, ...]` references. The document's `locale` must be one the site builds (`GET /v1/sites/{site}/locales`, field `builds`): a document in any other locale is refused with 422, because no release emits a page tree for it — the item would be storable, publishable and permanently a 404 on the site.",
          security: secured,
          parameters: [siteParameter],
          requestBody: markdownBody,
          responses: { 201: { description: 'Draft created' } },
        },
      },
      '/v1/composition-patterns': {
        get: {
          operationId: 'compositionPatternList',
          summary: 'List the declarative visual-composition Pattern Registry',
          description:
            'Public machine-readable registry for humans and external AI agents. Filter by category, scope, semantic node type, canvas or stability status. The ETag is the canonical registry SHA-256.',
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'scope', in: 'query', schema: { type: 'string', enum: ['document', 'node'] } },
            { name: 'nodeType', in: 'query', schema: { type: 'string' } },
            {
              name: 'canvas',
              in: 'query',
              schema: { type: 'string', enum: ['portrait', 'landscape', 'square', 'flow'] },
            },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['experimental', 'stable', 'deprecated'] } },
            {
              name: 'capability',
              in: 'query',
              description: 'Required output or progressive interaction capability.',
              schema: { type: 'string' },
            },
          ],
          responses: { 200: { description: 'Pattern Registry' }, 304: { description: 'Registry not modified' } },
        },
      },
      '/v1/composition-patterns/{pattern}': {
        get: {
          operationId: 'compositionPatternGet',
          summary: 'Read one complete declarative Pattern Package',
          parameters: [{ name: 'pattern', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'Pattern descriptor',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PatternDescriptor' } } },
            },
            404: { description: 'Pattern not found' },
          },
        },
      },
      '/v1/publishing-guides': {
        get: {
          operationId: 'publishingGuideList',
          summary: 'List semantic and narrative guidance for reports, diagrams, and code explanations',
          description:
            'Machine-readable selection guidance for authors and AI agents. Each guide states the question it answers, its story arc, required evidence, rejection conditions, compatible information patterns, and examples.',
          parameters: [{ name: 'kind', in: 'query', schema: { type: 'string', enum: ['report', 'diagram', 'code'] } }],
          responses: {
            200: { description: 'Publishing guide registry' },
            304: { description: 'Registry not modified' },
          },
        },
      },
      '/v1/publishing-guides/{guide}': {
        get: {
          operationId: 'publishingGuideGet',
          summary: 'Read one semantic publishing guide',
          parameters: [{ name: 'guide', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'Publishing guide descriptor',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PublishingGuide' } } },
            },
            404: { description: 'Publishing guide not found' },
          },
        },
      },
      '/v1/sites/{site}/render': {
        post: {
          operationId: 'renderMarkdownFragment',
          summary: 'Render a Markdown fragment the way this site publishes it',
          description:
            "Runs the site's own publishing pipeline over arbitrary Markdown and persists nothing. Frontmatter is optional; a fragment without it is rendered leniently, so a missing summary or an unknown key is a diagnostic rather than a rejection. Unlike the composition endpoints this needs only content:read and accepts Markdown that is not a composition — it exists so a reader, an editor preview or an assistant reply can be shown with the same semantics, charts and syntax highlighting a published page gets. `scheme` decides how report charts are emitted: `auto` keeps the prefers-color-scheme picture a published page needs, `light` or `dark` emit a single image for a surface whose theme is chosen explicitly. The strong ETag makes a preview that re-asks on every keystroke cost a comparison rather than a render.",
          security: secured,
          parameters: [siteParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['markdown'],
                  properties: {
                    markdown: { type: 'string', maxLength: 262144 },
                    locale: { type: 'string', description: "Defaults to the site's default locale." },
                    scheme: { type: 'string', enum: ['auto', 'light', 'dark'], default: 'auto' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Rendered fragment with its semantic tree and diagnostics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['html', 'diagnostics', 'has_mermaid', 'chart_count'],
                    properties: {
                      html: { type: 'string', description: 'Sanitized HTML, safe to insert as-is.' },
                      semantic: { anyOf: [{ $ref: '#/components/schemas/SemanticDocument' }, { type: 'null' }] },
                      narrative: { anyOf: [{ $ref: '#/components/schemas/NarrativePlan' }, { type: 'null' }] },
                      composition: { type: ['object', 'null'], additionalProperties: true },
                      diagnostics: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/CompositionDiagnostic' },
                      },
                      accessible_text: { type: ['string', 'null'] },
                      has_mermaid: {
                        type: 'boolean',
                        description: 'The caller must run a Mermaid runtime for the diagrams to appear.',
                      },
                      chart_count: { type: 'integer' },
                    },
                  },
                },
              },
            },
            304: { description: 'The fragment is unchanged for this theme and scheme' },
            413: { description: 'Markdown exceeds 256 KiB' },
            422: { description: 'The Markdown could not be rendered' },
          },
        },
      },
      '/v1/sites/{site}/compositions/recommend': {
        post: {
          operationId: 'compositionRecommend',
          summary: 'Rank eligible patterns deterministically',
          security: secured,
          parameters: [siteParameter],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CompositionAction' } } },
          },
          responses: {
            200: { description: 'Eligible and rejected patterns with stable reason codes' },
            422: { description: 'Invalid Markdown or Semantic AST' },
          },
        },
      },
      '/v1/sites/{site}/compositions/validate': {
        post: {
          operationId: 'compositionValidate',
          summary: 'Validate an external agent pattern choice',
          security: secured,
          parameters: [siteParameter],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CompositionAction' } } },
          },
          responses: {
            200: { description: 'Validity, resolved pattern and diagnostics' },
            422: { description: 'Invalid input' },
          },
        },
      },
      '/v1/sites/{site}/compositions/compile': {
        post: {
          operationId: 'compositionCompile',
          summary: 'Compile composition Markdown without persistence',
          description:
            'Returns versioned Semantic, Narrative, Composition, Layout Tree and Render Tree models plus selected HTML, print HTML, SVG or Base64 PNG outputs. Rendering is deterministic and uses no network resources.',
          security: secured,
          parameters: [siteParameter],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CompositionCompile' } } },
          },
          responses: {
            200: {
              description: 'Compiled models, diagnostics, outputs and hashes',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/CompositionCompileResult' } },
              },
            },
            422: { description: 'Invalid composition, viewport or output' },
          },
        },
      },
      '/v1/deck-themes': {
        get: {
          operationId: 'deckThemeList',
          summary: 'List controlled slide-deck themes',
          responses: {
            200: jsonResponse('Theme identifiers and the default theme', ref('DeckThemeList')),
            304: { description: 'Strong ETag matched' },
          },
        },
      },
      '/v1/deck-templates': {
        get: {
          operationId: 'deckTemplateList',
          summary: 'List controlled slide-deck narrative templates',
          description:
            'Returns machine-readable narrative slots, required roles, defaults and visual contracts for every reusable deck template.',
          responses: {
            200: jsonResponse(
              'Versioned template registry, identifiers, default and registry hash',
              ref('DeckTemplateList'),
            ),
            304: { description: 'Strong ETag matched' },
          },
        },
      },
      '/v1/sites/{site}/decks/plan': {
        post: {
          operationId: 'deckPlan',
          summary: 'Derive a deterministic semantic DeckPlan',
          description:
            'Builds a source-addressed information architecture, narrative and slide plan without an LLM or network access.',
          security: secured,
          parameters: [siteParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['markdown'],
                  properties: { markdown: { type: 'string' }, preferences: { type: 'object' } },
                },
              },
            },
          },
          responses: {
            200: { description: 'Versioned deterministic DeckPlan' },
            422: { description: 'Invalid deck source or preferences' },
          },
        },
      },
      '/v1/sites/{site}/decks/validate': {
        post: {
          operationId: 'deckValidate',
          summary: 'Validate a deterministic semantic DeckPlan',
          security: secured,
          parameters: [siteParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['markdown'],
                  properties: { markdown: { type: 'string' }, preferences: { type: 'object' } },
                },
              },
            },
          },
          responses: {
            200: { description: 'Validity, plan hash and diagnostics' },
            422: { description: 'Invalid deck source' },
          },
        },
      },
      '/v1/sites/{site}/decks/compile': {
        post: {
          operationId: 'deckCompile',
          summary: 'Compile a DeckPlan to self-contained Slidev HTML with SVG and PNG components',
          description:
            'Requires content:write and deck:render. Semantic regions use ContentKit pattern recommendation, validation and deterministic SVG/PNG compilation before the bounded trusted-source Slidev build. Set async=true for a short-lived, process-local job; published deck artifacts remain durable releases.',
          security: secured,
          parameters: [siteParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['markdown'],
                  properties: {
                    markdown: { type: 'string' },
                    preferences: { type: 'object' },
                    async: { type: 'boolean', default: false },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description:
                'DeckPlan, SVG/PNG component representations and hashes, compiled Markdown and self-contained HTML',
            },
            202: { description: 'Async deck job accepted' },
            304: { description: 'Strong ETag matched' },
            422: { description: 'Invalid deck or build failure' },
            503: { description: 'Build queue unavailable' },
            504: { description: 'Build timed out' },
          },
        },
      },
      '/v1/sites/{site}/deck-jobs/{job}': {
        get: {
          operationId: 'deckJobGet',
          summary: 'Read short-lived async deck job status',
          description:
            'Requires content:write and deck:render for the job site. Job metadata contains no source Markdown.',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'job', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Queued, running, done or error status' },
            404: { description: 'Job not found or expired' },
          },
        },
      },
      '/v1/sites/{site}/deck-jobs/{job}/result': {
        get: {
          operationId: 'deckJobResult',
          summary: 'Read a completed async deck result',
          description: 'Returns the same compile result and strong ETag as synchronous compilation.',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'job', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: { description: 'Completed deck compile result' },
            304: { description: 'Strong ETag matched' },
            409: { description: 'Job has not completed' },
            404: { description: 'Job not found or expired' },
          },
        },
      },
      '/v1/sites/{site}/published': {
        get: {
          operationId: 'publishedList',
          summary: 'List published content as JSON (read API)',
          description:
            'Headless read access to everything currently published. Entries carry the item identity, the published revision fields, top-level `report_series` (null for legacy/unassigned content), and the revision `metadata` verbatim — the full frontmatter contract including author-owned `extra` fields. Sorted by `updated_at` descending with keyset pagination: pass `next_cursor` back as `cursor` (opaque). Responds with a weak ETag over the site publish epoch and honours `If-None-Match` with 304.',
          security: secured,
          parameters: [
            siteParameter,
            {
              name: 'kind',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['page', 'post', 'project', 'deck'] },
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
            200: {
              description: 'Published entries and `next_cursor` (null on the last page)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PublishedList' } } },
            },
            304: { description: 'Not modified (If-None-Match matched the publish-epoch ETag)' },
            404: { description: 'Site not found' },
            422: { description: 'Invalid kind, updated_since, limit or cursor' },
          },
        },
      },
      '/v1/sites/{site}/published/{kind}/{locale}/{slug}': {
        get: {
          operationId: 'publishedGet',
          summary: 'Read one published document as JSON (read API)',
          description:
            'The list entry shape plus immutable `markdown`, on-demand `html`, Semantic AST, Narrative Plan, resolved Composition, diagnostics, accessible text and representation links. Deck entries additionally expose their deterministic `deck_plan`, slide count and durable released HTML URL. The strong ETag includes source, service, theme and Pattern Registry versions.',
          security: secured,
          parameters: [
            siteParameter,
            {
              name: 'kind',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['page', 'post', 'project', 'deck'] },
            },
            { name: 'locale', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Published document with markdown and rendered html',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PublishedDocument' } } },
            },
            304: { description: 'Not modified' },
            404: { description: 'Published content not found' },
          },
        },
      },
      '/v1/sites/{site}/published/{kind}/{locale}/{slug}/composition.svg': {
        get: {
          operationId: 'publishedCompositionSvg',
          summary: 'Render a published composition as standalone SVG',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'kind', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'locale', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'scheme', in: 'query', schema: { type: 'string', enum: ['light', 'dark'], default: 'light' } },
          ],
          responses: {
            200: {
              description: 'Standalone accessible SVG',
              content: { 'image/svg+xml': { schema: { type: 'string' } } },
            },
            304: { description: 'Not modified' },
            404: { description: 'Composition not found' },
          },
        },
      },
      '/v1/sites/{site}/published/{kind}/{locale}/{slug}/composition.png': {
        get: {
          operationId: 'publishedCompositionPng',
          summary: 'Render a published composition as PNG',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'kind', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'locale', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'scheme', in: 'query', schema: { type: 'string', enum: ['light', 'dark'], default: 'light' } },
          ],
          responses: {
            200: {
              description: 'PNG image',
              content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
            },
            304: { description: 'Not modified' },
            404: { description: 'Composition not found' },
          },
        },
      },
      '/v1/sites/{site}/search': {
        get: {
          operationId: 'siteSearch',
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
              schema: { type: 'string', enum: ['page', 'post', 'project', 'deck'] },
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
      '/v1/content/{item}': {
        get: {
          operationId: 'contentGet',
          summary: 'Read one content item merged with its newest revision',
          description:
            'The single-item form of the content list, in the same shape: a detail view addresses an item by id and should not have to page the whole workspace to learn its title. The Markdown itself lives on the revisions, not here.',
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: {
              description: 'Content item merged with its newest revision',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ContentItem' } } },
            },
            404: { description: 'Content item not found' },
          },
        },
        delete: {
          operationId: 'contentDeleteDraft',
          summary: 'Discard a draft content item and all of its revisions',
          description:
            'Only for items that were never published. An item with a published revision returns 409: unpublishing is a release operation with its own endpoint, and conflating the two would let one call remove live content together with its whole history.',
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'Draft discarded' },
            404: { description: 'Content item not found' },
            409: { description: 'The item is published; unpublish it first' },
          },
        },
      },
      '/v1/content/{item}/revisions': {
        get: {
          operationId: 'contentRevisionList',
          summary: 'List immutable revisions',
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Revision list' } },
        },
        put: {
          operationId: 'contentRevisionCreate',
          summary: 'Create another immutable revision',
          description:
            'Accepts the same controlled-layout, semantic-composition, semantic-deck, report-cadence, report-series, hierarchy, reader-access, custom-field and related-post frontmatter contract as content creation. Values are validated on write (422 on malformed input) and stored in immutable revision metadata. A revision cannot change `kind`, `locale` or `translationKey`, and its `locale` must still be one the site builds — a locale removed in the meantime makes further revisions a 422 until it is added back.',
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: markdownBody,
          responses: { 201: { description: 'Revision created' } },
        },
      },
      '/v1/content/{item}/published': {
        delete: {
          operationId: 'contentUnpublish',
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
          operationId: 'contentAudioGet',
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
        post: {
          operationId: 'contentAudioCreate',
          summary: 'Narrate one published post',
          description:
            "Enqueues a read-aloud (TTS) job for this item alone — the backfill narrowed to one post, so the site's `settings.audio.enabled` gate (409 otherwise), the monthly character budget and the speech-hash idempotency behave exactly as they do for the archive walk. Only published posts can be narrated: another kind, or an unpublished item, is a 409. `force: true` re-renders even when the speech text is unchanged (e.g. after a voice change), `dry_run: true` prices it without enqueuing. Synthesis happens in the background worker; poll `GET /v1/content/{item}/audio` for the outcome.",
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    force: { type: 'boolean', default: false },
                    dry_run: { type: 'boolean', default: false },
                    limit_chars: { type: 'integer', minimum: 1 },
                  },
                },
              },
            },
          },
          responses: {
            202: {
              description: 'Job enqueued (or the dry-run estimate)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['dry_run', 'jobs', 'total_chars', 'estimated_usd', 'skipped'],
                    properties: {
                      dry_run: { type: 'boolean' },
                      jobs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          required: ['item_id', 'revision_id', 'chars'],
                          properties: {
                            item_id: { type: 'string', format: 'uuid' },
                            revision_id: { type: 'string', format: 'uuid' },
                            title: { type: ['string', 'null'] },
                            chars: { type: 'integer' },
                          },
                        },
                      },
                      total_chars: { type: 'integer' },
                      estimated_usd: { type: 'number' },
                      skipped: { type: 'integer', description: 'Already narrated or without speech text.' },
                      enqueued: { type: 'integer', description: 'Absent on a dry run.' },
                    },
                  },
                },
              },
            },
            404: { description: 'Content item not found' },
            409: { description: 'Not a published post, or audio is not enabled for this site' },
          },
        },
        delete: {
          operationId: 'contentAudioDelete',
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
          operationId: 'audioJobList',
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
            200: jsonResponse('Job list and summary', ref('AudioJobList')),
            404: { description: 'Site not found' },
            422: { description: 'Invalid status filter' },
          },
        },
      },
      '/v1/sites/{site}/audio/jobs/{job}/retry': {
        post: {
          operationId: 'audioJobRetry',
          summary: 'Re-queue one failed or finished audio job',
          description:
            'Resets the job to `pending` with a cleared error and a zeroed attempt counter, keeping its speech hash so every other enqueue path stays idempotent. A job that is already `pending` or `processing` answers 409 — the worker holds it. Retrying a `done` job re-renders it; the existing MP3 stays referenced until the new one is stored, so a live player never 404s.',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'job', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: {
              description: 'Job re-queued',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'item_id', 'status', 'attempts', 'previous_status'],
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      item_id: { type: 'string', format: 'uuid' },
                      status: { type: 'string', enum: ['pending'] },
                      attempts: { type: 'integer' },
                      previous_status: { type: 'string', enum: ['done', 'failed', 'skipped'] },
                    },
                  },
                },
              },
            },
            404: { description: 'Site or audio job not found' },
            409: { description: 'The job is already pending or processing' },
          },
        },
      },
      '/v1/sites/{site}/audio/backfill': {
        post: {
          operationId: 'audioBackfill',
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
          operationId: 'previewCreate',
          summary: 'Build a named, time-limited preview',
          description:
            'Builds an immutable preview and replaces any prior preview with the same slug. The response separates the secret invitation URL from the memorable session-protected preview URL. Opening the invitation creates a path-scoped HttpOnly preview session and redirects immediately. The invitation remains usable until it expires, is revoked or is replaced by a newer preview with the same slug.',
          security: secured,
          parameters: [siteParameter],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['slug'],
                  properties: {
                    slug: {
                      type: 'string',
                      pattern: '^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$',
                      minLength: 3,
                      maxLength: 80,
                      description: 'Memorable preview name. Reusing it atomically replaces the prior preview access.',
                    },
                    revision_ids: { type: 'array', items: { type: 'string', format: 'uuid' }, default: [] },
                    expires_in: { type: 'integer', minimum: 60, maximum: 604800, default: 3600 },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            201: {
              description: 'Named preview built',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: [
                      'release_id',
                      'manifest_sha256',
                      'base_publish_epoch',
                      'revision_ids',
                      'retire_item_ids',
                      'preview_url',
                      'invitation_url',
                      'expires_in',
                    ],
                    properties: {
                      release_id: { type: 'string', format: 'uuid' },
                      manifest_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
                      base_publish_epoch: { type: 'integer' },
                      revision_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                      retire_item_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
                      preview_url: { type: 'string', format: 'uri' },
                      invitation_url: {
                        type: 'string',
                        format: 'uri',
                        description:
                          'Secret expiring URL. It remains reusable until expiry, revocation or replacement; distribute it only to intended reviewers.',
                      },
                      expires_in: { type: 'integer' },
                    },
                  },
                },
              },
            },
            422: { description: 'Invalid or missing preview slug' },
          },
        },
      },
      '/preview-invitations/{token}': {
        get: {
          operationId: 'previewInvitationOpen',
          summary: 'Open a preview invitation',
          description:
            'Sets a path-scoped HttpOnly preview cookie and redirects immediately to the named preview. The invitation is an expiring, revocable bearer capability and may be opened again. An expired, revoked, replaced or unknown invitation returns a human-readable HTML error page.',
          security: [],
          parameters: [
            {
              name: 'token',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Secret invitation value returned once by the preview build endpoint.',
            },
            {
              name: 'return_to',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description:
                'Optional absolute path inside this exact named preview. Invalid, cross-origin or different-preview targets fall back to the preview root.',
            },
          ],
          responses: {
            303: {
              description: 'Preview access established; redirect to the clean preview URL',
              headers: {
                Location: { schema: { type: 'string' } },
                'Set-Cookie': { schema: { type: 'string' } },
              },
            },
            404: {
              description: 'Invitation unavailable; rendered as a browser-friendly HTML page',
              content: { 'text/html': { schema: { type: 'string' } } },
            },
          },
        },
        post: {
          operationId: 'previewInvitationRedeem',
          summary: 'Open a preview invitation using the legacy POST method',
          description:
            'Backward-compatible alias for GET. No confirmation body is required. Sets the same path-scoped HttpOnly preview cookie and redirects to the named preview URL.',
          deprecated: true,
          security: [],
          parameters: [
            {
              name: 'token',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Secret invitation value returned once by the preview build endpoint.',
            },
            {
              name: 'return_to',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description:
                'Optional absolute path inside this exact named preview. Invalid, cross-origin or different-preview targets fall back to the preview root.',
            },
          ],
          responses: {
            303: {
              description: 'Preview access established; redirect to the clean preview URL',
              headers: {
                Location: { schema: { type: 'string' } },
                'Set-Cookie': { schema: { type: 'string' } },
              },
            },
            404: {
              description: 'Invitation unavailable; rendered as a browser-friendly HTML page',
              content: { 'text/html': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/v1/sites/{site}/releases': {
        get: {
          operationId: 'releaseList',
          summary: 'List releases newest first',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: jsonResponse('Release list', listOf('Release')) },
        },
        post: {
          operationId: 'releaseCreate',
          summary: 'Build and atomically activate a release',
          description:
            'Overlays revision_ids on the currently published set and removes retire_item_ids from it; items in neither keep their published revision. Retired items get published_revision_id cleared and their live revision archived. A revision whose item sits in a locale the site does not build is refused with 422: releases emit one page tree per locale, so publishing it would set a published pointer and list the item in `GET /v1/sites/{site}/published` for a page no build emits. Only the revisions this release publishes are checked — content published before a locale went away keeps its pointer and does not block future releases.',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(),
          responses: { 201: jsonResponse('Release active', ref('ReleaseBuildResult')) },
        },
      },
      '/v1/sites/{site}/releases/{release}': {
        delete: {
          operationId: 'releaseDelete',
          summary: 'Delete a built release or preview ahead of the retention sweep',
          description:
            'Removes the release row and its storage objects, and with it every row that pointed at the release: its file entries, its reader-access catalog and any named preview access, whose links stop working immediately. The published content itself is untouched — a release is a rendered snapshot, not the source. The site’s active release answers 409: the live site is served out of its objects, so activate another release first. Deleting a release that is still inside the rollback window simply removes that rollback target.',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'release', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: {
              description: 'Release deleted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['release_id', 'deleted', 'removed_objects'],
                    properties: {
                      release_id: { type: 'string', format: 'uuid' },
                      deleted: { type: 'boolean' },
                      removed_objects: { type: 'integer' },
                    },
                  },
                },
              },
            },
            404: { description: 'Site or release not found' },
            409: { description: 'The release is active' },
          },
        },
      },
      '/v1/sites/{site}/releases/{release}/activate': {
        post: {
          operationId: 'releaseActivate',
          summary: 'Activate a prior release',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'release', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: jsonResponse('Release active', ref('ReleaseBuildResult')) },
        },
      },
      '/v1/sites/{site}/releases/{release}/promote': {
        post: {
          operationId: 'releasePromotePreview',
          summary: 'Activate the exact reviewed preview without rebuilding it',
          description:
            'Promotes an immutable preview only when manifest_sha256 matches and the site publish epoch is unchanged since the preview build. The operation fails closed on digest or epoch drift and currently refuses deck pointer changes.',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'release', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody({
            type: 'object',
            required: ['manifest_sha256'],
            properties: { manifest_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
            additionalProperties: false,
          }),
          responses: {
            200: jsonResponse('Exact preview promoted and active', ref('ReleaseBuildResult')),
            404: { description: 'Preview not found or not promotable' },
            409: { description: 'Manifest mismatch or publish epoch drift' },
            422: { description: 'Invalid digest or unsupported deck pointer change' },
          },
        },
      },
      '/v1/publish-due': {
        post: {
          operationId: 'publishDue',
          summary: 'Publish scheduled revisions grouped by site',
          description:
            'Publishes every `scheduled` revision whose `scheduled_at` has passed, grouped into one release per site; for one item the latest due revision wins and the earlier ones are archived. Each site is reported separately, with `error` instead of a release when its build was refused — a revision in a locale the site no longer builds is refused here rather than published into a page tree that does not exist, which is also why removing a locale with scheduled content answers 409.',
          security: secured,
          responses: { 200: { description: 'Publish results, one entry per site: a release or an error' } },
        },
      },
      '/v1/maintenance/storage-gc': {
        post: {
          operationId: 'maintenanceStorageGc',
          summary: 'Garbage-collect old release objects and reap stuck builds',
          description:
            'Cron-triggered lifecycle sweep. Deletes storage objects and rows for releases past the retention window that are not active, within the rollback keep-window, or referenced by live named preview access; the retention window only protects a release while it is among the newest CONTENTKIT_RELEASE_MAX_PER_SITE rows of its site. Storage objects shared with surviving releases (upload dedup) are kept until their last referencing release goes. Also reaps builds stuck in building. A release whose object deletion fails keeps its row and is counted in deferred_releases for the next sweep to retry, so a transient storage error cannot strand objects. Requires an unrestricted release:write key.',
          security: secured,
          responses: { 200: { description: 'Sweep counts' }, 403: { description: 'Requires an unrestricted key' } },
        },
      },
      '/public/v1/contact': {
        post: {
          operationId: 'publicContactSubmit',
          summary: 'Submit a contact request',
          responses: { 201: { description: 'Accepted' } },
        },
      },
      '/public/v1/posts/{post}/comments': {
        post: {
          operationId: 'publicCommentSubmit',
          summary: 'Submit a guest comment for moderation',
          responses: { 201: { description: 'Accepted' } },
        },
      },
      '/public/v1/posts/{post}/feedback': {
        post: {
          operationId: 'publicFeedbackSubmit',
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
          operationId: 'commentList',
          summary: 'List the moderation queue',
          security: secured,
          parameters: [
            siteFilterParameter,
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            },
          ],
          responses: { 200: jsonResponse('Comment list', listOf('Comment')) },
        },
      },
      '/v1/comments/{comment}': {
        patch: {
          operationId: 'commentModerate',
          summary: 'Approve or reject a comment',
          security: secured,
          parameters: [{ name: 'comment', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: jsonBody(['status']),
          responses: { 200: jsonResponse('Moderated', ref('Comment')) },
        },
        delete: {
          operationId: 'commentDelete',
          summary: 'Delete a comment for good',
          description:
            'Removes the row; rejecting instead keeps it for the record. An approved comment is rendered into the published pages, so deleting one also builds and activates a release without it — best-effort, exactly like approval: a failed build leaves the comment deleted and reports `republish_error`. `publish=false` skips that build when many comments are deleted in a row; the next release removes them all.',
          security: secured,
          parameters: [
            { name: 'comment', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            {
              name: 'publish',
              in: 'query',
              required: false,
              description: 'Set to `false` to leave the live site to the next release.',
              schema: { type: 'boolean', default: true },
            },
          ],
          responses: {
            200: {
              description: 'Comment deleted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'deleted'],
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      deleted: { type: 'boolean' },
                      release: {
                        type: ['object', 'null'],
                        additionalProperties: true,
                        description: 'The republish result, null when nothing was rebuilt.',
                      },
                      republish_error: { type: 'string' },
                    },
                  },
                },
              },
            },
            404: { description: 'Comment not found' },
          },
        },
      },
      '/v1/contact-submissions': {
        get: {
          operationId: 'contactSubmissionList',
          summary: 'List contact submissions',
          security: secured,
          parameters: [siteFilterParameter],
          responses: { 200: jsonResponse('Submission list', listOf('ContactSubmission')) },
        },
      },
      '/v1/contact-submissions/{id}': {
        patch: {
          operationId: 'contactSubmissionUpdate',
          summary: 'Move a contact submission between new, read and closed',
          description:
            'Triage is not one-way: `new` is accepted as well, so a submission marked read or closed by mistake goes back to the inbox.',
          security: secured,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['status'],
                  properties: { status: { type: 'string', enum: ['new', 'read', 'closed'] } },
                },
              },
            },
          },
          responses: {
            200: jsonResponse('Updated', ref('ContactSubmission')),
            404: { description: 'Contact submission not found' },
            422: { description: 'status must be new, read or closed' },
          },
        },
        delete: {
          operationId: 'contactSubmissionDelete',
          summary: 'Delete a contact submission',
          description:
            'Removes the message, the name and the email address the sender left. Closing keeps the record instead; this is the erasure path, and it is irreversible.',
          security: secured,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: {
              description: 'Submission deleted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id', 'deleted'],
                    properties: { id: { type: 'string', format: 'uuid' }, deleted: { type: 'boolean' } },
                  },
                },
              },
            },
            404: { description: 'Contact submission not found' },
          },
        },
      },
      '/v1/feedback': {
        get: {
          operationId: 'feedbackList',
          summary: 'Per-post feedback aggregates (up/down counts)',
          description: 'Sorted by total votes, descending.',
          security: secured,
          parameters: [
            siteFilterParameter,
            {
              name: 'post',
              in: 'query',
              required: false,
              description: 'Restrict the result to one content item.',
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: { 200: jsonResponse('Aggregated votes per post', listOf('FeedbackAggregate')) },
        },
      },
      '/v1/feedback/{item}': {
        delete: {
          operationId: 'feedbackReset',
          summary: 'Reset the feedback counter of one post',
          description:
            'Deletes every up/down vote stored for the content item, which sets its counter back to zero. Votes are anonymous rows with no moderation state, so there is nothing to keep — this is for a brigaded post or one that was rewritten past the point where its old score describes it. Published pages never render the totals, so no rebuild follows.',
          security: secured,
          parameters: [{ name: 'item', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: {
              description: 'Votes deleted',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['content_item_id', 'deleted_votes'],
                    properties: {
                      content_item_id: { type: 'string', format: 'uuid' },
                      deleted_votes: { type: 'integer' },
                    },
                  },
                },
              },
            },
            404: { description: 'Content item not found' },
          },
        },
      },
      '/v1/api-keys': {
        get: {
          operationId: 'apiKeyList',
          summary: 'List API keys without hashes or secrets',
          security: secured,
          responses: {
            200: {
              description: 'API keys visible to this credential, wrapped in an `api_keys` array',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['api_keys'],
                    properties: { api_keys: { type: 'array', items: { $ref: '#/components/schemas/ApiKeySummary' } } },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'apiKeyCreate',
          summary: 'Create a scoped API key',
          security: secured,
          requestBody: jsonBody(['name', 'scopes']),
          responses: { 201: jsonResponse('Created; raw key returned once', ref('CreatedApiKey')) },
        },
      },
      '/v1/api-keys/{id}': {
        delete: {
          operationId: 'apiKeyRevoke',
          summary: 'Revoke an API key',
          security: secured,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: jsonResponse('Revoked', ref('RevokedResource')),
            404: { description: 'Not found' },
          },
        },
      },
      '/v1/identity-grants': {
        get: {
          operationId: 'identityGrantList',
          summary: 'List OAuth identity grants',
          description:
            'Optional exact-match filters: provider_id, subject. Each grant carries its product_scopes ceiling (the only stored truth), the denormalized display role and grant_source (admin, seed, signup or api-key).',
          security: secured,
          parameters: [
            { name: 'provider_id', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'subject', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: {
            200: {
              description: 'Identity grants, wrapped in an `identities` array',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['identities'],
                    properties: {
                      identities: { type: 'array', items: { $ref: '#/components/schemas/IdentityGrantSummary' } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: 'identityGrantCreate',
          summary: 'Pre-provision an OAuth identity grant',
          description:
            'provider_id and issuer must exactly match a configured external identity provider. A grant binds the immutable provider subject to a product-scope ceiling and optional sites. Exactly one of role or product_scopes is required: a named role (reader, author, admin) is a shorthand the server expands into the scope ceiling once; the stored truth is always product_scopes. source may only carry the value seed (seeder marking); everything else is stamped admin.',
          security: secured,
          requestBody: jsonBody(['provider_id', 'issuer', 'subject']),
          responses: {
            201: jsonResponse('Identity grant created', ref('IdentityGrantSummary')),
            409: jsonResponse(
              'A grant for this provider_id + issuer + subject already exists (revoked grants included). The body carries the existing grant id and a hint to PATCH /v1/identity-grants/{id} (with restore:true when the existing grant is revoked).',
              ref('IdentityGrantConflict'),
            ),
            422: { description: 'Invalid provider, role/product_scopes conflict or unsupported scope' },
          },
        },
      },
      '/v1/identity-grants/{id}': {
        patch: {
          operationId: 'identityGrantUpdate',
          summary: 'Update an OAuth identity grant ceiling',
          description:
            'Accepts email, display_name, site_ids and exactly one of role or product_scopes (role expands to a complete scope replacement). restore:true is the only way to clear revoked_at on a revoked grant; a PATCH without restore matches non-revoked grants only. A PATCH without source:"seed" stamps grant_source=admin, taking the row over from the seeder.',
          security: secured,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: jsonBody(),
          responses: {
            200: jsonResponse('Updated', ref('IdentityGrantSummary')),
            404: { description: 'Not found' },
          },
        },
        delete: {
          operationId: 'identityGrantRevoke',
          summary: 'Revoke an OAuth identity grant and active sessions/access/refresh tokens',
          security: secured,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: jsonResponse('Revoked', ref('RevokedResource')),
            404: { description: 'Not found' },
          },
        },
      },
      '/v1/audit-events': {
        get: {
          operationId: 'auditEventList',
          summary: 'Read redacted append-only audit events',
          description:
            'Optional site, action and limit filters. Audit metadata excludes credentials, content, Markdown, request bodies and email addresses.',
          security: secured,
          parameters: [
            {
              name: 'site',
              in: 'query',
              required: false,
              description: 'Site slug or id. Undocumented until now, so every client filtered client-side instead.',
              schema: { type: 'string' },
            },
            { name: 'action', in: 'query', required: false, schema: { type: 'string' } },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
            },
          ],
          responses: {
            200: {
              description: 'Audit events, wrapped in an `events` array',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['events'],
                    properties: { events: { type: 'array', items: { $ref: '#/components/schemas/AuditEvent' } } },
                  },
                },
              },
            },
            404: { description: 'Site not found' },
          },
        },
      },
      '/v1/assistant/messages': {
        post: {
          operationId: 'assistantMessages',
          summary: 'Stream one authoring-assistant turn',
          description:
            "Present only when the API key of the provider named by CONTENTKIT_LLM_PROVIDER (anthropic, openai or google) is configured; otherwise every method answers 404. Streams an AI SDK UI message stream. The assistant calls ContentKit's own MCP tools, filtered by the caller's scopes, so it can never exceed what the credential already permits. Publication, activation, deletion and credential changes emit a `data-elicitation` part and block until a human answers at /v1/assistant/elicitations/{elicitation}; decline, expiry or a dropped connection makes no change.",
          security: secured,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['messages'],
                  properties: {
                    messages: { type: 'array', items: { type: 'object' }, description: 'UI messages so far.' },
                    site: { type: 'string', description: 'Site slug or UUID the operator is working on.' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'UI message stream', content: { 'text/event-stream': {} } },
            404: { description: 'The assistant is not enabled on this deployment' },
          },
        },
      },
      '/v1/assistant/elicitations/{elicitation}': {
        post: {
          operationId: 'assistantElicitationDecide',
          summary: 'Record the human decision on a pending confirmation',
          description:
            "The operator's answer to an approval card. Only `accept` with `content.confirmed = true` lets the waiting tool call proceed; `decline` and `cancel` leave the system unchanged. A decision that matches no waiting elicitation returns 409 — it expired or its turn was abandoned — and must never be reported as success.",
          security: secured,
          parameters: [{ name: 'elicitation', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['action'],
                  properties: {
                    action: { type: 'string', enum: ['accept', 'decline', 'cancel'] },
                    content: { type: 'object', description: 'Answers to the requested schema when accepting.' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Decision recorded' },
            409: { description: 'No such pending elicitation' },
            422: { description: 'Unknown action' },
          },
        },
      },
      '/v1/sites/{site}/webhooks': {
        get: {
          operationId: 'webhookList',
          summary: 'List webhook endpoints',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: jsonResponse('Endpoint list (no secrets)', listOf('WebhookEndpoint')) },
        },
        post: {
          operationId: 'webhookCreate',
          summary: 'Register a webhook endpoint',
          description:
            'Creates a signed delivery endpoint. `events` filters by type (empty = all) and is validated against the types contentkit emits — an entry that matches none of them is a 422 rather than an endpoint that never fires. An entry may be a full type, the un-prefixed form (`comment.approved`) or a bare suffix (`published`). A whsec_ secret is returned once. Delivery uses Standard Webhooks headers (webhook-id/-timestamp/-signature).',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(['url']),
          responses: {
            201: jsonResponse('Endpoint created; secret returned once', ref('CreatedWebhookEndpoint')),
            422: { description: 'Invalid or private (SSRF-blocked) url, or an unknown event type' },
          },
        },
      },
      '/v1/sites/{site}/webhooks/{endpoint}': {
        patch: {
          operationId: 'webhookUpdate',
          summary: 'Update or enable/disable a webhook endpoint',
          description: 'A supplied `events` filter is validated against the emitted types, as on creation.',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'endpoint', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody(),
          responses: {
            200: jsonResponse('Updated', ref('WebhookEndpoint')),
            404: { description: 'Not found' },
            422: { description: 'Invalid url or an unknown event type' },
          },
        },
        delete: {
          operationId: 'webhookDelete',
          summary: 'Delete a webhook endpoint',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'endpoint', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: deletedResponse('Deleted'), 404: { description: 'Not found' } },
        },
      },
      '/v1/sites/{site}/webhooks/{endpoint}/rotate': {
        post: {
          operationId: 'webhookRotateSecret',
          summary: 'Rotate a webhook endpoint signing secret',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'endpoint', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            200: jsonResponse('New secret returned once', ref('WebhookSecret')),
            404: { description: 'Not found' },
          },
        },
      },
      '/v1/webhook-deliveries': {
        get: {
          operationId: 'webhookDeliveryList',
          summary: 'List webhook deliveries for observability',
          security: secured,
          parameters: [
            siteFilterParameter,
            {
              name: 'endpoint',
              in: 'query',
              required: false,
              description: 'Restrict the result to one webhook endpoint.',
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['pending', 'delivered', 'failed'] },
            },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50, maximum: 200 } },
          ],
          responses: { 200: jsonResponse('Delivery list', listOf('WebhookDelivery')) },
        },
      },
      '/v1/webhook-deliveries/{delivery}/retry': {
        post: {
          operationId: 'webhookDeliveryRetry',
          summary: 'Manually redeliver a webhook',
          security: secured,
          parameters: [{ name: 'delivery', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: jsonResponse('Delivery re-queued', ref('WebhookDelivery')),
            404: { description: 'Not found' },
          },
        },
      },
    },
  }
  const stats = {
    releases: 'release builds, activation, output size and build duration',
    content: 'content items, revisions, publications and assets',
    decks: 'deterministic planning, rendering, cache, SVG/PNG components, duration and output bytes',
    readers: 'privacy-safe reader authentication outcomes and sessions',
    webhooks: 'outbox events and webhook delivery outcomes',
    audio: 'read-aloud jobs, characters and generated duration',
    engagement: 'comments, contact submissions and anonymous feedback',
    http: 'canonical HTTP routes, methods, outcomes, transfer sizes, latency and exact local HMAC actors/sessions',
    compositions:
      'semantic recommend/validate/compile operations, requested versus resolved patterns, fallbacks, diagnostics and latency',
    mcp: 'MCP sessions, transports, resources, prompts and scope-filtered tool calls without prompts, arguments or result content',
  }
  for (const [kind, description] of Object.entries(stats)) {
    spec.paths[`/v1/sites/{site}/stats/${kind}`] = {
      get: {
        operationId: `stats${kind[0].toUpperCase()}${kind.slice(1)}`,
        summary: `Read site ${kind} statistics`,
        description: `Bounded UTC aggregates for ${description}. Requires stats:read or the backwards-compatible content:read scope and never returns content, identities, credentials, payloads, raw URLs, query strings, network identifiers or row identifiers. Defaults to the previous 24 hours in hourly buckets.${['http', 'compositions', 'mcp'].includes(kind) ? ' Usage telemetry is opt-in. Organic traffic is the default; synthetic and internal traffic remain explicitly filterable. Ratio metrics carry numerator and denominator, unavailable evidence is missing rather than zero, and full-window unique actors/sessions are recomputed exactly.' : ''}`,
        security: secured,
        parameters: ['http', 'compositions', 'mcp'].includes(kind)
          ? usageStatsParameters(
              kind === 'http'
                ? ['route', 'method', 'outcome', 'status_class', 'traffic_class', 'request_source']
                : kind === 'compositions'
                  ? [
                      'operation',
                      'outcome',
                      'requested_pattern',
                      'resolved_pattern',
                      'fallback',
                      'traffic_class',
                      'request_source',
                    ]
                  : ['operation', 'tool_name', 'outcome', 'response_mode', 'traffic_class'],
            )
          : statsParameters,
        responses: {
          200: {
            description: 'Dense, site-scoped aggregate time series',
            content: {
              'application/json': {
                schema: {
                  $ref: ['http', 'compositions', 'mcp'].includes(kind)
                    ? '#/components/schemas/UsageStats'
                    : '#/components/schemas/ProductStats',
                },
              },
            },
          },
          404: { description: 'Site not found' },
          422: { description: 'Invalid or excessive time window' },
        },
      },
    }
  }
  registerMcpAuthOpenApi(spec)
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
