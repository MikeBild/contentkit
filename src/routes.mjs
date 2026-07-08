import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { keyFingerprint } from './auth.mjs'
import { canonicalRequestPath, cleanPath, sha256 } from './utils.mjs'
import { parseJson, parseMultipart, readBody, send, sendJson } from './http.mjs'
import { clientIp, contentCsp, verifyTurnstile } from './security.mjs'
import { openApi } from './openapi.mjs'

export const SERVICE = {
  name: 'contentkit',
  description: 'API-first Markdown mini-CMS and immutable static-site publisher',
  openapi: '/openapi.json',
  llms: '/llms.txt',
  llms_full: '/llms-full.txt',
  health: '/health',
}

function documentation(config, name) {
  return readFileSync(join(config.root, 'docs', name), 'utf8')
}

export function routeName(path) {
  return path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').replace(/\/p\/[^/]+/, '/p/:token')
}

// Method map for the API surface (system, public and /v1 routes). Keep in sync
// with the matches in handle(); gateway-served site paths are intentionally
// absent so OPTIONS/405 handling never shadows a published page.
export const API_ROUTES = [
  { pattern: /^\/health$/, methods: ['GET'] },
  { pattern: /^\/ready$/, methods: ['GET'] },
  { pattern: /^\/metrics$/, methods: ['GET'] },
  { pattern: /^\/openapi\.json$/, methods: ['GET'] },
  { pattern: /^\/llms\.txt$/, methods: ['GET'] },
  { pattern: /^\/llms-full\.txt$/, methods: ['GET'] },
  { pattern: /^\/public\/v1\/contact$/, methods: ['POST'] },
  { pattern: /^\/public\/v1\/posts\/[^/]+\/comments$/, methods: ['POST'] },
  { pattern: /^\/v1\/sites$/, methods: ['POST'] },
  { pattern: /^\/v1\/sites\/[^/]+$/, methods: ['PATCH'] },
  { pattern: /^\/v1\/sites\/[^/]+\/content$/, methods: ['GET', 'POST'] },
  { pattern: /^\/v1\/content\/[^/]+\/revisions$/, methods: ['GET', 'PUT'] },
  { pattern: /^\/v1\/content\/[^/]+\/published$/, methods: ['DELETE'] },
  { pattern: /^\/v1\/sites\/[^/]+\/previews$/, methods: ['POST'] },
  { pattern: /^\/v1\/sites\/[^/]+\/releases$/, methods: ['GET', 'POST'] },
  { pattern: /^\/v1\/sites\/[^/]+\/releases\/[^/]+\/activate$/, methods: ['POST'] },
  { pattern: /^\/v1\/publish-due$/, methods: ['POST'] },
  { pattern: /^\/v1\/maintenance\/storage-gc$/, methods: ['POST'] },
  { pattern: /^\/v1\/api-keys$/, methods: ['POST'] },
  { pattern: /^\/v1\/sites\/[^/]+\/webhooks$/, methods: ['GET', 'POST'] },
  { pattern: /^\/v1\/sites\/[^/]+\/webhooks\/[^/]+$/, methods: ['PATCH', 'DELETE'] },
  { pattern: /^\/v1\/sites\/[^/]+\/webhooks\/[^/]+\/rotate$/, methods: ['POST'] },
  { pattern: /^\/v1\/webhook-deliveries$/, methods: ['GET'] },
  { pattern: /^\/v1\/webhook-deliveries\/[^/]+\/retry$/, methods: ['POST'] },
  { pattern: /^\/v1\/comments$/, methods: ['GET'] },
  { pattern: /^\/v1\/comments\/[^/]+$/, methods: ['PATCH'] },
  { pattern: /^\/v1\/contact-submissions$/, methods: ['GET'] },
  { pattern: /^\/v1\/contact-submissions\/[^/]+$/, methods: ['PATCH'] },
]

// Builds the single request handler from the app's composed dependencies.
// All state (draining/storageReady) and services are owned by createApp.
export function createRequestHandler(ctx) {
  const { config, logger, db, storage, repo, releases, auth, maintenance, limiter, metrics, state } = ctx

  async function bodyFor(req) {
    return readBody(req, config.maxBodyBytes)
  }

  async function markdownRequest(req) {
    const contentType = req.headers['content-type'] || ''
    const raw = await bodyFor(req)
    if (contentType.includes('multipart/form-data')) {
      const parts = parseMultipart(raw, contentType)
      const document = parts.find((part) => part.name === 'document')
      if (!document) throw Object.assign(new Error('multipart field document is required'), { statusCode: 400 })
      return {
        markdown: document.body.toString('utf8'),
        assets: parts.filter((part) => part.name.startsWith('asset:')),
      }
    }
    return { markdown: raw.toString('utf8'), assets: [] }
  }

  async function requireScope(req, res, scope, siteId = null) {
    const principal = await auth.authenticate(req.headers)
    if (!principal) {
      logger.warn('unauthorized', { scope, siteId, key: keyFingerprint(req.headers.authorization) })
      sendJson(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' })
      return null
    }
    if (!auth.authorize(principal, scope, siteId)) {
      logger.warn('insufficient scope', { scope, siteId, key: keyFingerprint(req.headers.authorization) })
      sendJson(res, 403, { error: 'insufficient_scope', scope, ...(siteId ? { site: siteId } : {}) })
      return null
    }
    return principal
  }

  async function publicSubmission(req, res, url, ip) {
    if (!limiter.take(`${ip}:${url.pathname}`))
      return sendJson(res, 429, { error: 'rate limit exceeded' }, { 'retry-after': '60' })
    const input = parseJson(await bodyFor(req))
    if (input.website) return sendJson(res, 201, { accepted: true })
    const commentMatch = url.pathname.match(/^\/public\/v1\/posts\/([^/]+)\/comments$/)
    if (commentMatch) {
      const site = await repo.getSite(input.site_id || '')
      if (!site || site.settings?.comments?.enabled === false) return sendJson(res, 404, { error: 'not found' })
      const captcha = input['cf-turnstile-response'] || input.turnstile_token
      if (!(await verifyTurnstile(config, captcha, ip)))
        return sendJson(res, 422, { error: 'captcha verification failed' })
      if (!input.name || !input.message || String(input.message).length > 5000) {
        return sendJson(res, 422, { error: 'name and message are required' })
      }
      if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email))) {
        return sendJson(res, 422, { error: 'email is invalid' })
      }
      const items = await db.select('ck_content_items', {
        id: `eq.${commentMatch[1]}`,
        site_id: `eq.${site.id}`,
        kind: 'eq.post',
        limit: '1',
      })
      if (!items[0]) return sendJson(res, 404, { error: 'post not found' })
      const record = await db.tx(async (tx) => {
        const [row] = await tx.insert('ck_comments', {
          site_id: site.id,
          content_item_id: commentMatch[1],
          author_name: String(input.name).slice(0, 80),
          author_email: input.email ? String(input.email).slice(0, 254) : null,
          body: String(input.message).slice(0, 5000),
          status: 'pending',
        })
        await repo.enqueueEvent(tx, {
          site,
          type: 'contentkit.comment.submitted',
          resourceKind: 'comment',
          resourceId: row.id,
          summary: 'New comment awaits moderation',
          data: {
            post_id: commentMatch[1],
            author_name: row.author_name,
            author_email: row.author_email,
            body: row.body,
            status: row.status,
          },
        })
        return row
      })
      return sendJson(res, 201, { accepted: true, id: record.id })
    }
    const captcha = input['cf-turnstile-response'] || input.turnstile_token
    if (!(await verifyTurnstile(config, captcha, ip)))
      return sendJson(res, 422, { error: 'captcha verification failed' })
    const site = await repo.getSite(input.site_id || '')
    if (!site) return sendJson(res, 404, { error: 'site not found' })

    if (url.pathname === '/public/v1/contact') {
      if (
        !input.name ||
        !input.email ||
        !input.message ||
        String(input.message).length > 10000 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email))
      ) {
        return sendJson(res, 422, { error: 'name, email and message are required' })
      }
      const record = await db.tx(async (tx) => {
        const [row] = await tx.insert('ck_contact_submissions', {
          site_id: site.id,
          name: String(input.name).slice(0, 80),
          email: String(input.email).slice(0, 254),
          body: String(input.message).slice(0, 10000),
          status: 'new',
        })
        await repo.enqueueEvent(tx, {
          site,
          type: 'contentkit.contact.submitted',
          resourceKind: 'contact',
          resourceId: row.id,
          summary: 'New contact request',
          data: { name: row.name, email: row.email, message: row.body },
        })
        return row
      })
      return sendJson(res, 201, { accepted: true, id: record.id })
    }

    return sendJson(res, 404, { error: 'not found' })
  }

  async function serveRelease(
    res,
    release,
    requestPath,
    preview = false,
    method = 'GET',
    previewBase = '',
    analytics = null,
  ) {
    const releasePath = canonicalRequestPath(requestPath)
    const objectPath = `${release.storage_prefix}/${releasePath}`
    let response
    try {
      response = await storage.download(objectPath, { head: method === 'HEAD' })
    } catch (error) {
      if (error.status === 404 && requestPath !== '/404.html') {
        return serveRelease(res, release, '/404.html', preview, method, previewBase, analytics)
      }
      throw error
    }
    let body = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer())
    const contentType = releasePath.endsWith('.html')
      ? 'text/html; charset=utf-8'
      : releasePath.endsWith('.xml')
        ? 'application/xml; charset=utf-8'
        : releasePath.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : releasePath.endsWith('.css')
            ? 'text/css; charset=utf-8'
            : releasePath.endsWith('.js')
              ? 'application/javascript; charset=utf-8'
              : response.headers.get('content-type') || 'application/octet-stream'
    const cacheControl = preview
      ? 'private,no-store'
      : response.headers.get('cache-control') ||
        (contentType.includes('html') ? 'public,max-age=60,must-revalidate' : 'public,max-age=31536000,immutable')
    if (preview && body.length && (contentType.includes('html') || contentType.includes('css'))) {
      let value = body.toString('utf8')
      if (contentType.includes('html')) {
        value = value.replace(/(href|src|data-index)="\/(?!media\/|public\/)/g, `$1="${previewBase}/`)
      } else {
        value = value.replaceAll('url(/assets/', `url(${previewBase}/assets/`)
      }
      body = Buffer.from(value)
    }
    send(res, requestPath === '/404.html' ? 404 : 200, body, {
      'content-type': contentType,
      'cache-control': cacheControl,
      etag: response.headers.get('etag') || `"${sha256(body)}"`,
      ...(preview ? { 'x-robots-tag': 'noindex,nofollow,noarchive' } : {}),
      'content-security-policy': contentCsp(analytics),
    })
  }

  async function gateway(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) return false
    const preview = url.pathname.match(/^\/p\/([^/]+)(\/.*)?$/)
    if (preview) {
      const tokenHash = sha256(`${config.previewSecret}:${preview[1]}`)
      const token = await repo.getPreviewByHash(tokenHash)
      if (!token || new Date(token.expires_at) <= new Date()) return sendJson(res, 404, { error: 'preview not found' })
      const release = await repo.getRelease(token.release_id)
      await serveRelease(res, release, cleanPath(preview[2] || '/'), true, req.method, `/p/${preview[1]}`)
      return true
    }
    if (url.pathname.startsWith('/media/')) {
      const id = url.pathname.split('/')[2]
      const asset = await repo.asset(id)
      if (!asset) return sendJson(res, 404, { error: 'asset not found' })
      const response = await storage.download(asset.storage_path, { head: req.method === 'HEAD' })
      const body = req.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer())
      // Defence in depth against a hostile/legacy asset content-type: sandbox the
      // response, and force download for anything that isn't a plain image.
      const inlineImage = /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i.test(
        asset.content_type || '',
      )
      send(res, 200, body, {
        'content-type': asset.content_type,
        'cache-control': 'public,max-age=31536000,immutable',
        etag: `"${asset.sha256}"`,
        'content-security-policy': "default-src 'none'; sandbox",
        ...(inlineImage
          ? {}
          : { 'content-disposition': `attachment; filename="${encodeURIComponent(asset.filename || id)}"` }),
      })
      return true
    }
    const site = await repo.getSiteByHost(req.headers.host || '')
    if (!site) return false
    if (!site.active_release_id) return sendJson(res, 503, { error: 'site has no active release' })
    const leaf = url.pathname.split('/').at(-1)
    if (url.pathname !== '/' && !url.pathname.endsWith('/') && !leaf.includes('.')) {
      send(res, 308, '', { location: `${url.pathname}/${url.search}` })
      return true
    }
    const release = await repo.getRelease(site.active_release_id)
    await serveRelease(res, release, url.pathname, false, req.method, '', site.settings?.analytics)
    return true
  }

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const path = cleanPath(url.pathname)
    const ip = clientIp(req, config.trustProxy)

    if (req.method === 'GET' && path === '/health') return send(res, 200, 'ok', { 'content-type': 'text/plain' })
    if (req.method === 'GET' && path === '/ready') {
      const ready = !state.draining && state.storageReady
      return sendJson(res, ready ? 200 : 503, {
        status: state.draining ? 'draining' : ready ? 'ready' : 'initializing',
        version: config.version,
        inflight: releases.inflight(),
      })
    }
    if (req.method === 'GET' && path === '/metrics')
      return send(res, 200, metrics.render(releases.inflight()), { 'content-type': 'text/plain; version=0.0.4' })
    if (req.method === 'GET' && path === '/openapi.json') return sendJson(res, 200, openApi(config))
    if (req.method === 'GET' && path === '/llms.txt')
      return send(res, 200, documentation(config, 'llms.txt'), { 'content-type': 'text/plain; charset=utf-8' })
    if (req.method === 'GET' && path === '/llms-full.txt')
      return send(res, 200, documentation(config, 'llms-full.txt'), { 'content-type': 'text/plain; charset=utf-8' })
    if (
      req.method === 'GET' &&
      path === '/' &&
      (req.headers.host || '').split(':')[0] === new URL(config.publicUrl).hostname
    )
      return sendJson(res, 200, SERVICE)
    if (
      req.method === 'POST' &&
      (path === '/public/v1/contact' || /^\/public\/v1\/posts\/[^/]+\/comments$/.test(path))
    ) {
      return publicSubmission(req, res, url, ip)
    }

    if (req.method === 'POST' && path === '/v1/sites') {
      if (!(await requireScope(req, res, 'site:admin'))) return
      return sendJson(res, 201, await repo.createSite(parseJson(await bodyFor(req))))
    }
    const siteMatch = path.match(/^\/v1\/sites\/([^/]+)$/)
    if (siteMatch && req.method === 'PATCH') {
      const site = await repo.getSite(siteMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'site:admin', site.id))) return
      return sendJson(res, 200, await repo.updateSite(site.id, parseJson(await bodyFor(req))))
    }
    const contentMatch = path.match(/^\/v1\/sites\/([^/]+)\/content$/)
    if (contentMatch) {
      const site = await repo.getSite(contentMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (req.method === 'GET') {
        if (!(await requireScope(req, res, 'content:read', site.id))) return
        return sendJson(res, 200, await repo.listContent(site.id, Object.fromEntries(url.searchParams)))
      }
      if (req.method === 'POST') {
        if (!(await requireScope(req, res, 'content:write', site.id))) return
        const { markdown, assets } = await markdownRequest(req)
        return sendJson(res, 201, await repo.ingest(site.id, markdown, assets))
      }
    }
    const revisionsMatch = path.match(/^\/v1\/content\/([^/]+)\/revisions$/)
    if (revisionsMatch && ['GET', 'PUT'].includes(req.method)) {
      const items = await db.select('ck_content_items', { id: `eq.${revisionsMatch[1]}`, limit: '1' })
      if (!items[0]) return sendJson(res, 404, { error: 'content item not found' })
      if (req.method === 'GET') {
        if (!(await requireScope(req, res, 'content:read', items[0].site_id))) return
        return sendJson(res, 200, await repo.revisions(revisionsMatch[1]))
      }
      if (!(await requireScope(req, res, 'content:write', items[0].site_id))) return
      const { markdown, assets } = await markdownRequest(req)
      return sendJson(res, 201, await repo.ingest(items[0].site_id, markdown, assets, items[0].id))
    }
    const publishedMatch = path.match(/^\/v1\/content\/([^/]+)\/published$/)
    if (publishedMatch && req.method === 'DELETE') {
      const items = await db.select('ck_content_items', { id: `eq.${publishedMatch[1]}`, limit: '1' })
      if (!items[0]) return sendJson(res, 404, { error: 'content item not found' })
      if (!(await requireScope(req, res, 'release:write', items[0].site_id))) return
      if (!items[0].published_revision_id) return sendJson(res, 409, { error: 'item is not published' })
      const started = Date.now()
      const result = await releases.publish({
        siteId: items[0].site_id,
        retireItemIds: [items[0].id],
        reason: 'unpublish',
      })
      metrics.build(Date.now() - started)
      return sendJson(res, 200, { item_id: items[0].id, unpublished: true, release: result })
    }
    const previewMatch = path.match(/^\/v1\/sites\/([^/]+)\/previews$/)
    if (previewMatch && req.method === 'POST') {
      const site = await repo.getSite(previewMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'release:write', site.id))) return
      const input = parseJson(await bodyFor(req))
      const started = Date.now()
      const result = await releases.preview({
        siteId: site.id,
        revisionIds: input.revision_ids || [],
        expiresIn: input.expires_in || 3600,
        reason: input.reason || '',
      })
      metrics.build(Date.now() - started)
      return sendJson(res, 201, result)
    }
    const releaseMatch = path.match(/^\/v1\/sites\/([^/]+)\/releases$/)
    if (releaseMatch && ['GET', 'POST'].includes(req.method)) {
      const site = await repo.getSite(releaseMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (req.method === 'GET') {
        if (!(await requireScope(req, res, 'content:read', site.id))) return
        return sendJson(res, 200, await repo.listReleases(site.id))
      }
      if (!(await requireScope(req, res, 'release:write', site.id))) return
      const input = parseJson(await bodyFor(req))
      const started = Date.now()
      const result = await releases.publish({
        siteId: site.id,
        revisionIds: input.revision_ids || [],
        retireItemIds: input.retire_item_ids || [],
        reason: input.reason || '',
      })
      metrics.build(Date.now() - started)
      return sendJson(res, 201, result)
    }
    const activateMatch = path.match(/^\/v1\/sites\/([^/]+)\/releases\/([^/]+)\/activate$/)
    if (activateMatch && req.method === 'POST') {
      const site = await repo.getSite(activateMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'release:write', site.id))) return
      return sendJson(res, 200, await releases.rollback(site.id, activateMatch[2]))
    }
    if (path === '/v1/publish-due' && req.method === 'POST') {
      const principal = await requireScope(req, res, 'release:write')
      if (!principal) return
      const due = await db.select('ck_content_revisions', {
        status: 'eq.scheduled',
        scheduled_at: `lte.${new Date().toISOString()}`,
        order: 'scheduled_at.asc',
      })
      // Due revisions arrive oldest-first; for each item the latest wins and the
      // earlier due ones become stale, otherwise they'd be re-picked next run and
      // walk the published content backwards over successive runs.
      const grouped = new Map()
      for (const revision of due) {
        const items = await db.select('ck_content_items', { id: `eq.${revision.item_id}`, limit: '1' })
        const siteId = items[0]?.site_id
        if (!siteId) continue
        if (!auth.authorize(principal, 'release:write', siteId)) continue
        if (!grouped.has(siteId)) grouped.set(siteId, { latest: new Map(), stale: new Set() })
        const group = grouped.get(siteId)
        if (group.latest.has(revision.item_id)) group.stale.add(group.latest.get(revision.item_id))
        group.latest.set(revision.item_id, revision.id)
      }
      const results = []
      for (const [siteId, group] of grouped) {
        try {
          const release = await releases.publish({
            siteId,
            revisionIds: [...group.latest.values()],
            reason: 'scheduled publish',
          })
          if (group.stale.size) {
            await db.update(
              'ck_content_revisions',
              { id: `in.(${[...group.stale].join(',')})` },
              { status: 'archived' },
              { returning: false },
            )
          }
          results.push({ site_id: siteId, ...release })
        } catch (error) {
          logger.error('scheduled publish failed', { siteId, error: String(error.message || error) })
          results.push({ site_id: siteId, error: String(error.message || error) })
        }
      }
      return sendJson(res, 200, { published: results })
    }
    if (path === '/v1/maintenance/storage-gc' && req.method === 'POST') {
      const principal = await requireScope(req, res, 'release:write')
      if (!principal) return
      // Global, cron-triggered lifecycle sweep; only an unrestricted key may run it.
      if (Array.isArray(principal.site_ids) && principal.site_ids.length > 0) {
        return sendJson(res, 403, { error: 'storage-gc requires an unrestricted release:write key' })
      }
      return sendJson(res, 200, await maintenance.run())
    }
    if (path === '/v1/api-keys' && req.method === 'POST') {
      const principal = await requireScope(req, res, 'site:admin')
      if (!principal) return
      const input = parseJson(await bodyFor(req))
      if (!principal.bootstrap) {
        // site:admin's job is to provision scoped keys, so it may grant the
        // normal scopes — but never the bootstrap-only global wildcard, and
        // never an implicitly-global or cross-tenant key.
        if ((input.scopes || []).includes('*')) {
          return sendJson(res, 403, { error: 'cannot grant the * (global) scope' })
        }
        if (Array.isArray(principal.site_ids) && principal.site_ids.length > 0) {
          const target = input.site_ids || []
          if (!target.length || target.some((siteId) => !principal.site_ids.includes(siteId))) {
            return sendJson(res, 403, { error: 'key must be scoped to your own site(s)' })
          }
        }
      }
      return sendJson(res, 201, await repo.createApiKey(input))
    }
    const webhooksMatch = path.match(/^\/v1\/sites\/([^/]+)\/webhooks$/)
    if (webhooksMatch && ['GET', 'POST'].includes(req.method)) {
      const site = await repo.getSite(webhooksMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'site:admin', site.id))) return
      if (req.method === 'GET') return sendJson(res, 200, await repo.listWebhookEndpoints(site.id))
      const input = parseJson(await bodyFor(req))
      if (!input.url) return sendJson(res, 422, { error: 'url is required' })
      return sendJson(res, 201, await repo.createWebhookEndpoint(site.id, input))
    }
    const webhookMatch = path.match(/^\/v1\/sites\/([^/]+)\/webhooks\/([^/]+)$/)
    if (webhookMatch && ['PATCH', 'DELETE'].includes(req.method)) {
      const site = await repo.getSite(webhookMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'site:admin', site.id))) return
      if (req.method === 'DELETE') {
        const removed = await repo.deleteWebhookEndpoint(site.id, webhookMatch[2])
        return removed
          ? sendJson(res, 200, { deleted: true })
          : sendJson(res, 404, { error: 'webhook endpoint not found' })
      }
      const updated = await repo.updateWebhookEndpoint(site.id, webhookMatch[2], parseJson(await bodyFor(req)))
      return updated ? sendJson(res, 200, updated) : sendJson(res, 404, { error: 'webhook endpoint not found' })
    }
    const rotateMatch = path.match(/^\/v1\/sites\/([^/]+)\/webhooks\/([^/]+)\/rotate$/)
    if (rotateMatch && req.method === 'POST') {
      const site = await repo.getSite(rotateMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'site:admin', site.id))) return
      const rotated = await repo.rotateWebhookSecret(site.id, rotateMatch[2])
      return rotated ? sendJson(res, 200, rotated) : sendJson(res, 404, { error: 'webhook endpoint not found' })
    }
    if (path === '/v1/webhook-deliveries' && req.method === 'GET') {
      const principal = await requireScope(req, res, 'site:admin')
      if (!principal) return
      const requestedSite = url.searchParams.get('site_id')
      if (requestedSite && !auth.authorize(principal, 'site:admin', requestedSite)) {
        return sendJson(res, 403, { error: 'site access denied' })
      }
      const siteScope =
        requestedSite ||
        (Array.isArray(principal.site_ids) && principal.site_ids.length === 1 ? principal.site_ids[0] : null)
      return sendJson(
        res,
        200,
        await repo.listDeliveries({
          siteId: siteScope,
          endpointId: url.searchParams.get('endpoint'),
          status: url.searchParams.get('status'),
          limit: url.searchParams.get('limit'),
        }),
      )
    }
    const deliveryMatch = path.match(/^\/v1\/webhook-deliveries\/([^/]+)\/retry$/)
    if (deliveryMatch && req.method === 'POST') {
      const delivery = await repo.getDelivery(deliveryMatch[1])
      if (!delivery) return sendJson(res, 404, { error: 'delivery not found' })
      if (!(await requireScope(req, res, 'site:admin', delivery.site_id))) return
      return sendJson(res, 200, await repo.retryDelivery(delivery.id))
    }
    if (path === '/v1/comments' && req.method === 'GET') {
      const principal = await requireScope(req, res, 'moderation:write')
      if (!principal) return
      const requestedSite = url.searchParams.get('site_id')
      if (requestedSite && !auth.authorize(principal, 'moderation:write', requestedSite)) {
        return sendJson(res, 403, { error: 'site access denied' })
      }
      return sendJson(
        res,
        200,
        await db.select('ck_comments', {
          ...(requestedSite
            ? { site_id: `eq.${requestedSite}` }
            : Array.isArray(principal.site_ids) && principal.site_ids.length
              ? { site_id: `in.(${principal.site_ids.join(',')})` }
              : {}),
          ...(url.searchParams.get('status') ? { status: `eq.${url.searchParams.get('status')}` } : {}),
          order: 'created_at.desc',
        }),
      )
    }
    const commentMatch = path.match(/^\/v1\/comments\/([^/]+)$/)
    if (commentMatch && req.method === 'PATCH') {
      const existing = await db.select('ck_comments', { id: `eq.${commentMatch[1]}`, limit: '1' })
      if (!existing[0]) return sendJson(res, 404, { error: 'comment not found' })
      if (!(await requireScope(req, res, 'moderation:write', existing[0].site_id))) return
      const input = parseJson(await bodyFor(req))
      if (!['approved', 'rejected'].includes(input.status))
        return sendJson(res, 422, { error: 'status must be approved or rejected' })
      const rows = await db.update(
        'ck_comments',
        { id: `eq.${commentMatch[1]}` },
        { status: input.status, moderated_at: new Date().toISOString() },
      )
      const record = rows[0]
      if (!record) return sendJson(res, 404, { error: 'comment not found' })
      if (input.status === 'approved') {
        const approvedSite = (await repo.getSite(record.site_id)) || { id: record.site_id, name: null }
        await repo.enqueueEvent(db, {
          site: approvedSite,
          type: 'contentkit.comment.approved',
          resourceKind: 'comment',
          resourceId: record.id,
          summary: 'Comment approved',
          data: { post_id: record.content_item_id, author_name: record.author_name, body: record.body },
        })
      }
      // Approval is authoritative and already committed; the re-render is
      // best-effort. If it fails (e.g. a transient build error), don't 500 —
      // the comment stays approved and the next publish picks it up.
      let published = null
      let publishError = null
      if (input.status === 'approved' && input.publish !== false) {
        try {
          published = await releases.publish({ siteId: record.site_id, revisionIds: [], reason: 'comment approved' })
        } catch (error) {
          publishError = String(error.message || error)
          logger.error('comment approval republish failed', { commentId: record.id, error: publishError })
        }
      }
      return sendJson(res, 200, {
        comment: record,
        release: published,
        ...(publishError ? { republish_error: publishError } : {}),
      })
    }
    if (path === '/v1/contact-submissions' && req.method === 'GET') {
      const principal = await requireScope(req, res, 'moderation:write')
      if (!principal) return
      const requestedSite = url.searchParams.get('site_id')
      if (requestedSite && !auth.authorize(principal, 'moderation:write', requestedSite)) {
        return sendJson(res, 403, { error: 'site access denied' })
      }
      return sendJson(
        res,
        200,
        await db.select('ck_contact_submissions', {
          ...(requestedSite
            ? { site_id: `eq.${requestedSite}` }
            : Array.isArray(principal.site_ids) && principal.site_ids.length
              ? { site_id: `in.(${principal.site_ids.join(',')})` }
              : {}),
          order: 'created_at.desc',
        }),
      )
    }
    const contactMatch = path.match(/^\/v1\/contact-submissions\/([^/]+)$/)
    if (contactMatch && req.method === 'PATCH') {
      const existing = await db.select('ck_contact_submissions', { id: `eq.${contactMatch[1]}`, limit: '1' })
      if (!existing[0]) return sendJson(res, 404, { error: 'contact submission not found' })
      if (!(await requireScope(req, res, 'moderation:write', existing[0].site_id))) return
      const input = parseJson(await bodyFor(req))
      if (!['read', 'closed'].includes(input.status))
        return sendJson(res, 422, { error: 'status must be read or closed' })
      const rows = await db.update('ck_contact_submissions', { id: `eq.${contactMatch[1]}` }, { status: input.status })
      return sendJson(res, 200, rows[0])
    }

    // Unmatched method on a known API path: answer with OPTIONS/405 + Allow
    // instead of falling through to the static gateway's opaque 404.
    const known = API_ROUTES.find((route) => route.pattern.test(path))
    if (known) {
      const allow = [...known.methods, 'OPTIONS'].join(', ')
      if (req.method === 'OPTIONS') return send(res, 204, '', { allow })
      return sendJson(res, 405, { error: 'method not allowed' }, { allow })
    }

    if (await gateway(req, res, url)) return
    return sendJson(res, 404, { error: 'not found' })
  }
}
