import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { loadConfig } from './config.mjs'
import { createLogger } from './logger.mjs'
import { createStorage } from './storage.mjs'
import { createPostgres } from './postgres.mjs'
import { createRepository } from './repository.mjs'
import { createReleaseManager } from './releases.mjs'
import { createAuth, keyFingerprint } from './auth.mjs'
import { canonicalRequestPath, cleanPath, sha256 } from './utils.mjs'
import { parseJson, parseMultipart, readBody, send, sendJson } from './http.mjs'
import { createOutboxWorker } from './webhooks.mjs'
import { createMetrics } from './metrics.mjs'
import { openApi } from './openapi.mjs'
import { runMigrations } from './db/migrate.mjs'

const SERVICE = {
  name: 'contentkit',
  description: 'API-first Markdown mini-CMS and immutable static-site publisher',
  openapi: '/openapi.json',
  health: '/health',
}

function clientIp(req, trustProxy) {
  if (trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim()
  return req.socket.remoteAddress || 'unknown'
}

function createLimiter(windowMs = 60000, max = 12) {
  const values = new Map()
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, value] of values) if (value.reset <= now) values.delete(key)
  }, windowMs)
  timer.unref?.()
  return {
    take(key) {
      const now = Date.now()
      let value = values.get(key)
      if (!value || value.reset <= now) value = { count: 0, reset: now + windowMs }
      value.count++
      values.set(key, value)
      return value.count <= max
    },
    stop: () => clearInterval(timer),
  }
}

async function verifyTurnstile(config, token, ip) {
  if (!config.turnstileSecret) return process.env.NODE_ENV !== 'production'
  if (!token) return false
  const body = new URLSearchParams({ secret: config.turnstileSecret, response: token, remoteip: ip })
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
  const result = await response.json()
  return Boolean(result.success)
}

function routeName(path) {
  return path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').replace(/\/p\/[^/]+/, '/p/:token')
}

export function createApp(config = loadConfig(), dependencies = {}) {
  const logger = dependencies.logger || createLogger(config)
  const database = dependencies.database || (dependencies.db
    ? { db: dependencies.db, async close() {} }
    : createPostgres(config))
  const db = database.db
  const storage = dependencies.storage || createStorage(config).storage
  const repo = dependencies.repo || createRepository(config, db, storage)
  const releases = dependencies.releases || createReleaseManager(config, repo, db, storage, logger)
  const auth = dependencies.auth || createAuth(config, db)
  const outbox = dependencies.outbox || createOutboxWorker(config, db, logger)
  const limiter = createLimiter()
  const metrics = createMetrics()
  const state = { draining: false, storageReady: false }

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
    if (!auth.authorize(principal, scope, siteId)) {
      logger.warn('unauthorized', { scope, siteId, key: keyFingerprint(req.headers.authorization) })
      sendJson(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' })
      return null
    }
    return principal
  }

  async function publicSubmission(req, res, url, ip) {
    if (!limiter.take(`${ip}:${url.pathname}`)) return sendJson(res, 429, { error: 'rate limit exceeded' }, { 'retry-after': '60' })
    const input = parseJson(await bodyFor(req))
    if (input.website) return sendJson(res, 201, { accepted: true })
    const captcha = input['cf-turnstile-response'] || input.turnstile_token
    if (!(await verifyTurnstile(config, captcha, ip))) return sendJson(res, 422, { error: 'captcha verification failed' })
    const site = await repo.getSite(input.site_id || '')
    if (!site) return sendJson(res, 404, { error: 'site not found' })

    if (url.pathname === '/public/v1/contact') {
      if (!input.name || !input.email || !input.message || String(input.message).length > 10000 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email))) {
        return sendJson(res, 422, { error: 'name, email and message are required' })
      }
      const [record] = await db.insert('ck_contact_submissions', {
        site_id: site.id, name: String(input.name).slice(0, 80),
        email: String(input.email).slice(0, 254), body: String(input.message).slice(0, 10000),
        status: 'new',
      })
      await repo.createOutbox(site.id, 'contentkit.contact.submitted', 'contact', record.id, 'New contact request')
      return sendJson(res, 201, { accepted: true, id: record.id })
    }

    const match = url.pathname.match(/^\/public\/v1\/posts\/([^/]+)\/comments$/)
    if (match) {
      if (!input.name || !input.message || String(input.message).length > 5000) {
        return sendJson(res, 422, { error: 'name and message are required' })
      }
      if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.email))) {
        return sendJson(res, 422, { error: 'email is invalid' })
      }
      const items = await db.select('ck_content_items', { id: `eq.${match[1]}`, site_id: `eq.${site.id}`, kind: 'eq.post', limit: '1' })
      if (!items[0]) return sendJson(res, 404, { error: 'post not found' })
      const [record] = await db.insert('ck_comments', {
        site_id: site.id, content_item_id: match[1], author_name: String(input.name).slice(0, 80),
        author_email: input.email ? String(input.email).slice(0, 254) : null,
        body: String(input.message).slice(0, 5000), status: 'pending',
      })
      await repo.createOutbox(site.id, 'contentkit.comment.submitted', 'comment', record.id, 'New comment awaits moderation')
      return sendJson(res, 201, { accepted: true, id: record.id })
    }
    return sendJson(res, 404, { error: 'not found' })
  }

  async function serveRelease(res, release, requestPath, preview = false, method = 'GET', previewBase = '') {
    const releasePath = canonicalRequestPath(requestPath)
    const objectPath = `${release.storage_prefix}/${releasePath}`
    let response
    try {
      response = await storage.download(objectPath, { head: method === 'HEAD' })
    } catch (error) {
      if (error.status === 404 && requestPath !== '/404.html') {
        return serveRelease(res, release, '/404.html', preview, method, previewBase)
      }
      throw error
    }
    let body = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer())
    const contentType = releasePath.endsWith('.html') ? 'text/html; charset=utf-8'
      : releasePath.endsWith('.xml') ? 'application/xml; charset=utf-8'
        : releasePath.endsWith('.json') ? 'application/json; charset=utf-8'
          : releasePath.endsWith('.css') ? 'text/css; charset=utf-8'
            : releasePath.endsWith('.js') ? 'application/javascript; charset=utf-8'
              : response.headers.get('content-type') || 'application/octet-stream'
    const cacheControl = preview ? 'private,no-store' : (response.headers.get('cache-control') || (contentType.includes('html') ? 'public,max-age=60,must-revalidate' : 'public,max-age=31536000,immutable'))
    if (preview && body.length && (contentType.includes('html') || contentType.includes('css'))) {
      let value = body.toString('utf8')
      if (contentType.includes('html')) {
        value = value
          .replace(/(href|src|data-index)="\/(?!media\/|public\/)/g, `$1="${previewBase}/`)
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
      'content-security-policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'",
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
      send(res, 200, body, { 'content-type': asset.content_type, 'cache-control': 'public,max-age=31536000,immutable', etag: `"${asset.sha256}"` })
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
    await serveRelease(res, release, url.pathname, false, req.method)
    return true
  }

  async function handle(req, res) {
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
    if (req.method === 'GET' && path === '/metrics') return send(res, 200, metrics.render(releases.inflight()), { 'content-type': 'text/plain; version=0.0.4' })
    if (req.method === 'GET' && path === '/openapi.json') return sendJson(res, 200, openApi(config))
    if (req.method === 'GET' && path === '/llms.txt') return send(res, 200, 'Contentkit: Markdown mini-CMS. OpenAPI: /openapi.json\n', { 'content-type': 'text/plain' })
    if (req.method === 'GET' && path === '/' && (req.headers.host || '').split(':')[0] === new URL(config.publicUrl).hostname) return sendJson(res, 200, SERVICE)
    if (req.method === 'POST' && (path === '/public/v1/contact' || /^\/public\/v1\/posts\/[^/]+\/comments$/.test(path))) {
      return publicSubmission(req, res, url, ip)
    }

    if (req.method === 'POST' && path === '/v1/sites') {
      if (!await requireScope(req, res, 'site:admin')) return
      return sendJson(res, 201, await repo.createSite(parseJson(await bodyFor(req))))
    }
    const siteMatch = path.match(/^\/v1\/sites\/([^/]+)$/)
    if (siteMatch && req.method === 'PATCH') {
      const site = await repo.getSite(siteMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!await requireScope(req, res, 'site:admin', site.id)) return
      return sendJson(res, 200, await repo.updateSite(site.id, parseJson(await bodyFor(req))))
    }
    const contentMatch = path.match(/^\/v1\/sites\/([^/]+)\/content$/)
    if (contentMatch) {
      const site = await repo.getSite(contentMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (req.method === 'GET') {
        if (!await requireScope(req, res, 'content:read', site.id)) return
        return sendJson(res, 200, await repo.listContent(site.id, Object.fromEntries(url.searchParams)))
      }
      if (req.method === 'POST') {
        if (!await requireScope(req, res, 'content:write', site.id)) return
        const { markdown, assets } = await markdownRequest(req)
        return sendJson(res, 201, await repo.ingest(site.id, markdown, assets))
      }
    }
    const revisionsMatch = path.match(/^\/v1\/content\/([^/]+)\/revisions$/)
    if (revisionsMatch && ['GET', 'PUT'].includes(req.method)) {
      const items = await db.select('ck_content_items', { id: `eq.${revisionsMatch[1]}`, limit: '1' })
      if (!items[0]) return sendJson(res, 404, { error: 'content item not found' })
      if (req.method === 'GET') {
        if (!await requireScope(req, res, 'content:read', items[0].site_id)) return
        return sendJson(res, 200, await repo.revisions(revisionsMatch[1]))
      }
      if (!await requireScope(req, res, 'content:write', items[0].site_id)) return
      const { markdown, assets } = await markdownRequest(req)
      return sendJson(res, 201, await repo.ingest(items[0].site_id, markdown, assets, items[0].id))
    }
    const previewMatch = path.match(/^\/v1\/sites\/([^/]+)\/previews$/)
    if (previewMatch && req.method === 'POST') {
      const site = await repo.getSite(previewMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!await requireScope(req, res, 'release:write', site.id)) return
      const input = parseJson(await bodyFor(req))
      const started = Date.now()
      const result = await releases.preview({ siteId: site.id, revisionIds: input.revision_ids || [], expiresIn: input.expires_in || 3600, reason: input.reason || '' })
      metrics.build(Date.now() - started)
      return sendJson(res, 201, result)
    }
    const releaseMatch = path.match(/^\/v1\/sites\/([^/]+)\/releases$/)
    if (releaseMatch && req.method === 'POST') {
      const site = await repo.getSite(releaseMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!await requireScope(req, res, 'release:write', site.id)) return
      const input = parseJson(await bodyFor(req))
      const started = Date.now()
      const result = await releases.publish({ siteId: site.id, revisionIds: input.revision_ids || [], reason: input.reason || '' })
      metrics.build(Date.now() - started)
      return sendJson(res, 201, result)
    }
    const activateMatch = path.match(/^\/v1\/sites\/([^/]+)\/releases\/([^/]+)\/activate$/)
    if (activateMatch && req.method === 'POST') {
      const site = await repo.getSite(activateMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!await requireScope(req, res, 'release:write', site.id)) return
      return sendJson(res, 200, await releases.rollback(site.id, activateMatch[2]))
    }
    if (path === '/v1/publish-due' && req.method === 'POST') {
      const principal = await requireScope(req, res, 'release:write')
      if (!principal) return
      const due = await db.select('ck_content_revisions', {
        status: 'eq.scheduled', scheduled_at: `lte.${new Date().toISOString()}`, order: 'scheduled_at.asc',
      })
      const grouped = new Map()
      for (const revision of due) {
        const items = await db.select('ck_content_items', { id: `eq.${revision.item_id}`, limit: '1' })
        const siteId = items[0]?.site_id
        if (!siteId) continue
        if (!auth.authorize(principal, 'release:write', siteId)) continue
        if (!grouped.has(siteId)) grouped.set(siteId, new Map())
        grouped.get(siteId).set(revision.item_id, revision.id)
      }
      const results = []
      for (const [siteId, itemRevisions] of grouped) {
        results.push(await releases.publish({ siteId, revisionIds: [...itemRevisions.values()], reason: 'scheduled publish' }))
      }
      return sendJson(res, 200, { published: results })
    }
    if (path === '/v1/api-keys' && req.method === 'POST') {
      const principal = await requireScope(req, res, 'site:admin')
      if (!principal) return
      const input = parseJson(await bodyFor(req))
      if (!principal.bootstrap && Array.isArray(principal.site_ids) && principal.site_ids.length > 0 &&
          (input.site_ids || []).some((siteId) => !principal.site_ids.includes(siteId))) {
        return sendJson(res, 403, { error: 'cannot grant access to an unowned site' })
      }
      return sendJson(res, 201, await repo.createApiKey(input))
    }
    if (path === '/v1/comments' && req.method === 'GET') {
      const principal = await requireScope(req, res, 'moderation:write')
      if (!principal) return
      const requestedSite = url.searchParams.get('site_id')
      if (requestedSite && !auth.authorize(principal, 'moderation:write', requestedSite)) {
        return sendJson(res, 403, { error: 'site access denied' })
      }
      return sendJson(res, 200, await db.select('ck_comments', {
        ...(requestedSite ? { site_id: `eq.${requestedSite}` }
          : Array.isArray(principal.site_ids) && principal.site_ids.length ? { site_id: `in.(${principal.site_ids.join(',')})` } : {}),
        ...(url.searchParams.get('status') ? { status: `eq.${url.searchParams.get('status')}` } : {}),
        order: 'created_at.desc',
      }))
    }
    const commentMatch = path.match(/^\/v1\/comments\/([^/]+)$/)
    if (commentMatch && req.method === 'PATCH') {
      const existing = await db.select('ck_comments', { id: `eq.${commentMatch[1]}`, limit: '1' })
      if (!existing[0]) return sendJson(res, 404, { error: 'comment not found' })
      if (!await requireScope(req, res, 'moderation:write', existing[0].site_id)) return
      const input = parseJson(await bodyFor(req))
      if (!['approved', 'rejected'].includes(input.status)) return sendJson(res, 422, { error: 'status must be approved or rejected' })
      const rows = await db.update('ck_comments', { id: `eq.${commentMatch[1]}` }, { status: input.status, moderated_at: new Date().toISOString() })
      const record = rows[0]
      if (!record) return sendJson(res, 404, { error: 'comment not found' })
      if (input.status === 'approved') {
        await repo.createOutbox(record.site_id, 'contentkit.comment.approved', 'comment', record.id, 'Comment approved')
      }
      let published = null
      if (input.status === 'approved' && input.publish !== false) published = await releases.publish({ siteId: record.site_id, revisionIds: [], reason: 'comment approved' })
      return sendJson(res, 200, { comment: record, release: published })
    }
    if (path === '/v1/contact-submissions' && req.method === 'GET') {
      const principal = await requireScope(req, res, 'moderation:write')
      if (!principal) return
      const requestedSite = url.searchParams.get('site_id')
      if (requestedSite && !auth.authorize(principal, 'moderation:write', requestedSite)) {
        return sendJson(res, 403, { error: 'site access denied' })
      }
      return sendJson(res, 200, await db.select('ck_contact_submissions', {
        ...(requestedSite ? { site_id: `eq.${requestedSite}` }
          : Array.isArray(principal.site_ids) && principal.site_ids.length ? { site_id: `in.(${principal.site_ids.join(',')})` } : {}),
        order: 'created_at.desc',
      }))
    }
    const contactMatch = path.match(/^\/v1\/contact-submissions\/([^/]+)$/)
    if (contactMatch && req.method === 'PATCH') {
      const existing = await db.select('ck_contact_submissions', { id: `eq.${contactMatch[1]}`, limit: '1' })
      if (!existing[0]) return sendJson(res, 404, { error: 'contact submission not found' })
      if (!await requireScope(req, res, 'moderation:write', existing[0].site_id)) return
      const input = parseJson(await bodyFor(req))
      if (!['read', 'closed'].includes(input.status)) return sendJson(res, 422, { error: 'status must be read or closed' })
      const rows = await db.update('ck_contact_submissions', { id: `eq.${contactMatch[1]}` }, { status: input.status })
      return sendJson(res, 200, rows[0])
    }

    if (await gateway(req, res, url)) return
    return sendJson(res, 404, { error: 'not found' })
  }

  const server = createServer((req, res) => {
    const requestId = randomUUID().slice(0, 12)
    const started = Date.now()
    res.setHeader('x-request-id', requestId)
    res.on('finish', () => {
      const route = routeName((req.url || '').split('?')[0])
      metrics.request(req.method, route, res.statusCode)
      logger.info('request', { requestId, method: req.method, path: route, status: res.statusCode, ms: Date.now() - started })
    })
    handle(req, res).catch((error) => {
      const status = error.statusCode || (error.status >= 400 && error.status < 600 ? error.status : 500)
      logger.error('request failed', { requestId, status, error: String(error.message || error), details: error.details })
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'internal error' : error.message, request_id: requestId })
    })
  })

  return {
    server, state, outbox, limiter, releases, database, handle,
    async ensureStorage() {
      await storage.ensureBucket()
      state.storageReady = true
    },
  }
}

export async function start(config = loadConfig()) {
  const logger = createLogger(config)
  let migrationReport
  try {
    migrationReport = await runMigrations(config, logger)
  } catch (error) {
    logger.error('embedded migrations failed; aborting boot', {
      error: String(error.message || error),
      stack: error.stack,
    })
    throw error
  }
  const app = createApp(config, { logger })
  try {
    await app.ensureStorage()
    logger.info('storage ready', { bucket: config.storageBucket })
  } catch (error) {
    logger.error('storage initialization failed; aborting boot', { error: String(error.message || error) })
    await app.database.close().catch(() => {})
    throw error
  }
  try {
    await new Promise((resolve, reject) => {
      app.server.once('error', reject)
      app.server.listen(config.port, config.host, resolve)
    })
  } catch (error) {
    await app.database.close().catch(() => {})
    throw error
  }
  app.outbox.start()
  logger.info('contentkit listening', {
    url: `http://${config.host}:${config.port}`,
    version: config.version,
    migrations: migrationReport,
  })
  let stopping = false
  async function shutdown(signal) {
    if (stopping) return
    stopping = true
    app.state.draining = true
    app.outbox.stop()
    app.limiter.stop()
    app.server.close(async () => {
      await app.database.close().catch(() => {})
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 30000).unref()
    logger.info('draining', { signal })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  return app
}
