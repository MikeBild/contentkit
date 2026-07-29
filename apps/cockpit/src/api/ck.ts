import { api, body, unwrap, unwrapAs } from './client'
import type { components, operations } from './schema'

type Schema<T extends keyof components['schemas']> = components['schemas'][T]
type Query<T extends keyof operations> = operations[T] extends { parameters: { query?: infer Q } } ? Q : never

export type Site = Schema<'Site'>
export type SitePatch = Schema<'SitePatch'>
export type SiteSettings = Schema<'SiteSettings'>
export type PublishedList = Schema<'PublishedList'>
export type PublishedDocument = Schema<'PublishedDocument'>
export type ProductStats = Schema<'ProductStats'>
export type UsageStats = Schema<'UsageStats'>
export type AccessUser = Schema<'AccessUser'>
export type AccessGroup = Schema<'AccessGroup'>
export type AccessRule = Schema<'AccessRule'>
export type CompositionCompileResult = Schema<'CompositionCompileResult'>
export type PatternDescriptor = Schema<'PatternDescriptor'>
export type PublishingGuide = Schema<'PublishingGuide'>

export type ContentKind = 'page' | 'post' | 'project' | 'deck'

// ─────────────────────────────────────────────────────────────────────────────
// Hand-maintained response shapes.
//
// A number of operations describe their responses in prose only, so the
// generated type for them is `undefined`. Their runtime shape comes from
// src/repository.mjs and is written out here. Every `unwrapAs` call below marks
// one such gap — when an operation gains a schema in src/openapi.mjs, drop the
// interface and switch the call back to `unwrap`.
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors the generated `contentList` item; kept as a name pages can pass around. */
export type ContentItem = NonNullable<
  operations['contentList']['responses'][200]['content']['application/json']
>[number]

export interface Revision {
  id: string
  item_id: string
  status: 'draft' | 'scheduled' | 'published' | 'archived'
  markdown?: string
  source_sha256: string
  slug: string
  title: string | null
  summary: string | null
  tags: string[] | null
  metadata: Record<string, unknown> | null
  scheduled_at: string | null
  published_at: string | null
  created_at: string
}

export interface Release {
  id: string
  site_id: string
  kind: 'release' | 'preview'
  status: 'building' | 'preview' | 'ready' | 'active' | 'superseded' | 'failed'
  reason: string | null
  revision_ids: string[]
  file_count: number | null
  error: string | null
  completed_at: string | null
  activated_at: string | null
  created_at: string
}

export interface ApiKey {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  site_ids: string[]
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  created_at: string
}

/** The raw key exists exactly once, in this response. It is never readable again. */
export interface CreatedApiKey extends ApiKey {
  api_key: string
}

export interface IdentityGrant {
  id: string
  provider_id: string
  issuer: string | null
  subject: string
  email: string | null
  display_name: string | null
  role: 'admin' | 'author' | 'reader'
  product_scopes: string[]
  site_ids: string[]
  revoked_at: string | null
  created_at: string
}

export interface Comment {
  id: string
  site_id: string
  content_item_id: string
  author_name: string | null
  body: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export interface ContactSubmission {
  id: string
  site_id: string
  name: string | null
  email: string | null
  message: string
  status: 'new' | 'read' | 'closed'
  created_at: string
}

export interface FeedbackAggregate {
  content_item_id: string
  site_id: string
  up: number
  down: number
}

export interface WebhookEndpoint {
  id: string
  site_id: string
  url: string
  events: string[]
  active: boolean
  created_at: string
}

export interface WebhookDelivery {
  id: string
  endpoint_id: string
  event: string
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  response_status: number | null
  created_at: string
}

export interface AuditEvent {
  id: string
  actor_type: string
  actor_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  result: string
  transport: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface AudioJob {
  id: string
  content_item_id: string
  status: string
  characters: number | null
  duration_seconds: number | null
  created_at: string
}

export interface AudioJobs {
  jobs: AudioJob[]
  budget?: { characters_used: number; characters_limit: number }
}

export interface DeckJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  error: string | null
}

export interface OperatorSession {
  subject: string
  email: string | null
  display_name: string | null
  provider_id: string | null
  role: 'admin' | 'author' | 'reader'
  product_scopes: string[]
  site_ids: string[]
  csrf_token: string
  expires_at?: string
  absolute_expires_at?: string
}

const STATS_KINDS = [
  'releases',
  'content',
  'decks',
  'readers',
  'webhooks',
  'audio',
  'engagement',
  'http',
  'compositions',
  'mcp',
] as const

export type StatsKind = (typeof STATS_KINDS)[number]
export const statsKinds = STATS_KINDS

/** `http`, `compositions` and `mcp` answer with UsageStats; the rest ProductStats. */
export const usageStatsKinds: StatsKind[] = ['http', 'compositions', 'mcp']

export interface StatsWindow {
  bucket?: 'hour' | 'day' | 'month' | 'year'
  from?: string
  to?: string
  tz?: string
  group_by?: string[]
  traffic_class?: string
}

const markdown = { 'content-type': 'text/markdown' }

// ─────────────────────────────────────────────────────────────────────────────
// The product API, grouped the way the console is: one namespace per resource.
// ─────────────────────────────────────────────────────────────────────────────

export const ck = {
  identity: {
    /** 401 here is the Cockpit's cue to redirect into the sign-in funnel. */
    session: () => unwrapAs<OperatorSession>(api.GET('/v1/identity/session', {})),
    logout: () => unwrapAs<void>(api.POST('/v1/identity/logout', {})),
    loginUrl: (returnTo: string) => `/v1/identity/cockpit-login?return_to=${encodeURIComponent(returnTo)}`,
  },

  sites: {
    /** Every site this credential may read. `site_ids: []` on a grant means all of them. */
    list: () => unwrapAs<Site[]>(api.GET('/v1/sites', {})),
    get: (site: string) => unwrap(api.GET('/v1/sites/{site}', { params: { path: { site } } })),
    create: (input: { name: string; base_url: string; default_locale: string; slug?: string }) =>
      unwrapAs<Site>(api.POST('/v1/sites', { body: body(input) })),
    // PATCH replaces `settings` wholesale — read, merge, then send the whole
    // object back. Sending a partial subtree silently drops the rest.
    update: (site: string, patch: SitePatch) =>
      unwrapAs<Site>(api.PATCH('/v1/sites/{site}', { params: { path: { site } }, body: patch })),
  },

  content: {
    // Typed by the spec since 4.5.3 — no hand-maintained shape needed here.
    list: (site: string, query?: Query<'contentList'>) =>
      unwrap(api.GET('/v1/sites/{site}/content', { params: { path: { site }, query } })),
    /** The request body is raw Markdown with frontmatter, not JSON. */
    create: (site: string, source: string) =>
      unwrapAs<{ item: ContentItem; revision: Revision }>(
        api.POST('/v1/sites/{site}/content', {
          params: { path: { site } },
          body: body(source),
          headers: markdown,
        }),
      ),
    revisions: (item: string) =>
      unwrapAs<Revision[]>(api.GET('/v1/content/{item}/revisions', { params: { path: { item } } })),
    addRevision: (item: string, source: string) =>
      unwrapAs<Revision>(
        api.PUT('/v1/content/{item}/revisions', {
          params: { path: { item } },
          body: body(source),
          headers: markdown,
        }),
      ),
    unpublish: (item: string) =>
      unwrapAs<void>(api.DELETE('/v1/content/{item}/published', { params: { path: { item } } })),
    /** Discards a never-published draft. A published item answers 409. */
    deleteDraft: (item: string) =>
      unwrapAs<{ item_id: string; deleted: boolean }>(api.DELETE('/v1/content/{item}', { params: { path: { item } } })),
    audio: {
      get: (item: string) => unwrapAs<unknown>(api.GET('/v1/content/{item}/audio', { params: { path: { item } } })),
      remove: (item: string) =>
        unwrapAs<void>(api.DELETE('/v1/content/{item}/audio', { params: { path: { item } } })),
      jobs: (site: string) =>
        unwrapAs<AudioJobs>(api.GET('/v1/sites/{site}/audio/jobs', { params: { path: { site } } })),
      backfill: (site: string) =>
        unwrapAs<unknown>(api.POST('/v1/sites/{site}/audio/backfill', { params: { path: { site } }, body: body({}) })),
    },
  },

  published: {
    list: (site: string, query?: Query<'publishedList'>) =>
      unwrapAs<PublishedList>(api.GET('/v1/sites/{site}/published', { params: { path: { site }, query } })),
    get: (site: string, kind: ContentKind, locale: string, slug: string) =>
      unwrapAs<PublishedDocument>(
        api.GET('/v1/sites/{site}/published/{kind}/{locale}/{slug}', {
          params: { path: { site, kind, locale, slug } },
        }),
      ),
    compositionUrl: (site: string, kind: string, locale: string, slug: string, format: 'svg' | 'png') =>
      `/v1/sites/${site}/published/${kind}/${locale}/${slug}/composition.${format}`,
  },

  search: (site: string, query: Query<'siteSearch'>) =>
    unwrapAs<unknown>(api.GET('/v1/sites/{site}/search', { params: { path: { site }, query } })),

  compositions: {
    patterns: (query?: Query<'compositionPatternList'>) =>
      unwrapAs<{ patterns: PatternDescriptor[] }>(api.GET('/v1/composition-patterns', { params: { query } })),
    pattern: (pattern: string) =>
      unwrapAs<PatternDescriptor>(api.GET('/v1/composition-patterns/{pattern}', { params: { path: { pattern } } })),
    guides: () => unwrapAs<{ guides: PublishingGuide[] }>(api.GET('/v1/publishing-guides', {})),
    guide: (guide: string) =>
      unwrapAs<PublishingGuide>(api.GET('/v1/publishing-guides/{guide}', { params: { path: { guide } } })),
    recommend: (site: string, input: unknown) =>
      unwrapAs<unknown>(
        api.POST('/v1/sites/{site}/compositions/recommend', { params: { path: { site } }, body: body(input) }),
      ),
    validate: (site: string, input: unknown) =>
      unwrapAs<unknown>(
        api.POST('/v1/sites/{site}/compositions/validate', { params: { path: { site } }, body: body(input) }),
      ),
    compile: (site: string, input: unknown) =>
      unwrapAs<CompositionCompileResult>(
        api.POST('/v1/sites/{site}/compositions/compile', { params: { path: { site } }, body: body(input) }),
      ),
  },

  decks: {
    themes: () => unwrapAs<unknown>(api.GET('/v1/deck-themes', {})),
    templates: () => unwrapAs<unknown>(api.GET('/v1/deck-templates', {})),
    plan: (site: string, input: unknown) =>
      unwrapAs<unknown>(api.POST('/v1/sites/{site}/decks/plan', { params: { path: { site } }, body: body(input) })),
    validate: (site: string, input: unknown) =>
      unwrapAs<unknown>(api.POST('/v1/sites/{site}/decks/validate', { params: { path: { site } }, body: body(input) })),
    /** Answers 200 synchronously or 202 with a job id to poll. */
    compile: (site: string, input: unknown) =>
      unwrapAs<unknown>(api.POST('/v1/sites/{site}/decks/compile', { params: { path: { site } }, body: body(input) })),
    job: (site: string, job: string) =>
      unwrapAs<DeckJob>(api.GET('/v1/sites/{site}/deck-jobs/{job}', { params: { path: { site, job } } })),
    jobResult: (site: string, job: string) =>
      unwrapAs<unknown>(api.GET('/v1/sites/{site}/deck-jobs/{job}/result', { params: { path: { site, job } } })),
  },

  releases: {
    list: (site: string) =>
      unwrapAs<Release[]>(api.GET('/v1/sites/{site}/releases', { params: { path: { site } } })),
    create: (site: string, input: { reason?: string } = {}) =>
      unwrapAs<Release>(api.POST('/v1/sites/{site}/releases', { params: { path: { site } }, body: body(input) })),
    /** Rollback and roll-forward are the same call: activate any built release. */
    activate: (site: string, release: string) =>
      unwrapAs<Release>(
        api.POST('/v1/sites/{site}/releases/{release}/activate', {
          params: { path: { site, release } },
          body: body({}),
        }),
      ),
    preview: (site: string, input: unknown) =>
      unwrapAs<{ release_id: string; preview_url: string; invitation_url: string; expires_in: number }>(
        api.POST('/v1/sites/{site}/previews', { params: { path: { site } }, body: body(input) }),
      ),
    publishDue: () => unwrapAs<unknown>(api.POST('/v1/publish-due', { body: body({}) })),
    storageGc: () => unwrapAs<unknown>(api.POST('/v1/maintenance/storage-gc', { body: body({}) })),
  },

  access: {
    users: (site: string) =>
      unwrapAs<AccessUser[]>(api.GET('/v1/sites/{site}/access/users', { params: { path: { site } } })),
    createUser: (site: string, input: unknown) =>
      unwrapAs<AccessUser>(api.POST('/v1/sites/{site}/access/users', { params: { path: { site } }, body: body(input) })),
    updateUser: (site: string, user: string, input: unknown) =>
      unwrapAs<AccessUser>(
        api.PATCH('/v1/sites/{site}/access/users/{user}', { params: { path: { site, user } }, body: body(input) }),
      ),
    deleteUser: (site: string, user: string) =>
      unwrapAs<void>(api.DELETE('/v1/sites/{site}/access/users/{user}', { params: { path: { site, user } } })),
    revokeSessions: (site: string, user: string) =>
      unwrapAs<unknown>(
        api.POST('/v1/sites/{site}/access/users/{user}/revoke-sessions', {
          params: { path: { site, user } },
          body: body({}),
        }),
      ),
    groups: (site: string) =>
      unwrapAs<AccessGroup[]>(api.GET('/v1/sites/{site}/access/groups', { params: { path: { site } } })),
    createGroup: (site: string, input: unknown) =>
      unwrapAs<AccessGroup>(
        api.POST('/v1/sites/{site}/access/groups', { params: { path: { site } }, body: body(input) }),
      ),
    updateGroup: (site: string, group: string, input: unknown) =>
      unwrapAs<AccessGroup>(
        api.PATCH('/v1/sites/{site}/access/groups/{group}', { params: { path: { site, group } }, body: body(input) }),
      ),
    deleteGroup: (site: string, group: string) =>
      unwrapAs<void>(api.DELETE('/v1/sites/{site}/access/groups/{group}', { params: { path: { site, group } } })),
    /** PUT replaces the whole membership list. */
    setGroupMembers: (site: string, group: string, input: unknown) =>
      unwrapAs<unknown>(
        api.PUT('/v1/sites/{site}/access/groups/{group}/members', {
          params: { path: { site, group } },
          body: body(input),
        }),
      ),
    rules: (site: string) =>
      unwrapAs<AccessRule[]>(api.GET('/v1/sites/{site}/access/rules', { params: { path: { site } } })),
    createRule: (site: string, input: unknown) =>
      unwrapAs<AccessRule>(api.POST('/v1/sites/{site}/access/rules', { params: { path: { site } }, body: body(input) })),
    updateRule: (site: string, rule: string, input: unknown) =>
      unwrapAs<AccessRule>(
        api.PATCH('/v1/sites/{site}/access/rules/{rule}', { params: { path: { site, rule } }, body: body(input) }),
      ),
    deleteRule: (site: string, rule: string) =>
      unwrapAs<void>(api.DELETE('/v1/sites/{site}/access/rules/{rule}', { params: { path: { site, rule } } })),
  },

  webhooks: {
    list: (site: string) =>
      unwrapAs<WebhookEndpoint[]>(api.GET('/v1/sites/{site}/webhooks', { params: { path: { site } } })),
    create: (site: string, input: unknown) =>
      unwrapAs<WebhookEndpoint>(api.POST('/v1/sites/{site}/webhooks', { params: { path: { site } }, body: body(input) })),
    update: (site: string, endpoint: string, input: unknown) =>
      unwrapAs<WebhookEndpoint>(
        api.PATCH('/v1/sites/{site}/webhooks/{endpoint}', {
          params: { path: { site, endpoint } },
          body: body(input),
        }),
      ),
    remove: (site: string, endpoint: string) =>
      unwrapAs<void>(api.DELETE('/v1/sites/{site}/webhooks/{endpoint}', { params: { path: { site, endpoint } } })),
    /** The new signing secret is handed over out-of-band, never in the response. */
    rotate: (site: string, endpoint: string) =>
      unwrapAs<unknown>(
        api.POST('/v1/sites/{site}/webhooks/{endpoint}/rotate', {
          params: { path: { site, endpoint } },
          body: body({}),
        }),
      ),
    deliveries: (query?: Query<'webhookDeliveryList'>) =>
      unwrapAs<WebhookDelivery[]>(api.GET('/v1/webhook-deliveries', { params: { query } })),
    retry: (delivery: string) =>
      unwrapAs<unknown>(
        api.POST('/v1/webhook-deliveries/{delivery}/retry', { params: { path: { delivery } }, body: body({}) }),
      ),
  },

  moderation: {
    comments: (query?: Query<'commentList'>) => unwrapAs<Comment[]>(api.GET('/v1/comments', { params: { query } })),
    moderate: (comment: string, status: 'approved' | 'rejected') =>
      unwrapAs<Comment>(api.PATCH('/v1/comments/{comment}', { params: { path: { comment } }, body: body({ status }) })),
    contact: (query?: Query<'contactSubmissionList'>) =>
      unwrapAs<ContactSubmission[]>(api.GET('/v1/contact-submissions', { params: { query } })),
    updateContact: (id: string, status: 'read' | 'closed') =>
      unwrapAs<ContactSubmission>(
        api.PATCH('/v1/contact-submissions/{id}', { params: { path: { id } }, body: body({ status }) }),
      ),
    feedback: () => unwrapAs<FeedbackAggregate[]>(api.GET('/v1/feedback', {})),
  },

  credentials: {
    apiKeys: () => unwrapAs<ApiKey[]>(api.GET('/v1/api-keys', {})),
    /** The response carries the only copy of the raw key. Show it once, then forget it. */
    createApiKey: (input: { name: string; scopes: string[]; site_ids?: string[]; expires_at?: string }) =>
      unwrapAs<CreatedApiKey>(api.POST('/v1/api-keys', { body: body(input) })),
    revokeApiKey: (id: string) => unwrapAs<void>(api.DELETE('/v1/api-keys/{id}', { params: { path: { id } } })),
    grants: () => unwrapAs<IdentityGrant[]>(api.GET('/v1/identity-grants', {})),
    createGrant: (input: unknown) => unwrapAs<IdentityGrant>(api.POST('/v1/identity-grants', { body: body(input) })),
    updateGrant: (id: string, input: unknown) =>
      unwrapAs<IdentityGrant>(api.PATCH('/v1/identity-grants/{id}', { params: { path: { id } }, body: body(input) })),
    revokeGrant: (id: string) => unwrapAs<void>(api.DELETE('/v1/identity-grants/{id}', { params: { path: { id } } })),
  },

  audit: (query?: Query<'auditEventList'>) => unwrapAs<AuditEvent[]>(api.GET('/v1/audit-events', { params: { query } })),

  // Ten kinds, one shape of call. The three usage kinds answer with UsageStats,
  // whose metrics carry an explicit value_state — "missing" is not zero, and a
  // chart must never draw it as one.
  stats: (site: string, kind: StatsKind, window?: StatsWindow) =>
    unwrapAs<ProductStats | UsageStats>(
      api.GET(`/v1/sites/{site}/stats/${kind}` as '/v1/sites/{site}/stats/releases', {
        params: { path: { site }, query: window as never },
      }),
    ),

  system: {
    health: () => unwrapAs<unknown>(api.GET('/health', {})),
    ready: () => unwrapAs<unknown>(api.GET('/ready', {})),
  },
}
