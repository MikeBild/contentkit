import { registerMcpAuthOpenApi } from './oauth/openapi.mjs'

export function openApi(config) {
  const secured = [{ oauth2: [] }, { bearerAuth: [] }, { apiKeyAuth: [] }]
  const siteParameter = { name: 'site', in: 'path', required: true, schema: { type: 'string' } }
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
      '/_contentkit/login': {
        get: {
          summary: 'Show the site reader login form',
          responses: { 200: { description: 'HTML login form with CSRF token' } },
        },
        post: {
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
        post: { summary: 'Revoke the current reader session', responses: { 303: { description: 'Signed out' } } },
      },
      '/_contentkit/session': {
        get: {
          summary: 'Describe the current site reader session',
          responses: { 200: { description: 'Reader and group projection' }, 401: { description: 'Not signed in' } },
        },
      },
      '/_contentkit/navigation.json': {
        get: {
          summary: 'Navigation entries visible to the current reader',
          responses: { 200: { description: 'Authorized release navigation' }, 401: { description: 'Not signed in' } },
        },
      },
      '/_contentkit/search-index.json': {
        get: {
          summary: 'Protected search entries visible to the current reader',
          responses: {
            200: { description: 'Authorized release search records' },
            401: { description: 'Not signed in' },
          },
        },
      },
      '/v1/sites': {
        post: {
          summary: 'Create a site (unrestricted site administrator)',
          security: secured,
          requestBody: jsonBody(['name', 'base_url', 'default_locale']),
          responses: {
            201: { description: 'Created' },
            403: { description: 'A site-restricted administrator cannot create a global site' },
          },
        },
      },
      '/v1/sites/{site}': {
        get: {
          summary: 'Read site metadata and settings',
          description:
            'Read the site row before a partial update: `PATCH` replaces `settings` wholesale, so send back the full object.',
          security: secured,
          parameters: [siteParameter],
          responses: {
            200: {
              description: 'Site',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Site' } } },
            },
            404: { description: 'Site not found' },
          },
        },
        patch: {
          summary: 'Update site metadata, settings and domains',
          description:
            'Replaces `settings` in full — read the site first and merge, or unlisted keys are dropped. `domains` follows the same contract: an array replaces every hostname mapping (empty array removes all); omit it to leave the mappings alone. `settings.presentation.preset` accepts `portfolio`, `product-docs`, `wiki`, `knowledge-base`, `product` or `changelog`; product docs require 1–32 unique version IDs, labels up to 120 characters and exactly one current version. Optional `settings.presentation.report_series` is an array of up to 32 unique `ReportSeriesSetting` objects (`id`, `label`, integer `nav_order`, `lead_cadence`). Builder-read settings are validated on write and reject the whole PATCH with 422. Theme tokens accept only the documented allowlist, including `chart_1` through `chart_5` for report SVGs; scalar and `{ light, dark }` values apply to both the page and server-rendered charts. `settings.theme.custom_css` is limited to 8192 bytes without `</style`, and `settings.content.show_extra` must be a boolean.',
          security: secured,
          parameters: [siteParameter],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SitePatch' } } },
          },
          responses: {
            200: {
              description: 'Updated',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Site' } } },
            },
          },
        },
      },
      '/v1/sites/{site}/access/users': {
        get: {
          summary: 'List site reader accounts',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: { description: 'Users without password hashes' } },
        },
        post: {
          summary: 'Create a site reader account',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(['username', 'password']),
          responses: { 201: { description: 'Reader created; password is never returned' } },
        },
      },
      '/v1/sites/{site}/access/users/{user}': {
        patch: {
          summary: 'Update a reader, password, active state or groups',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'user', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody(),
          responses: { 200: { description: 'Updated' }, 404: { description: 'Reader not found' } },
        },
        delete: {
          summary: 'Delete a reader and its sessions',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'user', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'Deleted' }, 404: { description: 'Reader not found' } },
        },
      },
      '/v1/sites/{site}/access/users/{user}/revoke-sessions': {
        post: {
          summary: 'Revoke every session for one reader',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'user', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'Revocation count' } },
        },
      },
      '/v1/sites/{site}/access/groups': {
        get: {
          summary: 'List reader groups',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: { description: 'Groups' } },
        },
        post: {
          summary: 'Create a reader group',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(['slug']),
          responses: { 201: { description: 'Group created' } },
        },
      },
      '/v1/sites/{site}/access/groups/{group}': {
        patch: {
          summary: 'Rename a reader group',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'group', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody(),
          responses: { 200: { description: 'Updated' } },
        },
        delete: {
          summary: 'Delete an unreferenced reader group',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'group', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'Deleted' }, 409: { description: 'Group is referenced by a rule' } },
        },
      },
      '/v1/sites/{site}/access/groups/{group}/members': {
        put: {
          summary: 'Replace a reader group membership list',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'group', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody(['user_ids']),
          responses: { 200: { description: 'Membership replaced' } },
        },
      },
      '/v1/sites/{site}/access/rules': {
        get: {
          summary: 'List draft access rules',
          security: secured,
          parameters: [siteParameter],
          responses: { 200: { description: 'Rules' } },
        },
        post: {
          summary: 'Create a draft exact or prefix access rule',
          description: 'The rule becomes live atomically with the next preview/release build.',
          security: secured,
          parameters: [siteParameter],
          requestBody: jsonBody(['path']),
          responses: { 201: { description: 'Rule created; rebuild_required is true' } },
        },
      },
      '/v1/sites/{site}/access/rules/{rule}': {
        patch: {
          summary: 'Update a draft access rule',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'rule', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          requestBody: jsonBody(),
          responses: { 200: { description: 'Updated; rebuild_required is true' } },
        },
        delete: {
          summary: 'Delete a draft access rule',
          security: secured,
          parameters: [
            siteParameter,
            { name: 'rule', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'Deleted; rebuild_required is true' } },
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
            "Frontmatter supports the controlled layouts `standard`, `docs`, `wiki`, `knowledge`, `landing`, `changelog`, `composition` and `deck`; `report` remains a compatibility alias for report compositions. `kind: deck` requires `layout: deck` and accepts bounded `deck.template`, `deck.theme`, `deck.visualScheme`, `deck.maxSlides` and `deck.firstSlide`; selected templates validate explicit per-slide `deckRole` narrative slots before rendering. Semantic directives become SVG/PNG-enhanced self-contained Slidev output at preview/release time. Normal articles and pages may embed selected semantic directives as responsive HTML information islands (`semantic.presentation: embedded`) without turning the entire document into a visual composition or implicitly producing SVG/PNG. Full visual compositions use a versioned Semantic AST plus declarative repository-owned Pattern Packages and render responsive HTML, standalone light/dark SVG and PNG (`semantic.presentation: document`). Documents without semantic directives report `semantic.presentation: prose`. `composition.format` is `infographic` or `report`; reports may use `reportCadence` with `hourly`, `daily`, `weekly`, `monthly`, `quarterly` or `yearly` and may select a configured series with `reportSeries`. `reportSeries` is invalid on non-report compositions; a preview or release rejects IDs absent from `settings.presentation.report_series`. Document narrative fields are `audience`, `question`, `goal`, `thesis`, `conclusion`, `action`, bounded `limitations` and `disclosure`. Semantic directives are `hero`, `metric`, `process`, `comparison`, `timeline`, `hierarchy`, `relationship`, `chart`, `progress`, `badge`, `card`, `group`, `faq`, `question`, `code-example`, `variant`, `pricing`, `plan`, `gallery`, `figure`, `data-table`, `dashboard-section`, `application-shell` and `region`. Authors may request a pattern but cannot provide geometry, CSS, executable code or renderer specifications. Charts remain table-driven: `type` supports `bar`, `line`, `area` and `donut`, while optional `shape` declares a validated information form such as range, change, diverging, Likert, XY, boxplot, matrix, waterfall, hierarchy, flow, uncertainty, calendar, geographic point/region or samples. Optional `question`, `insight`, `action` and `limitation` attributes preserve the chart instance's communication intent. Mermaid fences are classified as process, sequence, state, data-model or architecture evidence and may use the same quoted narrative metadata after the fence language. Hierarchical pages use `docKey`, `docsVersion`, `parent`, `navTitle` and `navOrder`; a document can grant reader groups with `access`. It may also carry an author-owned `extra:` map and `related: [slug, ...]` references.",
          security: secured,
          parameters: [siteParameter],
          requestBody: markdownBody,
          responses: { 201: { description: 'Draft created' } },
        },
      },
      '/v1/composition-patterns': {
        get: {
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
      '/v1/sites/{site}/compositions/recommend': {
        post: {
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
          summary: 'List controlled slide-deck themes',
          responses: {
            200: { description: 'Theme identifiers and the default theme' },
            304: { description: 'Strong ETag matched' },
          },
        },
      },
      '/v1/deck-templates': {
        get: {
          summary: 'List controlled slide-deck narrative templates',
          description:
            'Returns machine-readable narrative slots, required roles, defaults and visual contracts for every reusable deck template.',
          responses: {
            200: { description: 'Versioned template registry, identifiers, default and registry hash' },
            304: { description: 'Strong ETag matched' },
          },
        },
      },
      '/v1/sites/{site}/decks/plan': {
        post: {
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
            'Accepts the same controlled-layout, semantic-composition, semantic-deck, report-cadence, report-series, hierarchy, reader-access, custom-field and related-post frontmatter contract as content creation. Values are validated on write (422 on malformed input) and stored in immutable revision metadata.',
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
          summary: 'Build a named, time-limited preview',
          description:
            'Builds an immutable preview and replaces any prior preview with the same slug. The response separates the one-time secret invitation URL from the memorable session-protected preview URL. Opening the invitation atomically consumes it, creates a path-scoped HttpOnly session and redirects to the preview URL.',
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
                    required: ['release_id', 'preview_url', 'invitation_url', 'expires_in'],
                    properties: {
                      release_id: { type: 'string', format: 'uuid' },
                      preview_url: { type: 'string', format: 'uri' },
                      invitation_url: {
                        type: 'string',
                        format: 'uri',
                        description: 'Secret one-time URL. Distribute it only to the intended reviewer.',
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
          summary: 'Exchange a one-time preview invitation',
          description:
            'Consumes the invitation, sets a path-scoped HttpOnly preview-session cookie and redirects to the named preview URL. A consumed, expired, revoked or unknown invitation returns 404.',
          security: [],
          parameters: [
            {
              name: 'token',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Secret invitation value returned once by the preview build endpoint.',
            },
          ],
          responses: {
            303: {
              description: 'Invitation exchanged; redirect to the clean preview URL',
              headers: {
                Location: { schema: { type: 'string' } },
                'Set-Cookie': { schema: { type: 'string' } },
              },
            },
            404: { description: 'Invitation unavailable' },
          },
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
            'Cron-triggered lifecycle sweep. Deletes storage objects and rows for releases past the retention window that are not active, within the rollback keep-window, or referenced by live named preview access; reaps builds stuck in building. Requires an unrestricted release:write key.',
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
        get: {
          summary: 'List API keys without hashes or secrets',
          security: secured,
          responses: { 200: { description: 'API-key metadata' } },
        },
        post: {
          summary: 'Create a scoped API key',
          security: secured,
          requestBody: jsonBody(['name', 'scopes']),
          responses: { 201: { description: 'Created; raw key returned once' } },
        },
      },
      '/v1/api-keys/{id}': {
        delete: {
          summary: 'Revoke an API key',
          security: secured,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Revoked' }, 404: { description: 'Not found' } },
        },
      },
      '/v1/identity-grants': {
        get: {
          summary: 'List OAuth identity grants',
          description:
            'Optional exact-match filters: provider_id, subject. Each grant carries its product_scopes ceiling (the only stored truth), the denormalized display role and grant_source (admin, seed, signup or api-key).',
          security: secured,
          parameters: [
            { name: 'provider_id', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'subject', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Pre-provisioned exact OIDC subject grants' } },
        },
        post: {
          summary: 'Pre-provision an OAuth identity grant',
          description:
            'provider_id and issuer must exactly match a configured external identity provider. A grant binds the immutable provider subject to a product-scope ceiling and optional sites. Exactly one of role or product_scopes is required: a named role (reader, author, admin) is a shorthand the server expands into the scope ceiling once; the stored truth is always product_scopes. source may only carry the value seed (seeder marking); everything else is stamped admin.',
          security: secured,
          requestBody: jsonBody(['provider_id', 'issuer', 'subject']),
          responses: {
            201: { description: 'Identity grant created' },
            422: { description: 'Invalid provider, role/product_scopes conflict or unsupported scope' },
          },
        },
      },
      '/v1/identity-grants/{id}': {
        patch: {
          summary: 'Update an OAuth identity grant ceiling',
          description:
            'Accepts email, display_name, site_ids and exactly one of role or product_scopes (role expands to a complete scope replacement). restore:true is the only way to clear revoked_at on a revoked grant; a PATCH without restore matches non-revoked grants only. A PATCH without source:"seed" stamps grant_source=admin, taking the row over from the seeder.',
          security: secured,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: jsonBody(),
          responses: { 200: { description: 'Updated' }, 404: { description: 'Not found' } },
        },
        delete: {
          summary: 'Revoke an OAuth identity grant and active sessions/access/refresh tokens',
          security: secured,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Revoked' }, 404: { description: 'Not found' } },
        },
      },
      '/v1/audit-events': {
        get: {
          summary: 'Read redacted append-only audit events',
          description:
            'Optional site, action and limit filters. Audit metadata excludes credentials, content, Markdown, request bodies and email addresses.',
          security: secured,
          responses: { 200: { description: 'Audit events' }, 404: { description: 'Site not found' } },
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
