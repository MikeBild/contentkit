import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { keyFingerprint } from './auth.mjs'
import { canonicalRequestPath, cleanPath, escapeHtml, hmac256, safeEqual, sha256 } from './utils.mjs'
import { parseByteRange, parseJson, parseMultipart, readBody, send, sendJson } from './http.mjs'
import { clientIp, contentCsp, verifyTurnstile } from './security.mjs'
import { openApi } from './openapi.mjs'
import {
  getAudioStats,
  getContentStats,
  getEngagementStats,
  getReaderStats,
  getReleaseStats,
  getWebhookStats,
  resolveStatsWindow,
} from './stats.mjs'
import {
  clearSessionCookie,
  INSECURE_READER_COOKIE,
  mostSpecificAccess,
  parseCookies,
  readerAllowed,
  READER_COOKIE,
  sessionCookie,
  validReturnTo,
} from './access.mjs'

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

// Content types for gateway-served release objects. Order matters: `feed.xml`
// must be tested before the generic `.xml` suffix, because every
// `<link rel="alternate" type="application/rss+xml">` the builder emits
// advertises that type and serving application/xml contradicts it. sitemap.xml
// keeps application/xml. Returns undefined for unknown suffixes so the caller
// can fall back to the stored object's own content-type.
const RELEASE_CONTENT_TYPES = [
  ['.html', 'text/html; charset=utf-8'],
  ['feed.xml', 'application/rss+xml; charset=utf-8'],
  ['blogcast.xml', 'application/rss+xml; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
]

export function releaseContentType(releasePath) {
  return RELEASE_CONTENT_TYPES.find(([suffix]) => releasePath.endsWith(suffix))?.[1]
}

// One deployment serves the admin API *and* every published tenant site, on
// different hostnames. Routes that describe contentkit itself — its docs, its
// OpenAPI spec, its metrics — belong to the API host alone. Served
// unconditionally they answer on every customer domain, where `/llms.txt` means
// "describe this site", not "describe the CMS that built it".
//
// Deliberately NOT applied to /health and /ready: supervisors and load balancers
// probe them over the loopback or a pod IP, so the Host header never matches
// publicUrl. Gating them would keep readiness permanently down. They also must
// not depend on a database lookup, which rules out resolving the host to a site.
export function isApiHost(req, config) {
  return (req.headers.host || '').split(':')[0] === new URL(config.publicUrl).hostname
}

// Method map for the API surface (system, public and /v1 routes). Keep in sync
// with the matches in handle(); gateway-served site paths are intentionally
// absent so OPTIONS/405 handling never shadows a published page.
//
// `apiHostOnly` entries exist only on the API host. Off it they must not reach the
// 405/OPTIONS fallback at all: `/llms.txt` on a site host has to fall through to
// the gateway (which serves that site's own file), and answering `405 Allow: GET`
// there would both break it and advertise a route the site does not have.
// `/health` and `/ready` stay host-independent because probes reach them by IP.
export const API_ROUTES = [
  { pattern: /^\/health$/, methods: ['GET'] },
  { pattern: /^\/ready$/, methods: ['GET'] },
  { pattern: /^\/metrics$/, methods: ['GET'], apiHostOnly: true },
  { pattern: /^\/openapi\.json$/, methods: ['GET'], apiHostOnly: true },
  { pattern: /^\/llms\.txt$/, methods: ['GET'], apiHostOnly: true },
  { pattern: /^\/llms-full\.txt$/, methods: ['GET'], apiHostOnly: true },
  { pattern: /^\/public\/v1\/contact$/, methods: ['POST'] },
  { pattern: /^\/public\/v1\/posts\/[^/]+\/comments$/, methods: ['POST'] },
  { pattern: /^\/public\/v1\/posts\/[^/]+\/feedback$/, methods: ['POST'] },
  { pattern: /^\/_contentkit\/login$/, methods: ['GET', 'POST'] },
  { pattern: /^\/_contentkit\/logout$/, methods: ['POST'] },
  { pattern: /^\/_contentkit\/(session|navigation\.json|search-index\.json)$/, methods: ['GET'] },
  { pattern: /^\/v1\/sites$/, methods: ['POST'] },
  { pattern: /^\/v1\/sites\/[^/]+$/, methods: ['GET', 'PATCH'] },
  { pattern: /^\/v1\/sites\/[^/]+\/content$/, methods: ['GET', 'POST'] },
  { pattern: /^\/v1\/sites\/[^/]+\/published$/, methods: ['GET'] },
  { pattern: /^\/v1\/sites\/[^/]+\/published\/[^/]+\/[^/]+\/[^/]+$/, methods: ['GET'] },
  { pattern: /^\/v1\/sites\/[^/]+\/search$/, methods: ['GET'] },
  { pattern: /^\/v1\/content\/[^/]+\/revisions$/, methods: ['GET', 'PUT'] },
  { pattern: /^\/v1\/content\/[^/]+\/published$/, methods: ['DELETE'] },
  { pattern: /^\/v1\/content\/[^/]+\/audio$/, methods: ['GET', 'DELETE'] },
  { pattern: /^\/v1\/sites\/[^/]+\/audio\/backfill$/, methods: ['POST'] },
  { pattern: /^\/v1\/sites\/[^/]+\/audio\/jobs$/, methods: ['GET'] },
  { pattern: /^\/v1\/sites\/[^/]+\/access\/(users|groups|rules)$/, methods: ['GET', 'POST'] },
  { pattern: /^\/v1\/sites\/[^/]+\/access\/(users|groups|rules)\/[^/]+$/, methods: ['PATCH', 'DELETE'] },
  { pattern: /^\/v1\/sites\/[^/]+\/access\/users\/[^/]+\/revoke-sessions$/, methods: ['POST'] },
  { pattern: /^\/v1\/sites\/[^/]+\/access\/groups\/[^/]+\/members$/, methods: ['PUT'] },
  { pattern: /^\/v1\/sites\/[^/]+\/previews$/, methods: ['POST'] },
  { pattern: /^\/v1\/sites\/[^/]+\/releases$/, methods: ['GET', 'POST'] },
  {
    pattern: /^\/v1\/sites\/[^/]+\/stats\/(releases|content|readers|webhooks|audio|engagement)$/,
    methods: ['GET'],
  },
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
  { pattern: /^\/v1\/feedback$/, methods: ['GET'] },
]

// Builds the single request handler from the app's composed dependencies.
// All state (draining/storageReady) and services are owned by createApp.
export function createRequestHandler(ctx) {
  const { config, logger, db, storage, repo, releases, auth, maintenance, limiter, metrics, state, audio } = ctx
  const loginLimiter = ctx.loginLimiter || limiter

  async function recordReaderAuth(siteId, outcome) {
    if (!db.insert) return
    await db
      .insert('ck_reader_auth_events', { site_id: siteId, outcome }, { returning: false })
      .catch((error) => logger.warn('reader auth metric write failed', { siteId, error: String(error) }))
  }

  async function bodyFor(req) {
    return readBody(req, config.maxBodyBytes)
  }

  const secureCookies = (site) => String(site?.base_url || '').startsWith('https://')
  const csrfCookieName = (site) => (secureCookies(site) ? '__Host-contentkit_csrf' : 'contentkit_csrf')
  const signedCsrf = () => {
    const token = randomBytes(24).toString('base64url')
    return `${token}.${hmac256(config.sessionSecret || config.previewSecret || 'development', token)}`
  }
  const validCsrf = (req, value, site) => {
    const cookie = parseCookies(req.headers.cookie || '')[csrfCookieName(site)] || ''
    const [token, signature] = cookie.split('.')
    return Boolean(
      token &&
      signature &&
      safeEqual(cookie, value) &&
      safeEqual(signature, hmac256(config.sessionSecret || config.previewSecret || 'development', token)),
    )
  }
  const csrfCookie = (value, site) =>
    `${csrfCookieName(site)}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secureCookies(site) ? '; Secure' : ''}`
  const parseInput = async (req) => {
    const body = await bodyFor(req)
    if ((req.headers['content-type'] || '').includes('application/json')) return parseJson(body)
    return Object.fromEntries(new URLSearchParams(body.toString('utf8')))
  }
  const readerFor = async (req, site) => {
    const cookies = parseCookies(req.headers.cookie || '')
    const token = cookies[READER_COOKIE] || cookies[INSECURE_READER_COOKIE]
    return repo.authenticateReader ? repo.authenticateReader(site.id, token) : null
  }
  const accessFor = async (req, site, release, pathname) => {
    const entries = repo.releaseAccessEntries ? await repo.releaseAccessEntries(release.id) : []
    const normalized = cleanPath(pathname)
    const entry =
      mostSpecificAccess(entries, normalized) ||
      (normalized.endsWith('/index.html')
        ? mostSpecificAccess(entries, normalized.slice(0, -'index.html'.length))
        : null)
    if (!entry) return { entry: null, reader: null, allowed: true }
    const reader = await readerFor(req, site)
    return { entry, reader, allowed: readerAllowed(entry, reader) }
  }
  const loginPage = (site, csrf, returnTo, error = '') =>
    `<!doctype html><html lang="${escapeHtml(site.default_locale || 'en')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in · ${escapeHtml(site.name)}</title><style>body{font:16px system-ui;margin:0;display:grid;min-height:100vh;place-items:center;background:#f6f7f9;color:#172033}.login{width:min(90%,24rem);background:white;padding:2rem;border:1px solid #dde1e8;border-radius:.75rem;box-shadow:0 1rem 3rem #17203318}label,input,button{display:block;width:100%;box-sizing:border-box}label{margin-top:1rem}input,button{font:inherit;padding:.75rem;margin-top:.35rem;border:1px solid #ccd2dc;border-radius:.5rem}button{margin-top:1.25rem;background:#172033;color:white;cursor:pointer}.error{color:#a21b1b}</style></head><body><main class="login"><h1>${escapeHtml(site.name)}</h1><p>Sign in to continue.</p>${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}<form method="post" action="/_contentkit/login"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></main></body></html>`
  const loginHeaders = (csrf, site) => ({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private,no-store',
    'set-cookie': csrfCookie(csrf, site),
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  })

  async function readerRoutes(req, res, url, path, ip) {
    if (!path.startsWith('/_contentkit/')) return false
    const methods = {
      '/_contentkit/login': ['GET', 'POST'],
      '/_contentkit/logout': ['POST'],
      '/_contentkit/session': ['GET'],
      '/_contentkit/navigation.json': ['GET'],
      '/_contentkit/search-index.json': ['GET'],
    }[path]
    if (!methods) return sendJson(res, 404, { error: 'not found' })
    const allow = [...methods, 'OPTIONS'].join(', ')
    if (req.method === 'OPTIONS') return send(res, 204, '', { allow })
    if (!methods.includes(req.method)) return sendJson(res, 405, { error: 'method not allowed' }, { allow })
    const site = await repo.getSiteByHost(req.headers.host || '')
    if (!site) return sendJson(res, 404, { error: 'not found' })
    const cookies = parseCookies(req.headers.cookie || '')
    const token = cookies[READER_COOKIE] || cookies[INSECURE_READER_COOKIE]
    if (path === '/_contentkit/login') {
      const returnTo = validReturnTo(url.searchParams.get('return_to'), `/${site.default_locale}/`)
      if (req.method === 'GET') {
        const csrf = signedCsrf()
        return send(res, 200, loginPage(site, csrf, returnTo), loginHeaders(csrf, site))
      }
      const input = await parseInput(req)
      if (!validCsrf(req, input.csrf, site)) return sendJson(res, 403, { error: 'invalid csrf token' })
      const attemptedUsername = String(input.username || '')
        .trim()
        .toLowerCase()
        .slice(0, 64)
      const ipAllowed = loginLimiter.take(`reader-login-ip:${ip}`)
      const usernameAllowed = loginLimiter.take(`reader-login-user:${site.id}:${attemptedUsername}`)
      if (!ipAllowed || !usernameAllowed) {
        await recordReaderAuth(site.id, 'rate_limited')
        return sendJson(res, 429, { error: 'rate limit exceeded' }, { 'retry-after': '900' })
      }
      const session = await repo.createReaderSession(site.id, input.username, input.password)
      await recordReaderAuth(site.id, session ? 'success' : 'failed')
      if (!session) {
        const csrf = signedCsrf()
        return send(
          res,
          401,
          loginPage(site, csrf, validReturnTo(input.return_to, returnTo), 'Username or password is incorrect.'),
          loginHeaders(csrf, site),
        )
      }
      return send(res, 303, '', {
        location: validReturnTo(input.return_to, `/${site.default_locale}/`),
        'cache-control': 'private,no-store',
        'set-cookie': sessionCookie(session.token, { secure: secureCookies(site) }),
      })
    }
    if (path === '/_contentkit/logout' && req.method === 'POST') {
      await repo.revokeReaderSession?.(site.id, token)
      return send(res, 303, '', {
        location: `/${site.default_locale}/`,
        'cache-control': 'private,no-store',
        'set-cookie': clearSessionCookie({ secure: secureCookies(site) }),
      })
    }
    const reader = await readerFor(req, site)
    if (!reader)
      return sendJson(res, 401, { error: 'reader authentication required' }, { 'cache-control': 'private,no-store' })
    if (path === '/_contentkit/session') {
      return sendJson(
        res,
        200,
        {
          authenticated: true,
          user: { id: reader.id, username: reader.username, display_name: reader.display_name },
          groups: reader.groups,
        },
        { 'cache-control': 'private,no-store' },
      )
    }
    if (!site.active_release_id) return sendJson(res, 503, { error: 'site has no active release' })
    const catalog = await repo.releaseAccessCatalog(site.active_release_id, url.searchParams.get('locale') || undefined)
    const visible = catalog.filter((entry) => readerAllowed(entry, reader))
    if (path === '/_contentkit/navigation.json') {
      return sendJson(
        res,
        200,
        visible.map(({ search_text, group_slugs, user_ids, ...entry }) => entry),
        { 'cache-control': 'private,no-store' },
      )
    }
    if (path === '/_contentkit/search-index.json') {
      return sendJson(
        res,
        200,
        visible.map((entry) => ({
          title: entry.title,
          summary: entry.summary,
          url: entry.url,
          text: entry.search_text,
        })),
        { 'cache-control': 'private,no-store' },
      )
    }
    return sendJson(res, 404, { error: 'not found' })
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

  // authorize() has no scope hierarchy, so a site:admin key holds none of the
  // read scopes. Reading a site before patching it would otherwise be impossible
  // with the very key that is allowed to patch.
  async function requireAnyScope(req, res, scopes, siteId = null) {
    const principal = await auth.authenticate(req.headers)
    if (!principal) {
      logger.warn('unauthorized', { scope: scopes.join('|'), siteId, key: keyFingerprint(req.headers.authorization) })
      sendJson(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' })
      return null
    }
    if (!scopes.some((scope) => auth.authorize(principal, scope, siteId))) {
      logger.warn('insufficient scope', {
        scope: scopes.join('|'),
        siteId,
        key: keyFingerprint(req.headers.authorization),
      })
      sendJson(res, 403, { error: 'insufficient_scope', scope: scopes, ...(siteId ? { site: siteId } : {}) })
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
      if (site.active_release_id && repo.releaseAccessEntries) {
        const entries = await repo.releaseAccessEntries(site.active_release_id)
        const entry = entries.find((candidate) => candidate.content_item_id === items[0].id)
        if (entry) {
          const reader = await readerFor(req, site)
          if (!reader) return sendJson(res, 401, { error: 'reader authentication required' })
          if (!readerAllowed(entry, reader)) return sendJson(res, 403, { error: 'reader access denied' })
        }
      }
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
    const feedbackMatch = url.pathname.match(/^\/public\/v1\/posts\/([^/]+)\/feedback$/)
    if (feedbackMatch) {
      // Deliberately no Turnstile: the payload is an enum-only anonymous vote,
      // so the honeypot and the per-IP limiter above already bound abuse to
      // noise a CAPTCHA would not prevent. Opt-in, unlike comments' opt-out —
      // a vote writes to the database on every reader click.
      const site = await repo.getSite(input.site_id || '')
      if (!site || site.settings?.feedback?.enabled !== true) return sendJson(res, 404, { error: 'not found' })
      if (!['up', 'down'].includes(input.vote)) return sendJson(res, 422, { error: 'vote must be up or down' })
      const items = await db.select('ck_content_items', {
        id: `eq.${feedbackMatch[1]}`,
        site_id: `eq.${site.id}`,
        kind: 'eq.post',
        limit: '1',
      })
      if (!items[0]) return sendJson(res, 404, { error: 'post not found' })
      if (site.active_release_id && repo.releaseAccessEntries) {
        const entries = await repo.releaseAccessEntries(site.active_release_id)
        const entry = entries.find((candidate) => candidate.content_item_id === items[0].id)
        if (entry) {
          const reader = await readerFor(req, site)
          if (!reader) return sendJson(res, 401, { error: 'reader authentication required' })
          if (!readerAllowed(entry, reader)) return sendJson(res, 403, { error: 'reader access denied' })
        }
      }
      // No outbox event: votes are anonymous and unmoderatable, and a webhook
      // per thumb-click is noise. Without the event there is nothing to keep
      // atomic, so the insert also skips db.tx.
      const [row] = await db.insert('ck_post_feedback', {
        site_id: site.id,
        content_item_id: feedbackMatch[1],
        vote: input.vote,
      })
      return sendJson(res, 201, { accepted: true, id: row.id })
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
    privateAccess = false,
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
    const contentType =
      releaseContentType(releasePath) || response.headers.get('content-type') || 'application/octet-stream'
    const cacheControl =
      preview || privateAccess
        ? 'private,no-store'
        : response.headers.get('cache-control') ||
          (contentType.includes('html') ? 'public,max-age=60,must-revalidate' : 'public,max-age=31536000,immutable')
    if (preview && body.length && (contentType.includes('html') || contentType.includes('css'))) {
      let value = body.toString('utf8')
      if (contentType.includes('html')) {
        // `action` covers the header search form; the lookahead keeps the public
        // contact/comment endpoints pointing at the real API.
        value = value.replace(/(href|src|action|data-index)="\/(?!media\/|public\/)/g, `$1="${previewBase}/`)
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
    const site = await repo.getSiteByHost(req.headers.host || '')
    if (url.pathname.startsWith('/media/')) {
      if (site?.active_release_id && repo.releaseAccessEntries) {
        const release = await repo.getRelease(site.active_release_id)
        const access = await accessFor(req, site, release, url.pathname)
        if (access.entry && !access.reader) {
          return sendJson(
            res,
            401,
            { error: 'reader authentication required' },
            { 'cache-control': 'private,no-store' },
          )
        }
        if (!access.allowed)
          return sendJson(res, 403, { error: 'reader access denied' }, { 'cache-control': 'private,no-store' })
      }
      const id = url.pathname.split('/')[2]
      const asset = await repo.asset(id)
      if (!asset) return sendJson(res, 404, { error: 'asset not found' })
      // Defence in depth against a hostile/legacy asset content-type: sandbox the
      // response, and force download for anything that isn't a plain image or a
      // plain audio type. Audio must be inline — the read-aloud <audio> element
      // streams it from here, and an attachment disposition would break playback.
      const inlineMedia =
        /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i.test(asset.content_type || '') ||
        /^audio\/(mpeg|mp4|ogg|wav|aac|flac|webm)$/i.test(asset.content_type || '')
      const headers = {
        'content-type': asset.content_type,
        'cache-control': 'public,max-age=31536000,immutable',
        etag: `"${asset.sha256}"`,
        // Without this a browser treats the resource as one indivisible stream:
        // it will play an <audio> from the top but refuse to seek within it, so
        // the read-aloud player's scrubber and ±15 s buttons do nothing.
        'accept-ranges': 'bytes',
        'content-security-policy': "default-src 'none'; sandbox",
        ...(inlineMedia
          ? {}
          : { 'content-disposition': `attachment; filename="${encodeURIComponent(asset.filename || id)}"` }),
      }

      // byte_size is the authoritative length; only fall back to asking the store
      // for rows that predate the column.
      const declared = Number(asset.byte_size)
      let total = Number.isFinite(declared) && declared > 0 ? declared : 0
      if (!total) {
        const probe = await storage.download(asset.storage_path, { head: true })
        total = Number(probe.headers.get('content-length')) || 0
      }

      if (req.method === 'HEAD') {
        send(res, 200, Buffer.alloc(0), { ...headers, 'content-length': String(total) })
        return true
      }

      const range = parseByteRange(req.headers.range, total)
      if (range === 'unsatisfiable') {
        send(res, 416, '', { ...headers, 'content-range': `bytes */${total}` })
        return true
      }
      if (!range) {
        const response = await storage.download(asset.storage_path)
        send(res, 200, Buffer.from(await response.arrayBuffer()), headers)
        return true
      }

      // Ask the store for just the slice. A store that honours the range answers
      // 206 with exactly those bytes; one that ignores it answers 200 with the
      // whole object, which we then slice ourselves — so seeking works on every
      // backend, at worst costing a full fetch.
      const response = await storage.download(asset.storage_path, {
        range: `bytes=${range.start}-${range.end}`,
      })
      const payload = Buffer.from(await response.arrayBuffer())
      const body = response.status === 206 ? payload : payload.subarray(range.start, range.end + 1)
      send(res, 206, body, { ...headers, 'content-range': `bytes ${range.start}-${range.end}/${total}` })
      return true
    }
    if (!site) return false
    if (!site.active_release_id) return sendJson(res, 503, { error: 'site has no active release' })
    const leaf = url.pathname.split('/').at(-1)
    if (url.pathname !== '/' && !url.pathname.endsWith('/') && !leaf.includes('.')) {
      send(res, 308, '', { location: `${url.pathname}/${url.search}` })
      return true
    }
    const release = await repo.getRelease(site.active_release_id)
    const access = await accessFor(req, site, release, url.pathname)
    if (access.entry && !access.reader) {
      const returnTo = encodeURIComponent(`${url.pathname}${url.search}`)
      return send(res, 302, '', {
        location: `/_contentkit/login?return_to=${returnTo}`,
        'cache-control': 'private,no-store',
      })
    }
    if (!access.allowed)
      return sendJson(res, 403, { error: 'reader access denied' }, { 'cache-control': 'private,no-store' })
    await serveRelease(
      res,
      release,
      url.pathname,
      false,
      req.method,
      '',
      site.settings?.analytics,
      Boolean(access.entry),
    )
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
    // Everything below is scoped to the API host. On a site host these paths fall
    // through to the gateway, which serves the release's own llms.txt/robots.txt
    // or a 404 — never contentkit's documentation or its request telemetry.
    const apiHost = isApiHost(req, config)
    if (apiHost && req.method === 'GET' && path === '/metrics')
      return send(res, 200, metrics.render(releases.inflight()), { 'content-type': 'text/plain; version=0.0.4' })
    if (apiHost && req.method === 'GET' && path === '/openapi.json') return sendJson(res, 200, openApi(config))
    if (apiHost && req.method === 'GET' && path === '/llms.txt')
      return send(res, 200, documentation(config, 'llms.txt'), { 'content-type': 'text/plain; charset=utf-8' })
    if (apiHost && req.method === 'GET' && path === '/llms-full.txt')
      return send(res, 200, documentation(config, 'llms-full.txt'), { 'content-type': 'text/plain; charset=utf-8' })
    if (apiHost && req.method === 'GET' && path === '/') return sendJson(res, 200, SERVICE)
    if (path.startsWith('/_contentkit/')) return readerRoutes(req, res, url, path, ip)
    if (
      req.method === 'POST' &&
      (path === '/public/v1/contact' || /^\/public\/v1\/posts\/[^/]+\/(comments|feedback)$/.test(path))
    ) {
      return publicSubmission(req, res, url, ip)
    }

    if (req.method === 'POST' && path === '/v1/sites') {
      if (!(await requireScope(req, res, 'site:admin'))) return
      return sendJson(res, 201, await repo.createSite(parseJson(await bodyFor(req))))
    }
    const siteMatch = path.match(/^\/v1\/sites\/([^/]+)$/)
    if (siteMatch && ['GET', 'PATCH'].includes(req.method)) {
      const site = await repo.getSite(siteMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (req.method === 'GET') {
        // PATCH replaces `settings` wholesale, so a caller that means to change one
        // key must first read the whole object. Without this route that read is
        // impossible over HTTP and every partial update silently drops the rest.
        if (!(await requireAnyScope(req, res, ['content:read', 'site:admin'], site.id))) return
        return sendJson(res, 200, site)
      }
      if (!(await requireScope(req, res, 'site:admin', site.id))) return
      return sendJson(res, 200, await repo.updateSite(site.id, parseJson(await bodyFor(req))))
    }
    const statsMatch = path.match(/^\/v1\/sites\/([^/]+)\/stats\/(releases|content|readers|webhooks|audio|engagement)$/)
    if (statsMatch && req.method === 'GET') {
      const site = await repo.getSite(statsMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'content:read', site.id))) return
      const window = resolveStatsWindow(Object.fromEntries(url.searchParams))
      const readers = {
        releases: getReleaseStats,
        content: getContentStats,
        readers: getReaderStats,
        webhooks: getWebhookStats,
        audio: getAudioStats,
        engagement: getEngagementStats,
      }
      return sendJson(res, 200, await readers[statsMatch[2]](db, site.id, window), {
        'cache-control': 'private,max-age=60',
      })
    }
    const accessCollection = path.match(/^\/v1\/sites\/([^/]+)\/access\/(users|groups|rules)$/)
    if (accessCollection && ['GET', 'POST'].includes(req.method)) {
      const site = await repo.getSite(accessCollection[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'site:admin', site.id))) return
      const kind = accessCollection[2]
      if (req.method === 'GET') {
        const rows =
          kind === 'users'
            ? await repo.listAccessUsers(site.id)
            : kind === 'groups'
              ? await repo.listAccessGroups(site.id)
              : await repo.listAccessRules(site.id)
        return sendJson(res, 200, rows)
      }
      const input = parseJson(await bodyFor(req))
      const record =
        kind === 'users'
          ? await repo.createAccessUser(site.id, input)
          : kind === 'groups'
            ? await repo.createAccessGroup(site.id, input)
            : await repo.createAccessRule(site.id, input)
      return sendJson(res, 201, record)
    }
    const accessRevoke = path.match(/^\/v1\/sites\/([^/]+)\/access\/users\/([^/]+)\/revoke-sessions$/)
    if (accessRevoke && req.method === 'POST') {
      const site = await repo.getSite(accessRevoke[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'site:admin', site.id))) return
      return sendJson(res, 200, await repo.revokeReaderSessions(site.id, accessRevoke[2]))
    }
    const accessMembers = path.match(/^\/v1\/sites\/([^/]+)\/access\/groups\/([^/]+)\/members$/)
    if (accessMembers && req.method === 'PUT') {
      const site = await repo.getSite(accessMembers[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'site:admin', site.id))) return
      const record = await repo.setAccessGroupMembers(
        site.id,
        accessMembers[2],
        parseJson(await bodyFor(req)).user_ids || [],
      )
      return record ? sendJson(res, 200, record) : sendJson(res, 404, { error: 'access group not found' })
    }
    const accessItem = path.match(/^\/v1\/sites\/([^/]+)\/access\/(users|groups|rules)\/([^/]+)$/)
    if (accessItem && ['PATCH', 'DELETE'].includes(req.method)) {
      const site = await repo.getSite(accessItem[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'site:admin', site.id))) return
      const [, , kind, id] = accessItem
      if (req.method === 'DELETE') {
        const deleted =
          kind === 'users'
            ? await repo.deleteAccessUser(site.id, id)
            : kind === 'groups'
              ? await repo.deleteAccessGroup(site.id, id)
              : await repo.deleteAccessRule(site.id, id)
        return deleted
          ? sendJson(res, 200, { deleted: true, ...(kind === 'rules' ? { rebuild_required: true } : {}) })
          : sendJson(res, 404, { error: `access ${kind.slice(0, -1)} not found` })
      }
      const input = parseJson(await bodyFor(req))
      const record =
        kind === 'users'
          ? await repo.updateAccessUser(site.id, id, input)
          : kind === 'groups'
            ? await repo.updateAccessGroup(site.id, id, input)
            : await repo.updateAccessRule(site.id, id, input)
      return record
        ? sendJson(res, 200, record)
        : sendJson(res, 404, { error: `access ${kind.slice(0, -1)} not found` })
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
    // Optional headless read API: published content as JSON, on the management
    // API behind content:read scoped keys — site delivery itself stays static.
    const publishedListMatch = path.match(/^\/v1\/sites\/([^/]+)\/published$/)
    if (publishedListMatch && req.method === 'GET') {
      const site = await repo.getSite(publishedListMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'content:read', site.id))) return
      // publish_epoch bumps on every activation, so it versions exactly "what
      // is published" — a weak ETag over the whole list, matched before the
      // query work happens.
      const etag = `W/"${site.publish_epoch}"`
      if (req.headers['if-none-match'] === etag) return send(res, 304, '', { etag })
      return sendJson(res, 200, await repo.listPublished(site.id, Object.fromEntries(url.searchParams)), { etag })
    }
    const publishedDocMatch = path.match(/^\/v1\/sites\/([^/]+)\/published\/([^/]+)\/([^/]+)\/([^/]+)$/)
    if (publishedDocMatch && req.method === 'GET') {
      const site = await repo.getSite(publishedDocMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'content:read', site.id))) return
      const record = await repo.getPublished(site.id, publishedDocMatch[2], publishedDocMatch[3], publishedDocMatch[4])
      if (!record) return sendJson(res, 404, { error: 'published content not found' })
      // Strong ETag: the source hash names the revision bytes, the service
      // version covers renderer changes that alter the on-demand HTML.
      const { source_sha256: sourceHash, ...body } = record
      const etag = `"${sourceHash}:${config.version}"`
      if (req.headers['if-none-match'] === etag) return send(res, 304, '', { etag })
      return sendJson(res, 200, body, { etag })
    }
    // Server-side full-text search over published content — an API-host feature
    // for headless consumers. Published sites keep their static client-side
    // search (search-index.json); nothing here is wired into site delivery.
    const searchMatch = path.match(/^\/v1\/sites\/([^/]+)\/search$/)
    if (searchMatch && req.method === 'GET') {
      const site = await repo.getSite(searchMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'content:read', site.id))) return
      // No ETag or cache headers: ranking and headlines depend on the query
      // text, not on a stored artifact a version could name.
      return sendJson(res, 200, await repo.searchPublished(site.id, Object.fromEntries(url.searchParams)))
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
    const audioStatusMatch = path.match(/^\/v1\/content\/([^/]+)\/audio$/)
    if (audioStatusMatch && ['GET', 'DELETE'].includes(req.method)) {
      const items = await db.select('ck_content_items', { id: `eq.${audioStatusMatch[1]}`, limit: '1' })
      if (!items[0]) return sendJson(res, 404, { error: 'content item not found' })
      if (req.method === 'GET') {
        if (!(await requireScope(req, res, 'content:read', items[0].site_id))) return
        return sendJson(res, 200, await audio.status(items[0].id))
      }
      // DELETE removes jobs and generated MP3 assets and schedules a rebuild —
      // it changes the live site, so it takes the publishing scope.
      if (!(await requireScope(req, res, 'release:write', items[0].site_id))) return
      const site = await repo.getSite(items[0].site_id)
      return sendJson(res, 200, await audio.remove({ site, item: items[0] }))
    }
    const audioJobsMatch = path.match(/^\/v1\/sites\/([^/]+)\/audio\/jobs$/)
    if (audioJobsMatch && req.method === 'GET') {
      const site = await repo.getSite(audioJobsMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'content:read', site.id))) return
      return sendJson(
        res,
        200,
        await audio.listJobs({
          site,
          status: url.searchParams.get('status') || undefined,
          limit: url.searchParams.get('limit') || undefined,
        }),
      )
    }
    const audioBackfillMatch = path.match(/^\/v1\/sites\/([^/]+)\/audio\/backfill$/)
    if (audioBackfillMatch && req.method === 'POST') {
      const site = await repo.getSite(audioBackfillMatch[1])
      if (!site) return sendJson(res, 404, { error: 'site not found' })
      if (!(await requireScope(req, res, 'release:write', site.id))) return
      const input = parseJson(await bodyFor(req))
      return sendJson(
        res,
        200,
        await audio.backfill({
          site,
          limitChars: input.limit_chars,
          dryRun: input.dry_run === true,
          slugs: Array.isArray(input.slugs) ? input.slugs : undefined,
          force: input.force === true,
        }),
      )
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
    if (path === '/v1/feedback' && req.method === 'GET') {
      const principal = await requireScope(req, res, 'moderation:write')
      if (!principal) return
      const requestedSite = url.searchParams.get('site_id')
      if (requestedSite && !auth.authorize(principal, 'moderation:write', requestedSite)) {
        return sendJson(res, 403, { error: 'site access denied' })
      }
      const rows = await db.select('ck_post_feedback', {
        ...(requestedSite
          ? { site_id: `eq.${requestedSite}` }
          : Array.isArray(principal.site_ids) && principal.site_ids.length
            ? { site_id: `in.(${principal.site_ids.join(',')})` }
            : {}),
        ...(url.searchParams.get('post') ? { content_item_id: `eq.${url.searchParams.get('post')}` } : {}),
      })
      // The db wrapper has no GROUP BY; rows are four small columns at blog
      // scale, so aggregate here instead of raw SQL.
      const byPost = new Map()
      for (const row of rows) {
        const entry = byPost.get(row.content_item_id) || {
          content_item_id: row.content_item_id,
          site_id: row.site_id,
          up: 0,
          down: 0,
        }
        entry[row.vote] += 1
        byPost.set(row.content_item_id, entry)
      }
      return sendJson(
        res,
        200,
        [...byPost.values()].sort((a, b) => b.up + b.down - (a.up + a.down)),
      )
    }

    // Unmatched method on a known API path: answer with OPTIONS/405 + Allow
    // instead of falling through to the static gateway's opaque 404. Routes that
    // only exist on the API host are skipped elsewhere, so a site keeps its own
    // /llms.txt and never advertises /metrics.
    const known = API_ROUTES.find((route) => (apiHost || !route.apiHostOnly) && route.pattern.test(path))
    if (known) {
      const allow = [...known.methods, 'OPTIONS'].join(', ')
      if (req.method === 'OPTIONS') return send(res, 204, '', { allow })
      return sendJson(res, 405, { error: 'method not allowed' }, { allow })
    }

    if (await gateway(req, res, url)) return
    return sendJson(res, 404, { error: 'not found' })
  }
}
