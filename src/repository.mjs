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

  const publicEndpoint = ({ secret_encrypted, ...rest }) => rest

  return {
    enqueueEvent,
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
      const rows = await db.update('ck_sites', { id: `eq.${siteId}` }, allowed)
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
    async revisions(itemId) {
      return db.select('ck_content_revisions', { item_id: `eq.${itemId}`, order: 'created_at.desc' })
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
      if (existingRevision) return { item, revision: existingRevision, assets: [...assetMap.values()] }
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
      return { item, revision, assets: [...assetMap.values()] }
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
      return { site, locales, revisions, comments }
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
