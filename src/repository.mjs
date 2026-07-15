import { randomBytes, randomUUID } from 'node:crypto'
import { renderMarkdown } from './markdown.mjs'
import { hashApiKey } from './auth.mjs'
import { sha256, slugify } from './utils.mjs'
import { assertDeliverableUrl, decryptSecret, encryptSecret, generateWebhookSecret } from './secrets.mjs'

// Content types that execute script in a browser when served inline. Uploaded
// assets are served from /media on every tenant origin, so these are rejected.
const BLOCKED_ASSET_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/xml',
  'text/xml',
])

// An endpoint with no event filter receives everything; otherwise a filter entry
// matches by exact type, bare suffix (`contact.submitted`) or `contentkit.<entry>`.
function matchesEvent(filter, type) {
  if (!filter || !filter.length) return true
  return filter.some((entry) => entry === type || type === `contentkit.${entry}` || type.endsWith(`.${entry}`))
}

const inFilter = (values) => `in.(${values.join(',')})`

function normalizeHost(host) {
  return String(host || '')
    .toLowerCase()
    .split(':')[0]
}

function wildcardMatch(host, hostname) {
  if (!hostname.startsWith('*.')) return false
  const suffix = hostname.slice(1)
  return host.length > suffix.length && host.endsWith(suffix)
}

function validBaseUrl(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
    return url.toString().replace(/\/$/, '')
  } catch {
    throw Object.assign(new Error('base_url must be an absolute HTTP(S) URL without credentials'), { statusCode: 422 })
  }
}

// Published read API paging. The cursor is keyset-based: it encodes the last
// entry's sort position (updated_at DESC, item_id ASC as the tiebreak) as
// base64url("<updated_at>|<item_id>") and is opaque to clients.
const PUBLISHED_PAGE_DEFAULT = 50
const PUBLISHED_PAGE_MAX = 200

// Server-side full-text search over published content. The query is bounded so
// websearch_to_tsquery never chews on arbitrarily long input; limits mirror the
// read-API paging pattern (default page, hard cap).
const SEARCH_QUERY_MAX_CHARS = 200
const SEARCH_LIMIT_DEFAULT = 20
const SEARCH_LIMIT_MAX = 100

const invalidQuery = (message) => Object.assign(new Error(message), { statusCode: 422 })

const publishedCursor = (entry) =>
  Buffer.from(`${new Date(entry.updated_at).toISOString()}|${entry.item_id}`).toString('base64url')

function parsePublishedCursor(value) {
  const decoded = Buffer.from(String(value), 'base64url').toString('utf8')
  const separator = decoded.indexOf('|')
  const updatedAt = separator > 0 ? Date.parse(decoded.slice(0, separator)) : NaN
  const itemId = decoded.slice(separator + 1)
  if (Number.isNaN(updatedAt) || !itemId) throw invalidQuery('cursor is invalid')
  return { updatedAt, itemId }
}

// A read-API entry: the item's identity merged with its published revision.
// `metadata` is the revision jsonb verbatim — the full frontmatter contract,
// including author-owned `extra` fields — deliberately unfiltered.
function publishedEntry(item, revision) {
  return {
    item_id: item.id,
    kind: item.kind,
    locale: item.locale,
    translation_key: item.translation_key,
    slug: revision.slug,
    title: revision.title,
    summary: revision.summary,
    tags: revision.tags,
    metadata: revision.metadata,
    revision_id: revision.id,
    published_at: revision.published_at,
    updated_at: item.updated_at,
  }
}

// search_vector (migration 0006) is a search-index internal roughly the size
// of the document. Raw revision rows travel into API responses (the revision
// listing, ingest's 201), so the column is shed before a row leaves the
// repository — publishedEntry and search results already project explicitly.
function stripSearchVector({ search_vector, ...revision }) {
  return revision
}

// settings.theme.tokens may only name custom properties that site.css actually
// consumes (plus font_family) — a theme is a token assignment, not a schema, so
// an unknown key is a typo and fails the write instead of silently doing
// nothing. Values are one string for both color schemes or { light, dark }.
const THEME_TOKEN_ALLOWLIST = [
  'background',
  'foreground',
  'muted',
  'muted_foreground',
  'border',
  'primary',
  'primary_foreground',
  'radius',
  'font_family',
]

// settings.theme.custom_css is the escape hatch for whatever tokens do not
// cover. The site owner authors it, so the guard is type + size plus rejecting
// "</style" (which would break out of the emitted <style> element) — not a CSS
// sanitizer.
const THEME_CUSTOM_CSS_MAX_BYTES = 8192

// A token value is one CSS declaration value (a color, a radius, a font
// stack), so 256 bytes is generous. Capped for the same reason as custom_css:
// themeStyles() inlines every value into each generated page.
const THEME_TOKEN_VALUE_MAX_BYTES = 256

// Settings are one jsonb blob and unknown keys pass through untouched — but
// keys the builder reads are validated on every write (create and PATCH), so
// a typo fails the request with a 422 instead of silently changing rendering.
// A failure rejects the whole write; nothing is dropped or partially applied.
function validateSiteSettings(settings) {
  if (settings == null) return
  const showExtra = settings.content?.show_extra
  if (showExtra !== undefined && typeof showExtra !== 'boolean') {
    throw Object.assign(new Error('settings.content.show_extra must be a boolean'), { statusCode: 422 })
  }
  const tokens = settings.theme?.tokens
  if (tokens !== undefined) {
    if (typeof tokens !== 'object' || tokens === null || Array.isArray(tokens)) {
      throw Object.assign(new Error('settings.theme.tokens must be a map of design tokens'), { statusCode: 422 })
    }
    for (const [key, value] of Object.entries(tokens)) {
      if (!THEME_TOKEN_ALLOWLIST.includes(key)) {
        throw Object.assign(new Error(`settings.theme.tokens: unknown token "${key}"`), { statusCode: 422 })
      }
      const schemePair =
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof value.light === 'string' &&
        typeof value.dark === 'string' &&
        Object.keys(value).every((scheme) => scheme === 'light' || scheme === 'dark')
      if (typeof value !== 'string' && !schemePair) {
        throw Object.assign(new Error('settings.theme.tokens values must be strings or { light, dark } objects'), {
          statusCode: 422,
        })
      }
      // themeStyles() emits token values verbatim inside a <style> element —
      // raw text, entities are never decoded — so "<" (the only character
      // that could terminate the element) is rejected on write, mirroring the
      // "</style" guard on custom_css.
      for (const entry of typeof value === 'string' ? [value] : [value.light, value.dark]) {
        if (Buffer.byteLength(entry) > THEME_TOKEN_VALUE_MAX_BYTES) {
          throw Object.assign(
            new Error(`settings.theme.tokens values must not exceed ${THEME_TOKEN_VALUE_MAX_BYTES} bytes`),
            { statusCode: 422 },
          )
        }
        if (entry.includes('<')) {
          throw Object.assign(new Error('settings.theme.tokens values must not contain "<"'), { statusCode: 422 })
        }
      }
    }
  }
  const customCss = settings.theme?.custom_css
  if (customCss !== undefined) {
    if (typeof customCss !== 'string') {
      throw Object.assign(new Error('settings.theme.custom_css must be a string'), { statusCode: 422 })
    }
    if (Buffer.byteLength(customCss) > THEME_CUSTOM_CSS_MAX_BYTES) {
      throw Object.assign(new Error(`settings.theme.custom_css must not exceed ${THEME_CUSTOM_CSS_MAX_BYTES} bytes`), {
        statusCode: 422,
      })
    }
    if (customCss.toLowerCase().includes('</style')) {
      throw Object.assign(new Error('settings.theme.custom_css must not contain "</style"'), { statusCode: 422 })
    }
  }
}

export function createRepository(config, db, storage) {
  async function one(table, query) {
    const rows = await db.select(table, { ...query, limit: '1' })
    return rows[0] || null
  }

  // Records the event and fans it out to a delivery row per matching enabled
  // endpoint (plus the legacy env endpoint as endpoint_id=null). `exec` is a
  // db-shaped API so callers can pass a transaction and commit the enqueue
  // atomically with the business write.
  async function enqueueEvent(exec, { site, type, resourceKind, resourceId, data = {}, summary }) {
    const eventId = randomUUID()
    const body = {
      event_id: eventId,
      type,
      site: { id: site.id, name: site.name ?? null },
      occurred_at: new Date().toISOString(),
      data,
      resource: { kind: resourceKind, id: resourceId },
      summary: summary || type,
    }
    await exec.insert(
      'ck_outbox_events',
      {
        id: eventId,
        site_id: site.id,
        type,
        resource_kind: resourceKind,
        resource_id: resourceId,
        payload: body,
        status: 'pending',
      },
      { returning: false },
    )
    const endpoints = await exec.select('ck_webhook_endpoints', { site_id: `eq.${site.id}`, disabled_at: 'is.null' })
    const targets = endpoints.filter((endpoint) => matchesEvent(endpoint.events, type)).map((endpoint) => endpoint.id)
    if (config.webhookUrl) targets.push(null)
    if (targets.length) {
      await exec.insert(
        'ck_webhook_deliveries',
        targets.map((endpointId) => ({
          id: randomUUID(),
          endpoint_id: endpointId,
          site_id: site.id,
          event_id: eventId,
          type,
          payload: body,
          status: 'pending',
          next_attempt_at: new Date().toISOString(),
        })),
        { returning: false },
      )
    }
    return eventId
  }

  // Bulk companion to enqueueEvent for release activation: loads the endpoint
  // list once and writes all outbox rows and delivery rows as two array
  // inserts, so a release with many content transitions stays a handful of
  // statements inside the activation transaction.
  async function enqueueContentEvents(exec, site, events) {
    if (!events.length) return []
    const occurredAt = new Date().toISOString()
    const bodies = events.map(({ type, resourceKind, resourceId, data = {}, summary }) => ({
      event_id: randomUUID(),
      type,
      site: { id: site.id, name: site.name ?? null },
      occurred_at: occurredAt,
      data,
      resource: { kind: resourceKind, id: resourceId },
      summary: summary || type,
    }))
    await exec.insert(
      'ck_outbox_events',
      bodies.map((body) => ({
        id: body.event_id,
        site_id: site.id,
        type: body.type,
        resource_kind: body.resource.kind,
        resource_id: body.resource.id,
        payload: body,
        status: 'pending',
      })),
      { returning: false },
    )
    const endpoints = await exec.select('ck_webhook_endpoints', { site_id: `eq.${site.id}`, disabled_at: 'is.null' })
    const deliveries = []
    for (const body of bodies) {
      const targets = endpoints
        .filter((endpoint) => matchesEvent(endpoint.events, body.type))
        .map((endpoint) => endpoint.id)
      if (config.webhookUrl) targets.push(null)
      for (const endpointId of targets) {
        deliveries.push({
          id: randomUUID(),
          endpoint_id: endpointId,
          site_id: site.id,
          event_id: body.event_id,
          type: body.type,
          payload: body,
          status: 'pending',
          next_attempt_at: occurredAt,
        })
      }
    }
    if (deliveries.length) await exec.insert('ck_webhook_deliveries', deliveries, { returning: false })
    return bodies.map((body) => body.event_id)
  }

  const publicEndpoint = ({ secret_encrypted, ...rest }) => rest

  return {
    enqueueEvent,
    enqueueContentEvents,
    async createWebhookEndpoint(siteId, input) {
      const url = await assertDeliverableUrl(input.url, { allowInsecure: config.webhookAllowPrivateTargets })
      const secret = generateWebhookSecret()
      const [row] = await db.insert('ck_webhook_endpoints', {
        site_id: siteId,
        url,
        secret_encrypted: encryptSecret(secret, config.keyPepper),
        events: Array.isArray(input.events) ? input.events : [],
        description: input.description || '',
      })
      return { ...publicEndpoint(row), secret }
    },
    async listWebhookEndpoints(siteId) {
      const rows = await db.select('ck_webhook_endpoints', { site_id: `eq.${siteId}`, order: 'created_at.desc' })
      return rows.map(publicEndpoint)
    },
    async getWebhookEndpoint(siteId, id) {
      const row = await one('ck_webhook_endpoints', { id: `eq.${id}`, site_id: `eq.${siteId}` })
      return row ? publicEndpoint(row) : null
    },
    async updateWebhookEndpoint(siteId, id, input) {
      const existing = await one('ck_webhook_endpoints', { id: `eq.${id}`, site_id: `eq.${siteId}` })
      if (!existing) return null
      const patch = { updated_at: new Date().toISOString() }
      if (input.url !== undefined)
        patch.url = await assertDeliverableUrl(input.url, { allowInsecure: config.webhookAllowPrivateTargets })
      if (Array.isArray(input.events)) patch.events = input.events
      if (input.description !== undefined) patch.description = String(input.description)
      if (input.enabled === true) {
        patch.disabled_at = null
        patch.consecutive_failures = 0
      }
      if (input.enabled === false) patch.disabled_at = new Date().toISOString()
      const [row] = await db.update('ck_webhook_endpoints', { id: `eq.${id}`, site_id: `eq.${siteId}` }, patch)
      return row ? publicEndpoint(row) : null
    },
    async rotateWebhookSecret(siteId, id) {
      const existing = await one('ck_webhook_endpoints', { id: `eq.${id}`, site_id: `eq.${siteId}` })
      if (!existing) return null
      const secret = generateWebhookSecret()
      await db.update(
        'ck_webhook_endpoints',
        { id: `eq.${id}`, site_id: `eq.${siteId}` },
        { secret_encrypted: encryptSecret(secret, config.keyPepper), updated_at: new Date().toISOString() },
        { returning: false },
      )
      return { id, secret }
    },
    async deleteWebhookEndpoint(siteId, id) {
      const existing = await one('ck_webhook_endpoints', { id: `eq.${id}`, site_id: `eq.${siteId}` })
      if (!existing) return false
      await db.remove('ck_webhook_endpoints', { id: `eq.${id}`, site_id: `eq.${siteId}` })
      return true
    },
    async listDeliveries({ siteId, endpointId, status, limit = 50 } = {}) {
      return db.select('ck_webhook_deliveries', {
        ...(siteId ? { site_id: `eq.${siteId}` } : {}),
        ...(endpointId ? { endpoint_id: `eq.${endpointId}` } : {}),
        ...(status ? { status: `eq.${status}` } : {}),
        order: 'created_at.desc',
        limit: String(Math.min(Number(limit) || 50, 200)),
      })
    },
    async getDelivery(id) {
      return one('ck_webhook_deliveries', { id: `eq.${id}` })
    },
    async retryDelivery(id) {
      const [row] = await db.update(
        'ck_webhook_deliveries',
        { id: `eq.${id}` },
        { status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null },
      )
      return row || null
    },
    decryptEndpointSecret(endpoint) {
      return decryptSecret(endpoint.secret_encrypted, config.keyPepper)
    },
    async getSite(idOrSlug) {
      return one(
        'ck_sites',
        idOrSlug.includes?.('-') && idOrSlug.length > 30 ? { id: `eq.${idOrSlug}` } : { slug: `eq.${idOrSlug}` },
      )
    },
    async getSiteByHost(host) {
      const normalized = normalizeHost(host)
      let domain = await one('ck_site_domains', { hostname: `eq.${normalized}`, verified_at: 'not.is.null' })
      if (!domain) {
        const domains = await db.select('ck_site_domains', { verified_at: 'not.is.null' })
        domain =
          domains
            .filter((candidate) => wildcardMatch(normalized, candidate.hostname))
            .sort((a, b) => b.hostname.length - a.hostname.length)[0] || null
      }
      return domain ? one('ck_sites', { id: `eq.${domain.site_id}` }) : null
    },
    async getLocales(siteId) {
      return db.select('ck_site_locales', { site_id: `eq.${siteId}`, order: 'locale.asc' })
    },
    async createSite(input) {
      const slug = slugify(input.slug || input.name)
      if (!slug || !input.name || !input.base_url || !input.default_locale) {
        throw Object.assign(new Error('name, base_url and default_locale are required'), { statusCode: 422 })
      }
      validateSiteSettings(input.settings)
      const [site] = await db.insert('ck_sites', {
        slug,
        name: input.name,
        description: input.description || '',
        base_url: validBaseUrl(input.base_url),
        default_locale: input.default_locale.toLowerCase(),
        settings: input.settings || {},
      })
      const locales = [...new Set(input.locales || [input.default_locale])]
      await db.insert(
        'ck_site_locales',
        locales.map((locale) => ({ site_id: site.id, locale: locale.toLowerCase() })),
      )
      if (input.domains?.length) {
        await db.insert(
          'ck_site_domains',
          input.domains.map((hostname) => ({
            site_id: site.id,
            hostname: hostname.toLowerCase(),
            verified_at: new Date().toISOString(),
          })),
        )
      }
      return site
    },
    async updateSite(siteId, input) {
      const allowed = Object.fromEntries(
        Object.entries(input).filter(([key]) =>
          ['name', 'description', 'base_url', 'default_locale', 'settings'].includes(key),
        ),
      )
      if (allowed.base_url) allowed.base_url = validBaseUrl(allowed.base_url)
      if ('settings' in allowed) validateSiteSettings(allowed.settings)
      if ('default_locale' in allowed) {
        // The root redirect and 404 target default_locale, so it must be a locale
        // the site actually builds — otherwise `/` would redirect to a 404. Guard
        // on presence (not truthiness) so an empty string can't slip through.
        allowed.default_locale = String(allowed.default_locale).toLowerCase()
        const locales = await db.select('ck_site_locales', { site_id: `eq.${siteId}` })
        if (!locales.some((entry) => entry.locale === allowed.default_locale)) {
          throw Object.assign(new Error('default_locale must be one of the site locales'), { statusCode: 422 })
        }
      }
      // Domains replace in full, mirroring the settings contract: read first,
      // merge, send the whole list. An empty array removes every mapping —
      // absent means "leave them alone".
      if (Array.isArray(input.domains)) {
        await db.tx(async (tx) => {
          await tx.remove('ck_site_domains', { site_id: `eq.${siteId}` })
          if (input.domains.length) {
            await tx.insert(
              'ck_site_domains',
              input.domains.map((hostname) => ({
                site_id: siteId,
                hostname: String(hostname).toLowerCase(),
                verified_at: new Date().toISOString(),
              })),
            )
          }
        })
      }
      // A domains-only PATCH leaves `allowed` empty, and update() with no
      // columns is a no-op returning [] — read the row back instead.
      const rows = Object.keys(allowed).length
        ? await db.update('ck_sites', { id: `eq.${siteId}` }, allowed)
        : await db.select('ck_sites', { id: `eq.${siteId}`, limit: '1' })
      return rows[0]
    },
    async listContent(siteId, query = {}) {
      return db.select('ck_content_items', {
        site_id: `eq.${siteId}`,
        ...(query.kind ? { kind: `eq.${query.kind}` } : {}),
        ...(query.locale ? { locale: `eq.${query.locale}` } : {}),
        order: 'created_at.desc',
      })
    },
    // Headless read API over what is currently published. Two-query join like
    // buildSnapshot; filtering and keyset paging happen in JS at blog scale
    // (precedent: the /v1/feedback aggregation).
    async listPublished(siteId, query = {}) {
      if (query.kind && !['page', 'post', 'project'].includes(query.kind)) {
        throw invalidQuery('kind must be page, post or project')
      }
      let updatedSince = null
      if (query.updated_since) {
        updatedSince = Date.parse(query.updated_since)
        if (Number.isNaN(updatedSince)) throw invalidQuery('updated_since must be an ISO 8601 timestamp')
      }
      let limit = PUBLISHED_PAGE_DEFAULT
      if (query.limit !== undefined) {
        if (!/^\d+$/.test(String(query.limit)) || Number(query.limit) < 1) {
          throw invalidQuery('limit must be a positive integer')
        }
        limit = Math.min(Number(query.limit), PUBLISHED_PAGE_MAX)
      }
      const cursor = query.cursor ? parsePublishedCursor(query.cursor) : null
      const items = await db.select('ck_content_items', {
        site_id: `eq.${siteId}`,
        ...(query.kind ? { kind: `eq.${query.kind}` } : {}),
        ...(query.locale ? { locale: `eq.${query.locale}` } : {}),
      })
      const published = items.filter((item) => item.published_revision_id)
      const revisionIds = published.map((item) => item.published_revision_id)
      const revisions = revisionIds.length ? await db.select('ck_content_revisions', { id: inFilter(revisionIds) }) : []
      const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]))
      // updated_since is strictly greater: ck_activate_release bumps the item's
      // updated_at exactly when the published revision changes, so a client can
      // pass the newest updated_at it has seen without re-reading that entry.
      const entries = published
        .map((item) => {
          const revision = revisionsById.get(item.published_revision_id)
          return revision ? publishedEntry(item, revision) : null
        })
        .filter(Boolean)
        .filter((entry) => !query.tag || (entry.tags || []).includes(query.tag))
        .filter((entry) => updatedSince === null || new Date(entry.updated_at).getTime() > updatedSince)
        .sort((a, b) => {
          const byUpdated = new Date(b.updated_at) - new Date(a.updated_at)
          return byUpdated || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0)
        })
      const after = cursor
        ? entries.filter((entry) => {
            const updatedAt = new Date(entry.updated_at).getTime()
            return updatedAt < cursor.updatedAt || (updatedAt === cursor.updatedAt && entry.item_id > cursor.itemId)
          })
        : entries
      const page = after.slice(0, limit)
      return { items: page, next_cursor: after.length > limit ? publishedCursor(page.at(-1)) : null }
    },
    async getPublished(siteId, kind, locale, slug) {
      const items = await db.select('ck_content_items', {
        site_id: `eq.${siteId}`,
        kind: `eq.${kind}`,
        locale: `eq.${locale}`,
      })
      const published = items.filter((item) => item.published_revision_id)
      if (!published.length) return null
      const revisions = await db.select('ck_content_revisions', {
        id: inFilter(published.map((item) => item.published_revision_id)),
        slug: `eq.${slug}`,
      })
      const revision = revisions[0]
      const item = revision && published.find((candidate) => candidate.published_revision_id === revision.id)
      if (!item) return null
      // HTML is rendered on demand and never stored — revisions stay immutable
      // Markdown exactly as authored; source_sha256 rides along for the ETag.
      // Lenient like the site build: a published document must stay readable
      // even when it predates today's frontmatter rules.
      const rendered = await renderMarkdown(revision.markdown, { lenient: true })
      return {
        ...publishedEntry(item, revision),
        markdown: revision.markdown,
        html: rendered.html,
        source_sha256: revision.source_sha256,
      }
    },
    // Full-text search over what is currently published. Validation lives here
    // (like listPublished); the ranking, stemming and <mark> headlines live in
    // the whitelisted ck_search_published SQL function. Without a locale the
    // query is stemmed with `simple` against locale-stemmed vectors — cross-
    // locale search is best-effort; with a locale the stemming matches exactly.
    async searchPublished(siteId, query = {}) {
      const q = String(query.q ?? '').trim()
      if (!q) throw invalidQuery('q is required')
      if (q.length > SEARCH_QUERY_MAX_CHARS) {
        throw invalidQuery(`q must be at most ${SEARCH_QUERY_MAX_CHARS} characters`)
      }
      if (query.kind && !['page', 'post', 'project'].includes(query.kind)) {
        throw invalidQuery('kind must be page, post or project')
      }
      let limit = SEARCH_LIMIT_DEFAULT
      if (query.limit !== undefined) {
        if (!/^\d+$/.test(String(query.limit)) || Number(query.limit) < 1) {
          throw invalidQuery('limit must be a positive integer')
        }
        limit = Math.min(Number(query.limit), SEARCH_LIMIT_MAX)
      }
      const results = await db.rpc('ck_search_published', {
        p_site_id: siteId,
        p_query: q,
        p_locale: query.locale || null,
        p_kind: query.kind || null,
        p_limit: limit,
      })
      return { query: q, results }
    },
    async revisions(itemId) {
      const rows = await db.select('ck_content_revisions', { item_id: `eq.${itemId}`, order: 'created_at.desc' })
      return rows.map(stripSearchVector)
    },
    async ingest(siteId, markdown, assets = [], expectedItemId = null) {
      let rendered = await renderMarkdown(markdown)
      let expectedItem = null
      if (expectedItemId) {
        expectedItem = await one('ck_content_items', { id: `eq.${expectedItemId}`, site_id: `eq.${siteId}` })
        if (!expectedItem) throw Object.assign(new Error('content item not found'), { statusCode: 404 })
        if (
          expectedItem.kind !== rendered.meta.kind ||
          expectedItem.locale !== rendered.meta.locale ||
          expectedItem.translation_key !== rendered.meta.translation_key
        ) {
          throw Object.assign(new Error('a revision cannot change kind, locale or translationKey'), { statusCode: 422 })
        }
      }
      const assetMap = new Map()
      for (const asset of assets) {
        const path = asset.name.slice('asset:'.length).replace(/^\/+/, '')
        if (!path || path.split('/').includes('..')) {
          throw Object.assign(new Error(`invalid asset path: ${path}`), { statusCode: 422 })
        }
        // Reject browser-executable asset types: served from /media they would run
        // as active content on every tenant's origin (stored XSS).
        if (
          BLOCKED_ASSET_TYPES.has(
            String(asset.contentType || '')
              .split(';')[0]
              .trim()
              .toLowerCase(),
          )
        ) {
          throw Object.assign(new Error(`asset content type not allowed: ${asset.contentType}`), { statusCode: 422 })
        }
        const hash = sha256(asset.body)
        const filename = path.split('/').at(-1)
        const storagePath = `sites/${siteId}/assets/${hash}/${filename}`
        await storage.upload(storagePath, asset.body, asset.contentType, '31536000', true)
        const existing = await one('ck_assets', { site_id: `eq.${siteId}`, sha256: `eq.${hash}` })
        const record =
          existing ||
          (
            await db.insert('ck_assets', {
              site_id: siteId,
              sha256: hash,
              filename,
              storage_path: storagePath,
              content_type: asset.contentType,
              byte_size: asset.body.length,
            })
          )[0]
        assetMap.set(path, `/media/${record.id}/${encodeURIComponent(filename)}`)
      }
      for (const [from, to] of assetMap) {
        markdown = markdown.replaceAll(`](${from})`, `](${to})`).replaceAll(`src="${from}"`, `src="${to}"`)
      }
      if (assetMap.size) rendered = await renderMarkdown(markdown)
      const meta = rendered.meta
      let item =
        expectedItem ||
        (await one('ck_content_items', {
          site_id: `eq.${siteId}`,
          kind: `eq.${meta.kind}`,
          locale: `eq.${meta.locale}`,
          translation_key: `eq.${meta.translation_key}`,
        }))
      if (!item) {
        item = (
          await db.insert('ck_content_items', {
            site_id: siteId,
            kind: meta.kind,
            locale: meta.locale,
            translation_key: meta.translation_key,
          })
        )[0]
      }
      const sourceHash = sha256(markdown)
      const existingRevision = await one('ck_content_revisions', {
        item_id: `eq.${item.id}`,
        source_sha256: `eq.${sourceHash}`,
        slug: `eq.${meta.slug}`,
      })
      if (existingRevision) return { item, revision: stripSearchVector(existingRevision), assets: [...assetMap.values()] }
      const [revision] = await db.insert('ck_content_revisions', {
        item_id: item.id,
        status: meta.scheduled_at ? 'scheduled' : 'draft',
        markdown,
        source_sha256: sourceHash,
        slug: meta.slug,
        title: meta.title,
        summary: meta.summary,
        tags: meta.tags,
        metadata: meta,
        scheduled_at: meta.scheduled_at,
      })
      return { item, revision: stripSearchVector(revision), assets: [...assetMap.values()] }
    },
    async createApiKey(input) {
      if (!config.keyPepper)
        throw Object.assign(new Error('CONTENTKIT_KEY_PEPPER is not configured'), { statusCode: 503 })
      const raw = `ck_${randomBytes(32).toString('base64url')}`
      const [record] = await db.insert('ck_api_keys', {
        name: input.name || 'API key',
        key_prefix: raw.slice(0, 11),
        key_hash: hashApiKey(raw, config.keyPepper),
        scopes: input.scopes || ['content:write'],
        site_ids: input.site_ids || [],
        expires_at: input.expires_at || null,
      })
      return { ...record, key: raw }
    },
    async buildSnapshot(siteId, overlayRevisionIds = [], retireItemIds = []) {
      const site = await this.getSite(siteId)
      if (!site) throw Object.assign(new Error('site not found'), { statusCode: 404 })
      const locales = await this.getLocales(site.id)
      const items = await this.listContent(site.id)
      const overlay = overlayRevisionIds.length
        ? await db.select('ck_content_revisions', { id: inFilter(overlayRevisionIds) })
        : []
      const requested = new Set(overlayRevisionIds)
      const siteItemIds = new Set(items.map((item) => item.id))
      if (overlay.length !== requested.size || overlay.some((revision) => !siteItemIds.has(revision.item_id))) {
        throw Object.assign(new Error('one or more revisions do not belong to this site'), { statusCode: 422 })
      }
      // Two revisions of one item would make the activation nondeterministic
      // (ck_activate_release sets the published pointer to only one of them)
      // and would emit a content.published event for a pointer switch that
      // never happened — rejected like the other impossible release shapes.
      if (new Set(overlay.map((revision) => revision.item_id)).size !== overlay.length) {
        throw Object.assign(new Error('a release allows only one revision per content item'), { statusCode: 422 })
      }
      const retired = new Set(retireItemIds)
      if (retireItemIds.some((itemId) => !siteItemIds.has(itemId))) {
        throw Object.assign(new Error('one or more retired items do not belong to this site'), { statusCode: 422 })
      }
      if (overlay.some((revision) => retired.has(revision.item_id))) {
        throw Object.assign(new Error('an item cannot be published and retired in the same release'), {
          statusCode: 422,
        })
      }
      const byItem = new Map(overlay.map((revision) => [revision.item_id, revision]))
      const publishedIds = items
        .filter((item) => !retired.has(item.id))
        .map((item) => item.published_revision_id)
        .filter(Boolean)
      const published = publishedIds.length
        ? await db.select('ck_content_revisions', { id: inFilter(publishedIds) })
        : []
      for (const revision of published) if (!byItem.has(revision.item_id)) byItem.set(revision.item_id, revision)
      const revisions = items
        .map((item) => {
          const revision = retired.has(item.id) ? null : byItem.get(item.id)
          return revision
            ? {
                ...revision,
                item_id: item.id,
                kind: item.kind,
                locale: item.locale,
                translation_key: item.translation_key,
              }
            : null
        })
        .filter(Boolean)
      const comments = await db.select('ck_comments', { site_id: `eq.${site.id}`, status: 'eq.approved' })
      // Read-aloud audio rides along as plain data: the newest finished job per
      // item, resolved to its asset's stable /media URL. The URL is content-
      // addressed and release-independent, so rebuilding a site never has to
      // copy or re-reference audio bytes.
      const audioJobs = await db.select('ck_audio_jobs', {
        site_id: `eq.${site.id}`,
        status: 'eq.done',
        order: 'created_at.desc',
      })
      const newestByItem = new Map()
      for (const job of audioJobs) {
        if (job.asset_id && !newestByItem.has(job.item_id)) newestByItem.set(job.item_id, job)
      }
      const assetIds = [...newestByItem.values()].map((job) => job.asset_id)
      const assetRows = assetIds.length ? await db.select('ck_assets', { id: inFilter(assetIds) }) : []
      const assetsById = new Map(assetRows.map((asset) => [asset.id, asset]))
      const audio = [...newestByItem.values()]
        .map((job) => {
          const asset = assetsById.get(job.asset_id)
          return asset
            ? {
                item_id: job.item_id,
                url: `/media/${asset.id}/${encodeURIComponent(asset.filename)}`,
                content_type: asset.content_type,
                byte_size: Number(asset.byte_size),
                duration_secs: job.duration_secs,
              }
            : null
        })
        .filter(Boolean)
      // items and overlay ride along for the release manager, which derives the
      // content.published/unpublished webhook events from the pointer
      // transitions the activation is about to make.
      return { site, locales, revisions, comments, audio, items, overlay }
    },
    async listReleases(siteId) {
      const rows = await db.select('ck_releases', { site_id: `eq.${siteId}`, order: 'created_at.desc' })
      return rows.map(
        ({ id, kind, status, reason, revision_ids, file_count, created_at, completed_at, activated_at }) => ({
          id,
          kind,
          status,
          reason,
          revision_ids,
          file_count,
          created_at,
          completed_at,
          activated_at,
        }),
      )
    },
    async getRelease(id) {
      return one('ck_releases', { id: `eq.${id}` })
    },
    async getPreviewByHash(tokenHash) {
      return one('ck_preview_tokens', { token_hash: `eq.${tokenHash}`, revoked_at: 'is.null' })
    },
    async asset(id) {
      return one('ck_assets', { id: `eq.${id}` })
    },
    async createOutbox(siteId, type, resourceKind, resourceId, summary) {
      const site = (await one('ck_sites', { id: `eq.${siteId}` })) || { id: siteId, name: null }
      return enqueueEvent(db, { site, type, resourceKind, resourceId, summary })
    },
    one,
  }
}
