import { api, body, unwrap, unwrapAs } from './client'
import type { components, operations } from './schema'

type Schema<T extends keyof components['schemas']> = components['schemas'][T]
type Query<T extends keyof operations> = operations[T] extends { parameters: { query?: infer Q } } ? Q : never
/**
 * Four lists answer across every site the credential reaches, and `site_id` is
 * the only thing that narrows them. Taking the site as a separate, required
 * argument and removing it from the caller's query object is what makes
 * "forgot the site" a type error instead of a page that quietly mixes two.
 */
type SiteScoped<T extends keyof operations> = Omit<NonNullable<Query<T>>, 'site_id'>
type Json<T extends keyof operations> = operations[T] extends { requestBody?: { content: { 'application/json': infer B } } }
  ? B
  : never
type Result<T extends keyof operations> = operations[T] extends {
  responses: { 200: { content: { 'application/json': infer R } } }
}
  ? R
  : never
/** The same, for the operations that answer 201. */
type Created<T extends keyof operations> = operations[T] extends {
  responses: { 201: { content: { 'application/json': infer R } } }
}
  ? R
  : never

export type Site = Schema<'Site'>
export type SitePatch = Schema<'SitePatch'>
export type SiteSettings = Schema<'SiteSettings'>
export type SiteCreateInput = Schema<'SiteCreateInput'>
export type SiteLocale = Schema<'SiteLocale'>
export type SiteLocaleList = Schema<'SiteLocaleList'>
export type SiteLocaleRemoved = Schema<'SiteLocaleRemoved'>
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
export type RenderInput = Json<'renderMarkdownFragment'>
export type RenderResult = Result<'renderMarkdownFragment'>

export type ContentKind = 'page' | 'post' | 'project' | 'deck'

// ─────────────────────────────────────────────────────────────────────────────
// Response shapes.
//
// Every alias below resolves through the OpenAPI document, so a field the
// server stops sending stops compiling here. The remaining hand-written
// interfaces are the operations whose response the spec still describes in
// prose only; each `unwrapAs` call is one such gap, and the guessing they
// require is exactly what shipped `endpoint.active`, `delivery.event` and
// `created.api_key` — three names the server has never used.
// ─────────────────────────────────────────────────────────────────────────────

/** The list and the detail route answer the same schema; pages pass this around. */
export type ContentItem = Schema<'ContentItem'>

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

export type Release = Schema<'Release'>
/** What a build or an activation answers — a receipt, not a release row. */
export type ReleaseBuildResult = Schema<'ReleaseBuildResult'>
export type Preview = Created<'previewCreate'>

export type ApiKey = Schema<'ApiKeySummary'>
/** The raw key exists exactly once, in this response. It is never readable again. */
export type CreatedApiKey = Schema<'CreatedApiKey'>

export type IdentityGrant = Schema<'IdentityGrantSummary'>
export type IdentityProvider = Schema<'AuthProvider'>
/** The 409 body of a duplicate grant: it names the row to edit or restore. */
export type IdentityGrantConflict = Schema<'IdentityGrantConflict'>

export type Comment = Schema<'Comment'>
export type ContactSubmission = Schema<'ContactSubmission'>
export type FeedbackAggregate = Schema<'FeedbackAggregate'>

export type WebhookEndpoint = Schema<'WebhookEndpoint'>
export type CreatedWebhookEndpoint = Schema<'CreatedWebhookEndpoint'>
export type WebhookSecret = Schema<'WebhookSecret'>
export type WebhookDelivery = Schema<'WebhookDelivery'>

export type AuditEvent = Schema<'AuditEvent'>

export type AudioJob = Schema<'AudioJob'>
export type AudioJobs = Schema<'AudioJobList'>

export type ReadinessReport = Schema<'ReadinessReport'>
export type DeckThemeList = Schema<'DeckThemeList'>
export type DeckTemplateList = Schema<'DeckTemplateList'>

export interface DeckJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  error: string | null
}

export type OperatorSession = Result<'describeCockpitSession'>

// ─────────────────────────────────────────────────────────────────────────────
// Request shapes.
//
// The spec types these bodies as a bare `{type: object}` — the server reads
// them field by field rather than against a schema — so they are named here.
// A page that misspells `group_slugs` for `groups` gets a 422 it cannot act on;
// naming them turns that into a compile error.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReaderInput {
  username?: string
  password?: string
  display_name?: string
  active?: boolean
  /** Group *slugs*, not ids — the server resolves them per site. */
  groups?: string[]
}

export interface GroupInput {
  /** Immutable after creation: only `name` is patchable. */
  slug?: string
  name?: string
}

export interface RuleInput {
  match?: 'exact' | 'prefix'
  path?: string
  /** Group slugs. */
  groups?: string[]
  /** Reader ids. */
  users?: string[]
}

export interface WebhookInput {
  url?: string
  /** Empty means every event. */
  events?: string[]
  description?: string
  enabled?: boolean
}

export interface GrantInput {
  provider_id?: string
  issuer?: string
  subject?: string
  email?: string
  display_name?: string
  /** Mutually exclusive with `product_scopes`; the server expands it once. */
  role?: 'reader' | 'author' | 'admin'
  product_scopes?: string[]
  site_ids?: string[]
  /** The only way to clear `revoked_at`. A PATCH without it matches live grants only. */
  restore?: boolean
}

export interface PreviewInput {
  slug: string
  revision_ids?: string[]
  expires_in?: number
  reason?: string
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
    session: () => unwrap(api.GET('/v1/identity/session', {})),
    logout: () => unwrapAs<void>(api.POST('/v1/identity/logout', {})),
    loginUrl: (returnTo: string) => `/v1/identity/cockpit-login?return_to=${encodeURIComponent(returnTo)}`,
  },

  sites: {
    /** Every site this credential may read. `site_ids: []` on a grant means all of them. */
    list: () => unwrap(api.GET('/v1/sites', {})),
    get: (site: string) => unwrap(api.GET('/v1/sites/{site}', { params: { path: { site } } })),
    /**
     * One request creates the site row, its locale rows, its hostname mappings and
     * its settings — `POST /v1/sites` validates and stores all four. The signature
     * used to stop at `name`/`base_url`/`default_locale`/`slug`, which forced the
     * console into three sequential writes and a state where the site exists
     * without its preset because the second one failed. `locales` is validated
     * like `addLocale()` (IETF tag, case-folded, `default_locale` always included,
     * at most 32), so a whole multilingual site is one call.
     */
    create: (input: SiteCreateInput) => unwrap(api.POST('/v1/sites', { body: body(input) })),
    // PATCH replaces `settings` wholesale — read, merge, then send the whole
    // object back. Sending a partial subtree silently drops the rest.
    update: (site: string, patch: SitePatch) =>
      unwrap(api.PATCH('/v1/sites/{site}', { params: { path: { site } }, body: patch })),
    /**
     * Deletes the site and everything it owns. A site that still holds content,
     * releases or readers answers 409 with the counts until `purge` is passed —
     * that refusal is the confirmation step, so never call this with purge on
     * the first attempt.
     */
    remove: (site: string, purge = false) =>
      unwrap(api.DELETE('/v1/sites/{site}', { params: { path: { site }, query: { purge } } })),
    /**
     * The locale set the site builds. `Site` does not carry it, so this is the only
     * read path: `locales` are the stored rows, `builds` is what the next release
     * actually emits — they differ for a site with no rows at all, which still
     * builds its `default_locale` tree. `max_locales` is the cap.
     */
    locales: (site: string) => unwrap(api.GET('/v1/sites/{site}/locales', { params: { path: { site } } })),
    /**
     * Locale rows are the site's build matrix — the builder emits one page tree
     * per locale — and `update()` cannot change them: `SitePatch` validates
     * `default_locale` against the stored rows and never writes them. The locale
     * is case-folded server-side, a locale the site already has answers 409, and
     * the 33rd answers 422. Live pages are unaffected until the next release build.
     */
    addLocale: (site: string, locale: string) =>
      unwrap(api.POST('/v1/sites/{site}/locales', { params: { path: { site } }, body: body({ locale }) })),
    /**
     * Refused with 409 while the locale is the site's `default_locale` (the root
     * redirect and the 404 page target it) or while it still carries content the
     * site publishes — items with a published revision *or* with a `scheduled` one,
     * which sets no published pointer but would be published into a locale the
     * build no longer emits. That refusal is the safeguard, not a step to repeat.
     * Content is never deleted; `draft_items` counts the items left behind with no
     * published revision (drafts and items unpublished earlier alike).
     */
    removeLocale: (site: string, locale: string) =>
      unwrap(api.DELETE('/v1/sites/{site}/locales/{locale}', { params: { path: { site, locale } } })),
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
    get: (item: string) => unwrap(api.GET('/v1/content/{item}', { params: { path: { item } } })),
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
      /** Narrates one published post: the backfill narrowed to that post's slug. */
      create: (item: string, input: { force?: boolean; dry_run?: boolean; limit_chars?: number } = {}) =>
        unwrap(api.POST('/v1/content/{item}/audio', { params: { path: { item } }, body: input })),
      remove: (item: string) =>
        unwrapAs<void>(api.DELETE('/v1/content/{item}/audio', { params: { path: { item } } })),
      jobs: (site: string, query?: Query<'audioJobList'>) =>
        unwrap(api.GET('/v1/sites/{site}/audio/jobs', { params: { path: { site }, query } })),
      backfill: (site: string, input: { limit_chars?: number; dry_run?: boolean; force?: boolean } = {}) =>
        unwrapAs<unknown>(api.POST('/v1/sites/{site}/audio/backfill', { params: { path: { site } }, body: body(input) })),
      /** Re-queues one job. A job the worker already holds answers 409. */
      retry: (site: string, job: string) =>
        unwrap(
          api.POST('/v1/sites/{site}/audio/jobs/{job}/retry', { params: { path: { site, job } }, body: body({}) }),
        ),
    },
  },

  published: {
    list: (site: string, query?: Query<'publishedList'>) =>
      unwrap(api.GET('/v1/sites/{site}/published', { params: { path: { site }, query } })),
    get: (site: string, kind: ContentKind, locale: string, slug: string) =>
      unwrap(
        api.GET('/v1/sites/{site}/published/{kind}/{locale}/{slug}', {
          params: { path: { site, kind, locale, slug } },
        }),
      ),
    compositionUrl: (site: string, kind: string, locale: string, slug: string, format: 'svg' | 'png') =>
      `/v1/sites/${site}/published/${kind}/${locale}/${slug}/composition.${format}`,
  },

  /**
   * The console's only Markdown renderer. Nothing is persisted, and the result
   * is what a release of this site would produce — same directives, same charts,
   * same syntax highlighting, same sanitize allowlist.
   */
  render: (site: string, input: RenderInput) =>
    unwrap(api.POST('/v1/sites/{site}/render', { params: { path: { site } }, body: input })),

  search: (site: string, query: Query<'siteSearch'>) =>
    unwrapAs<unknown>(api.GET('/v1/sites/{site}/search', { params: { path: { site }, query } })),

  compositions: {
    patterns: (query?: Query<'compositionPatternList'>) =>
      unwrapAs<{ patterns: PatternDescriptor[] }>(api.GET('/v1/composition-patterns', { params: { query } })),
    pattern: (pattern: string) =>
      unwrap(api.GET('/v1/composition-patterns/{pattern}', { params: { path: { pattern } } })),
    guides: () => unwrapAs<{ guides: PublishingGuide[] }>(api.GET('/v1/publishing-guides', {})),
    guide: (guide: string) =>
      unwrap(api.GET('/v1/publishing-guides/{guide}', { params: { path: { guide } } })),
    recommend: (site: string, input: unknown) =>
      unwrapAs<unknown>(
        api.POST('/v1/sites/{site}/compositions/recommend', { params: { path: { site } }, body: body(input) }),
      ),
    validate: (site: string, input: unknown) =>
      unwrapAs<unknown>(
        api.POST('/v1/sites/{site}/compositions/validate', { params: { path: { site } }, body: body(input) }),
      ),
    compile: (site: string, input: unknown) =>
      unwrap(api.POST('/v1/sites/{site}/compositions/compile', { params: { path: { site } }, body: body(input) })),
  },

  decks: {
    themes: () => unwrap(api.GET('/v1/deck-themes', {})),
    templates: () => unwrap(api.GET('/v1/deck-templates', {})),
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
    list: (site: string) => unwrap(api.GET('/v1/sites/{site}/releases', { params: { path: { site } } })),
    create: (site: string, input: { reason?: string } = {}) =>
      unwrap(api.POST('/v1/sites/{site}/releases', { params: { path: { site } }, body: body(input) })),
    /**
     * Rollback and roll-forward are the same call. Only a `kind: 'release'`
     * build is activatable: a preview is rendered behind an invitation and the
     * server answers 404 for it.
     */
    activate: (site: string, release: string) =>
      unwrap(
        api.POST('/v1/sites/{site}/releases/{release}/activate', {
          params: { path: { site, release } },
          body: body({}),
        }),
      ),
    /** Only a release the site is not serving; the active one answers 409. */
    remove: (site: string, release: string) =>
      unwrap(api.DELETE('/v1/sites/{site}/releases/{release}', { params: { path: { site, release } } })),
    /** Builds a preview release and returns its two URLs; the invitation is secret. */
    preview: (site: string, input: PreviewInput) =>
      unwrap(api.POST('/v1/sites/{site}/previews', { params: { path: { site } }, body: body(input) })),
    publishDue: () => unwrapAs<unknown>(api.POST('/v1/publish-due', { body: body({}) })),
    storageGc: () => unwrapAs<unknown>(api.POST('/v1/maintenance/storage-gc', { body: body({}) })),
  },

  access: {
    users: (site: string) => unwrap(api.GET('/v1/sites/{site}/access/users', { params: { path: { site } } })),
    createUser: (site: string, input: ReaderInput) =>
      unwrap(api.POST('/v1/sites/{site}/access/users', { params: { path: { site } }, body: body(input) })),
    /** A password change or a deactivation revokes every session of that reader. */
    updateUser: (site: string, user: string, input: ReaderInput) =>
      unwrap(api.PATCH('/v1/sites/{site}/access/users/{user}', { params: { path: { site, user } }, body: body(input) })),
    deleteUser: (site: string, user: string) =>
      unwrap(api.DELETE('/v1/sites/{site}/access/users/{user}', { params: { path: { site, user } } })),
    revokeSessions: (site: string, user: string) =>
      unwrap(
        api.POST('/v1/sites/{site}/access/users/{user}/revoke-sessions', {
          params: { path: { site, user } },
          body: body({}),
        }),
      ),
    groups: (site: string) => unwrap(api.GET('/v1/sites/{site}/access/groups', { params: { path: { site } } })),
    createGroup: (site: string, input: GroupInput) =>
      unwrap(api.POST('/v1/sites/{site}/access/groups', { params: { path: { site } }, body: body(input) })),
    updateGroup: (site: string, group: string, input: GroupInput) =>
      unwrap(
        api.PATCH('/v1/sites/{site}/access/groups/{group}', { params: { path: { site, group } }, body: body(input) }),
      ),
    /** 409 while any rule still names the group's slug. */
    deleteGroup: (site: string, group: string) =>
      unwrap(api.DELETE('/v1/sites/{site}/access/groups/{group}', { params: { path: { site, group } } })),
    /** PUT replaces the whole membership list. */
    setGroupMembers: (site: string, group: string, userIds: readonly string[]) =>
      unwrap(
        api.PUT('/v1/sites/{site}/access/groups/{group}/members', {
          params: { path: { site, group } },
          body: body({ user_ids: userIds }),
        }),
      ),
    rules: (site: string) => unwrap(api.GET('/v1/sites/{site}/access/rules', { params: { path: { site } } })),
    createRule: (site: string, input: RuleInput) =>
      unwrap(api.POST('/v1/sites/{site}/access/rules', { params: { path: { site } }, body: body(input) })),
    /**
     * PATCH merges each key separately, so a body carrying only `groups` keeps
     * the stored `users` — which reads as "the users I cleared came back".
     * Callers send both audience keys every time.
     */
    updateRule: (site: string, rule: string, input: RuleInput) =>
      unwrap(api.PATCH('/v1/sites/{site}/access/rules/{rule}', { params: { path: { site, rule } }, body: body(input) })),
    deleteRule: (site: string, rule: string) =>
      unwrap(api.DELETE('/v1/sites/{site}/access/rules/{rule}', { params: { path: { site, rule } } })),
  },

  webhooks: {
    list: (site: string) => unwrap(api.GET('/v1/sites/{site}/webhooks', { params: { path: { site } } })),
    /** The response carries the signing secret. It is the only time it exists. */
    create: (site: string, input: WebhookInput) =>
      unwrap(api.POST('/v1/sites/{site}/webhooks', { params: { path: { site } }, body: body(input) })),
    update: (site: string, endpoint: string, input: WebhookInput) =>
      unwrap(
        api.PATCH('/v1/sites/{site}/webhooks/{endpoint}', {
          params: { path: { site, endpoint } },
          body: body(input),
        }),
      ),
    remove: (site: string, endpoint: string) =>
      unwrap(api.DELETE('/v1/sites/{site}/webhooks/{endpoint}', { params: { path: { site, endpoint } } })),
    /**
     * Answers with the replacement secret, once. Dropping that response is not
     * a safe default — it leaves an endpoint signing with a secret nobody holds.
     */
    rotate: (site: string, endpoint: string) =>
      unwrap(
        api.POST('/v1/sites/{site}/webhooks/{endpoint}/rotate', {
          params: { path: { site, endpoint } },
          body: body({}),
        }),
      ),
    deliveries: (siteId: string, query?: SiteScoped<'webhookDeliveryList'>) =>
      unwrap(api.GET('/v1/webhook-deliveries', { params: { query: { ...query, site_id: siteId } } })),
    retry: (delivery: string) =>
      unwrap(api.POST('/v1/webhook-deliveries/{delivery}/retry', { params: { path: { delivery } }, body: body({}) })),
  },

  moderation: {
    comments: (siteId: string, query?: SiteScoped<'commentList'>) =>
      unwrap(api.GET('/v1/comments', { params: { query: { ...query, site_id: siteId } } })),
    moderate: (comment: string, status: 'approved' | 'rejected') =>
      unwrap(api.PATCH('/v1/comments/{comment}', { params: { path: { comment } }, body: body({ status }) })),
    /** An approved comment is on the live site, so this rebuilds unless publish is false. */
    deleteComment: (comment: string, publish = true) =>
      unwrap(api.DELETE('/v1/comments/{comment}', { params: { path: { comment }, query: { publish } } })),
    contact: (siteId: string, query?: SiteScoped<'contactSubmissionList'>) =>
      unwrap(api.GET('/v1/contact-submissions', { params: { query: { ...query, site_id: siteId } } })),
    /** `new` is part of the set: triage has to be reversible. */
    updateContact: (id: string, status: 'new' | 'read' | 'closed') =>
      unwrap(api.PATCH('/v1/contact-submissions/{id}', { params: { path: { id } }, body: body({ status }) })),
    /** Erases the sender's name, email and message; closing keeps the record. */
    deleteContact: (id: string) => unwrap(api.DELETE('/v1/contact-submissions/{id}', { params: { path: { id } } })),
    feedback: (siteId: string, query?: SiteScoped<'feedbackList'>) =>
      unwrap(api.GET('/v1/feedback', { params: { query: { ...query, site_id: siteId } } })),
    /** Resets one post's counter by deleting its anonymous votes. */
    resetFeedback: (item: string) => unwrap(api.DELETE('/v1/feedback/{item}', { params: { path: { item } } })),
  },

  credentials: {
    apiKeys: async () => (await unwrap(api.GET('/v1/api-keys', {}))).api_keys,
    /** The response carries the only copy of the raw key. Show it once, then forget it. */
    createApiKey: (input: { name: string; scopes: string[]; site_ids?: string[]; expires_at?: string }) =>
      unwrap(api.POST('/v1/api-keys', { body: body(input) })),
    revokeApiKey: (id: string) => unwrap(api.DELETE('/v1/api-keys/{id}', { params: { path: { id } } })),
    grants: async () => (await unwrap(api.GET('/v1/identity-grants', {}))).identities,
    createGrant: (input: GrantInput) => unwrap(api.POST('/v1/identity-grants', { body: body(input) })),
    updateGrant: (id: string, input: GrantInput) =>
      unwrap(api.PATCH('/v1/identity-grants/{id}', { params: { path: { id } }, body: body(input) })),
    revokeGrant: (id: string) => unwrap(api.DELETE('/v1/identity-grants/{id}', { params: { path: { id } } })),
    /** The configured providers a grant can name; only `oidc` ones can carry one. */
    providers: async () => (await unwrap(api.GET('/v1/identity/providers', {}))).providers,
  },

  audit: async (query?: Query<'auditEventList'>) =>
    (await unwrap(api.GET('/v1/audit-events', { params: { query } }))).events,

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
    /** Answers `ok` as text/plain, not JSON. */
    // openapi-fetch parses as JSON regardless of the declared content type, and
    // liveness answers `ok` as plain text on purpose: the probe has to succeed
    // on a process too degraded to serialize anything.
    health: () => unwrap(api.GET('/health', { parseAs: 'text' })),
    /** A 503 body is the same report; the client middleware turns it into an error. */
    ready: () => unwrap(api.GET('/ready', {})),
  },
}
