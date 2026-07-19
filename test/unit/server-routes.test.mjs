import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../src/server.mjs'
import { createRepository } from '../../src/repository.mjs'
import { releaseContentType } from '../../src/routes.mjs'
import { clientIp } from '../../src/security.mjs'
import { StorageError } from '../../src/storage.mjs'
import { contentkitFontFamily } from '../../src/typography.mjs'

test('clientIp trusts only the rightmost X-Forwarded-For hop behind a proxy', () => {
  const req = { headers: { 'x-forwarded-for': 'spoofed, 9.9.9.9, 1.2.3.4' }, socket: { remoteAddress: '10.0.0.1' } }
  assert.equal(clientIp(req, true), '1.2.3.4')
  // Without trustProxy the header is ignored entirely.
  assert.equal(clientIp(req, false), '10.0.0.1')
})

test('public submission fails closed without a Turnstile secret or dev bypass', async () => {
  await withApp(
    {
      repo: {
        async getSite() {
          return { id: 's' }
        },
      },
    },
    async (request) => {
      const response = await request('/public/v1/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site_id: 's', name: 'A', email: 'a@b.c', message: 'hi' }),
      })
      assert.equal(response.status, 422)
      assert.match((await response.json()).error, /captcha/)
    },
  )
})

test('public submission proceeds past the captcha when the dev bypass is enabled', async () => {
  await withApp(
    {
      config: { turnstileDevBypass: true },
      repo: {
        async getSite() {
          return null
        },
      },
    },
    async (request) => {
      const response = await request('/public/v1/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site_id: 'missing', name: 'A', email: 'a@b.c', message: 'hi' }),
      })
      // Past the captcha gate: now it fails on site lookup, not on captcha.
      assert.equal(response.status, 404)
      assert.match((await response.json()).error, /site not found/)
    },
  )
})

test('public comment submission returns 404 when comments are disabled for the site', async () => {
  await withApp(
    {
      repo: {
        async getSite() {
          return { id: 's', settings: { comments: { enabled: false } } }
        },
      },
      db: {
        async select() {
          throw new Error('disabled comments must not query content')
        },
      },
    },
    async (request) => {
      const response = await request('/public/v1/posts/post-1/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site_id: 's', name: 'A', message: 'hi' }),
      })
      assert.equal(response.status, 404)
      assert.deepEqual(await response.json(), { error: 'not found' })
    },
  )
})

test('public feedback accepts a vote without Turnstile when the site opts in', async () => {
  await withApp(
    {
      // No turnstileDevBypass: a 201 proves the feedback branch never consults
      // the (fail-closed) captcha — honeypot + rate limit are its whole gate.
      repo: {
        async getSite() {
          return { id: 's', settings: { feedback: { enabled: true } } }
        },
      },
      db: {
        async select(table, filters) {
          assert.equal(table, 'ck_content_items')
          assert.equal(filters.kind, 'eq.post')
          return [{ id: 'post-1' }]
        },
        async insert(table, row) {
          assert.equal(table, 'ck_post_feedback')
          assert.equal(row.vote, 'up')
          assert.equal(row.content_item_id, 'post-1')
          return [{ id: 'fb-1' }]
        },
      },
    },
    async (request) => {
      const response = await request('/public/v1/posts/post-1/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site_id: 's', vote: 'up', website: '' }),
      })
      assert.equal(response.status, 201)
      assert.deepEqual(await response.json(), { accepted: true, id: 'fb-1' })
    },
  )
})

test('public feedback is opt-in: without settings.feedback.enabled the endpoint is 404', async () => {
  await withApp(
    {
      repo: {
        async getSite() {
          return { id: 's', settings: {} }
        },
      },
      db: {
        async select() {
          throw new Error('disabled feedback must not query content')
        },
      },
    },
    async (request) => {
      const response = await request('/public/v1/posts/post-1/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site_id: 's', vote: 'up' }),
      })
      assert.equal(response.status, 404)
      assert.deepEqual(await response.json(), { error: 'not found' })
    },
  )
})

test('public feedback rejects anything but an up/down vote and swallows the honeypot', async () => {
  await withApp(
    {
      repo: {
        async getSite() {
          return { id: 's', settings: { feedback: { enabled: true } } }
        },
      },
    },
    async (request) => {
      const invalid = await request('/public/v1/posts/post-1/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site_id: 's', vote: 'sideways' }),
      })
      assert.equal(invalid.status, 422)
      assert.match((await invalid.json()).error, /vote must be up or down/)
    },
  )
  await withApp(
    {
      repo: {
        async getSite() {
          throw new Error('the honeypot must answer before any site lookup')
        },
      },
    },
    async (request) => {
      const bot = await request('/public/v1/posts/post-1/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site_id: 's', vote: 'up', website: 'https://spam.example' }),
      })
      assert.equal(bot.status, 201)
      assert.deepEqual(await bot.json(), { accepted: true })
    },
  )
})

test('GET /v1/feedback requires moderation scope and aggregates votes per post', async () => {
  const rows = [
    { content_item_id: 'post-1', site_id: 's', vote: 'up' },
    { content_item_id: 'post-1', site_id: 's', vote: 'up' },
    { content_item_id: 'post-1', site_id: 's', vote: 'down' },
    { content_item_id: 'post-2', site_id: 's', vote: 'up' },
  ]
  await withApp(
    {
      auth: scopedAuth(['moderation:write']),
      db: {
        async select(table) {
          assert.equal(table, 'ck_post_feedback')
          return rows
        },
      },
    },
    async (request) => {
      const unauthorized = await request('/v1/feedback')
      assert.equal(unauthorized.status, 401)

      const response = await request('/v1/feedback', { headers: { 'x-api-key': 'valid' } })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), [
        { content_item_id: 'post-1', site_id: 's', up: 2, down: 1 },
        { content_item_id: 'post-2', site_id: 's', up: 1, down: 0 },
      ])
    },
  )
})

test('public contact submission is unaffected by disabled comments', async () => {
  await withApp(
    {
      config: { turnstileDevBypass: true },
      repo: {
        async getSite() {
          return { id: 's', settings: { comments: { enabled: false } } }
        },
        async enqueueEvent() {},
      },
      db: {
        async tx(fn) {
          return fn({
            async insert(table, row) {
              assert.equal(table, 'ck_contact_submissions')
              return [{ id: 'contact-1', name: row.name, email: row.email, body: row.body }]
            },
          })
        },
      },
    },
    async (request) => {
      const response = await request('/public/v1/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site_id: 's', name: 'A', email: 'a@b.c', message: 'hi' }),
      })
      assert.equal(response.status, 201)
      assert.deepEqual(await response.json(), { accepted: true, id: 'contact-1' })
    },
  )
})

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

async function withApp(
  {
    db = {},
    repo = {},
    releases = {},
    auth = {},
    storage = {},
    config = {},
    maintenance,
    audio,
    loginLimiter,
    logger,
  } = {},
  run,
) {
  const app = createApp(
    {
      publicUrl: 'https://contentkit-api.example',
      version: 'test',
      root,
      trustProxy: false,
      maxBodyBytes: 1024 * 1024,
      ...config,
    },
    {
      logger: logger || { info() {}, warn() {}, error() {}, debug() {} },
      database: { db, async close() {} },
      storage,
      repo,
      releases: {
        inflight() {
          return 0
        },
        ...releases,
      },
      auth,
      outbox: { start() {}, stop() {} },
      ...(maintenance ? { maintenance } : {}),
      ...(audio ? { audio } : {}),
      ...(loginLimiter ? { loginLimiter } : {}),
    },
  )
  await new Promise((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const { port } = app.server.address()
    await run((path, init) => fetch(`http://127.0.0.1:${port}${path}`, init))
  } finally {
    app.limiter.stop()
    app.loginLimiter.stop()
    await new Promise((resolve) => app.server.close(resolve))
  }
}

test('site gateway terminates after sending a no-release response', async () => {
  const errors = []
  await withApp(
    {
      logger: {
        info() {},
        warn() {},
        error(message, fields) {
          errors.push({ message, fields })
        },
        debug() {},
      },
      repo: {
        async getSiteByHost() {
          return { id: 'private-site', active_release_id: null }
        },
      },
    },
    async (request) => {
      const response = await request('/', { headers: { host: 'cockpit.example' } })
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'site has no active release' })
    },
  )
  assert.deepEqual(errors, [])
})

const scopedAuth = (scopes) => ({
  async authenticate(headers) {
    return headers.get?.('x-api-key') === 'valid' || headers['x-api-key'] === 'valid'
      ? { id: 'key', scopes, site_ids: [] }
      : null
  },
  authorize(principal, scope) {
    return Boolean(principal) && (principal.scopes.includes('*') || principal.scopes.includes(scope))
  },
})

test('OPTIONS on a known API path returns 204 with an Allow header', async () => {
  await withApp({}, async (request) => {
    const response = await request('/v1/sites/some-site/releases', { method: 'OPTIONS' })
    assert.equal(response.status, 204)
    assert.equal(response.headers.get('allow'), 'GET, POST, OPTIONS')
  })
})

test('HTTP responses continue W3C trace context with a fresh server span', async () => {
  await withApp({}, async (request) => {
    const response = await request('/health', {
      headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('traceparent'), /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/)
  })
})

test('unsupported method on a known API path returns 405 with an Allow header', async () => {
  await withApp({}, async (request) => {
    const response = await request('/v1/publish-due', { method: 'DELETE' })
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'POST, OPTIONS')
    assert.deepEqual(await response.json(), { error: 'method not allowed' })
  })
})

test('missing key yields 401, an under-scoped key yields 403 insufficient_scope', async () => {
  await withApp({ auth: scopedAuth(['content:read']) }, async (request) => {
    const missing = await request('/v1/sites', { method: 'POST', body: '{}' })
    assert.equal(missing.status, 401)
    assert.equal(missing.headers.get('www-authenticate'), 'Bearer')
    assert.deepEqual(await missing.json(), { error: 'unauthorized' })

    const underScoped = await request('/v1/sites', { method: 'POST', body: '{}', headers: { 'x-api-key': 'valid' } })
    assert.equal(underScoped.status, 403)
    assert.deepEqual(await underScoped.json(), { error: 'insufficient_scope', scope: 'site:admin' })
  })
})

test('DELETE /v1/content/{item}/published returns 409 for an unpublished item', async () => {
  const db = {
    async select(table, query) {
      if (table === 'ck_content_items' && query.id === 'eq.item-1') {
        return [{ id: 'item-1', site_id: 'site-1', published_revision_id: null }]
      }
      return []
    },
  }
  await withApp({ db, auth: scopedAuth(['release:write']) }, async (request) => {
    const response = await request('/v1/content/item-1/published', {
      method: 'DELETE',
      headers: { 'x-api-key': 'valid' },
    })
    assert.equal(response.status, 409)
    assert.deepEqual(await response.json(), { error: 'item is not published' })
  })
})

test('DELETE /v1/content/{item}/published retires a published item via a release', async () => {
  const published = []
  const db = {
    async select(table, query) {
      if (table === 'ck_content_items' && query.id === 'eq.item-1') {
        return [{ id: 'item-1', site_id: 'site-1', published_revision_id: 'rev-1' }]
      }
      return []
    },
  }
  const releases = {
    async publish(input) {
      published.push(input)
      return { release_id: 'release-1', file_count: 3, active: true }
    },
  }
  await withApp({ db, releases, auth: scopedAuth(['release:write']) }, async (request) => {
    const response = await request('/v1/content/item-1/published', {
      method: 'DELETE',
      headers: { 'x-api-key': 'valid' },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      item_id: 'item-1',
      unpublished: true,
      release: { release_id: 'release-1', file_count: 3, active: true },
    })
    assert.deepEqual(published, [{ siteId: 'site-1', retireItemIds: ['item-1'], reason: 'unpublish' }])
  })
})

// PATCH replaces `settings` wholesale, so a partial update is only safe if the
// caller can read the current object first. Both the reader and the patcher must
// get through, even though site:admin holds no read scope.
test('GET /v1/sites/{site} returns the site for content:read and for site:admin', async () => {
  const site = { id: 'site-1', slug: 'my-site', description: 'Docs', settings: { accent: '221 83% 53%' } }
  const repo = {
    async getSite(slug) {
      return slug === 'my-site' ? site : null
    },
  }
  for (const scopes of [['content:read'], ['site:admin']]) {
    await withApp({ repo, auth: scopedAuth(scopes) }, async (request) => {
      const response = await request('/v1/sites/my-site', { headers: { 'x-api-key': 'valid' } })
      assert.equal(response.status, 200, scopes.join())
      assert.deepEqual(await response.json(), site)
    })
  }
})

test('GET /v1/sites/{site} is 403 without a read scope and 404 for an unknown site', async () => {
  const repo = {
    async getSite(slug) {
      return slug === 'my-site' ? { id: 'site-1' } : null
    },
  }
  await withApp({ repo, auth: scopedAuth(['release:write']) }, async (request) => {
    const forbidden = await request('/v1/sites/my-site', { headers: { 'x-api-key': 'valid' } })
    assert.equal(forbidden.status, 403)
    assert.deepEqual((await forbidden.json()).scope, ['content:read', 'site:admin'])

    // The site lookup precedes the scope check, so an unknown slug is a 404.
    const missing = await request('/v1/sites/nope', { headers: { 'x-api-key': 'valid' } })
    assert.equal(missing.status, 404)
  })
})

test('site stats use content:read, return private aggregates and validate bounded windows', async () => {
  const repo = {
    async getSite(id) {
      return id === 'site-1' ? { id: 'site-1' } : null
    },
  }
  const db = {
    async query() {
      return []
    },
  }
  await withApp({ repo, db, auth: scopedAuth(['content:read']) }, async (request) => {
    const ok = await request(
      '/v1/sites/site-1/stats/content?bucket=hour&from=2026-07-18T10:00:00Z&to=2026-07-18T12:00:00Z',
      { headers: { 'x-api-key': 'valid' } },
    )
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('cache-control'), 'private,max-age=60')
    const body = await ok.json()
    assert.equal(body.buckets.length, 2)
    assert.deepEqual(body.totals, {
      items_created: 0,
      revisions_created: 0,
      revisions_published: 0,
      assets_created: 0,
      asset_bytes: 0,
    })

    const invalid = await request('/v1/sites/site-1/stats/content?tz=Europe%2FBerlin', {
      headers: { 'x-api-key': 'valid' },
    })
    assert.equal(invalid.status, 422)
    assert.match((await invalid.json()).error, /only 'UTC'/)
  })
  await withApp({ repo, db, auth: scopedAuth(['site:admin']) }, async (request) => {
    const forbidden = await request('/v1/sites/site-1/stats/readers', { headers: { 'x-api-key': 'valid' } })
    assert.equal(forbidden.status, 403)
  })
})

test('GET /v1/sites/{site}/releases lists releases for rollback discovery', async () => {
  const repo = {
    async getSite(slug) {
      return slug === 'my-site' ? { id: 'site-1', slug: 'my-site' } : null
    },
    async listReleases(siteId) {
      assert.equal(siteId, 'site-1')
      return [
        { id: 'release-2', status: 'active' },
        { id: 'release-1', status: 'superseded' },
      ]
    },
  }
  await withApp({ repo, auth: scopedAuth(['content:read']) }, async (request) => {
    const response = await request('/v1/sites/my-site/releases', { headers: { 'x-api-key': 'valid' } })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), [
      { id: 'release-2', status: 'active' },
      { id: 'release-1', status: 'superseded' },
    ])
  })
})

test('POST /v1/sites/{site}/releases forwards retire_item_ids', async () => {
  const published = []
  const repo = {
    async getSite() {
      return { id: 'site-1' }
    },
  }
  const releases = {
    async publish(input) {
      published.push(input)
      return { release_id: 'release-1', active: true }
    },
  }
  await withApp({ repo, releases, auth: scopedAuth(['release:write']) }, async (request) => {
    const response = await request('/v1/sites/site-1/releases', {
      method: 'POST',
      headers: { 'x-api-key': 'valid' },
      body: JSON.stringify({ revision_ids: ['rev-9'], retire_item_ids: ['item-1'], reason: 'cleanup' }),
    })
    assert.equal(response.status, 201)
    assert.deepEqual(published, [
      { siteId: 'site-1', revisionIds: ['rev-9'], retireItemIds: ['item-1'], reason: 'cleanup' },
    ])
  })
})

// undici's fetch forbids overriding the Host header, so these fixtures resolve
// the site for any host — the behavior under test is the storage 404 fallback,
// not host routing (which repository.test.mjs covers).
function gatewayFixture(objects, settings) {
  const repo = {
    async getSiteByHost() {
      return { id: 'site-1', active_release_id: 'release-1', ...(settings ? { settings } : {}) }
    },
    async getRelease(id) {
      return id === 'release-1' ? { id: 'release-1', storage_prefix: 'prefix' } : null
    },
  }
  const storage = {
    async download(path) {
      if (path in objects) {
        const body = Buffer.from(objects[path])
        return {
          headers: new Map(),
          async arrayBuffer() {
            return body
          },
        }
      }
      // Reproduce self-hosted storage-api: a missing object comes back as a
      // wrapped HTTP 400 whose body carries the real 404.
      throw new StorageError('Object not found', 404, { statusCode: '404' })
    },
  }
  return { repo, storage }
}

test('gateway serves 404.html for a missing page (wrapped storage 404)', async () => {
  const { repo, storage } = gatewayFixture({ 'prefix/404.html': '<h1>Nicht gefunden</h1>' })
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/de/does-not-exist/')
    assert.equal(response.status, 404)
    assert.match(await response.text(), /Nicht gefunden/)
  })
})

test('gateway serves an existing page normally', async () => {
  const { repo, storage } = gatewayFixture({ 'prefix/de/blog/index.html': '<h1>Blog</h1>' })
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/de/blog/')
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Blog/)
  })
})

test("a served page's CSP widens to the site's analytics provider (GA4)", async () => {
  const { repo, storage } = gatewayFixture(
    { 'prefix/de/blog/index.html': '<h1>Blog</h1>' },
    { analytics: { provider: 'ga4', id: 'G-X' } },
  )
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/de/blog/')
    const csp = response.headers.get('content-security-policy')
    assert.match(csp, /script-src[^;]*https:\/\/www\.googletagmanager\.com/)
    assert.match(csp, /connect-src[^;]*https:\/\/www\.google-analytics\.com/)
  })
})

test("a served page's CSP stays strict with no analytics configured", async () => {
  const { repo, storage } = gatewayFixture({ 'prefix/de/blog/index.html': '<h1>Blog</h1>' })
  await withApp({ repo, storage }, async (request) => {
    const csp = (await request('/de/blog/')).headers.get('content-security-policy')
    assert.doesNotMatch(csp, /googletagmanager|plausible/)
  })
})

test('gateway redirects anonymous readers and serves protected pages only to an allowed session', async () => {
  const repo = {
    async getSiteByHost() {
      return {
        id: 'site-1',
        name: 'Docs',
        default_locale: 'en',
        base_url: 'http://example.test',
        active_release_id: 'release-1',
      }
    },
    async getRelease() {
      return { id: 'release-1', storage_prefix: 'prefix' }
    },
    async releaseAccessEntries() {
      return [{ match: 'prefix', path: '/en/docs/internal/', group_slugs: ['customers'], user_ids: [] }]
    },
    async authenticateReader(_siteId, token) {
      return token === 'allowed' ? { id: 'reader-1', groups: ['customers'] } : null
    },
  }
  const storage = {
    async download() {
      return {
        headers: new Map(),
        async arrayBuffer() {
          return Buffer.from('<h1>Protected</h1>')
        },
      }
    },
  }
  await withApp({ repo, storage }, async (request) => {
    const anonymous = await request('/en/docs/internal/', { redirect: 'manual' })
    assert.equal(anonymous.status, 302)
    assert.match(anonymous.headers.get('location'), /^\/_contentkit\/login/)
    const physicalPath = await request('/en/docs/internal/index.html', { redirect: 'manual' })
    assert.equal(physicalPath.status, 302)
    const encodedPath = await request('/en/docs/%69nternal/', { redirect: 'manual' })
    assert.equal(encodedPath.status, 302)
    const allowed = await request('/en/docs/internal/', {
      headers: { cookie: '__Host-contentkit_session=allowed' },
    })
    assert.equal(allowed.status, 200)
    assert.match(await allowed.text(), /Protected/)
    assert.equal(allowed.headers.get('cache-control'), 'private,no-store')
  })
})

test('site reader login sets a session cookie and validates the return path', async () => {
  const rateLimitKeys = []
  const authEvents = []
  const repo = {
    async getSiteByHost() {
      return { id: 'site-1', name: 'Docs', default_locale: 'en', base_url: 'http://example.test' }
    },
    async createReaderSession(_siteId, username, password) {
      return username === 'anna' && password === 'a-long-password' ? { token: 'reader-token', reader: {} } : null
    },
  }
  const loginLimiter = {
    take(key) {
      rateLimitKeys.push(key)
      return true
    },
    stop() {},
  }
  const db = {
    async insert(table, body, options) {
      authEvents.push({ table, body, options })
    },
  }
  await withApp({ repo, db, loginLimiter, config: { sessionSecret: 'session-secret' } }, async (request) => {
    const form = await request('/_contentkit/login?return_to=/en/docs/')
    assert.equal(form.status, 200)
    assert.equal(form.headers.get('x-frame-options'), 'DENY')
    assert.match(form.headers.get('content-security-policy'), /form-action 'self'/)
    const html = await form.text()
    assert.match(html, new RegExp(`font:16px ${contentkitFontFamily.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    const csrf = html.match(/name="csrf" value="([^"]+)"/)[1]
    const csrfCookie = form.headers.get('set-cookie').split(';')[0]
    const signedIn = await request('/_contentkit/login', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: csrfCookie },
      body: new URLSearchParams({ csrf, return_to: '/en/docs/', username: 'anna', password: 'a-long-password' }),
    })
    assert.equal(signedIn.status, 303)
    assert.equal(signedIn.headers.get('location'), '/en/docs/')
    assert.match(signedIn.headers.get('set-cookie'), /contentkit_session=reader-token/)
    assert.equal(rateLimitKeys.length, 2)
    assert.match(rateLimitKeys[0], /^reader-login-ip:/)
    assert.equal(rateLimitKeys[1], 'reader-login-user:site-1:anna')
    assert.deepEqual(authEvents, [
      {
        table: 'ck_reader_auth_events',
        body: { site_id: 'site-1', outcome: 'success' },
        options: { returning: false },
      },
    ])
  })
})

test('reader auth telemetry records only bounded outcomes and never credentials or IPs', async () => {
  const events = []
  const repo = {
    async getSiteByHost() {
      return { id: 'site-1', name: 'Docs', default_locale: 'en', base_url: 'http://example.test' }
    },
    async createReaderSession() {
      return null
    },
  }
  const db = {
    async insert(_table, body) {
      events.push(body)
    },
  }
  const loginLimiter = {
    take() {
      return true
    },
    stop() {},
  }
  await withApp({ repo, db, loginLimiter, config: { sessionSecret: 'session-secret' } }, async (request) => {
    const form = await request('/_contentkit/login')
    const html = await form.text()
    const csrf = html.match(/name="csrf" value="([^"]+)"/)[1]
    const cookie = form.headers.get('set-cookie').split(';')[0]
    const failed = await request('/_contentkit/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ csrf, username: 'private-user', password: 'private-password' }),
    })
    assert.equal(failed.status, 401)
  })
  assert.deepEqual(events, [{ site_id: 'site-1', outcome: 'failed' }])
  assert.doesNotMatch(JSON.stringify(events), /private-user|private-password|127\.0\.0\.1/)
})

test('reader routes advertise and enforce their documented methods', async () => {
  const repo = {
    async getSiteByHost() {
      return { id: 'site-1', name: 'Docs', default_locale: 'en', base_url: 'http://example.test' }
    },
  }
  await withApp({ repo }, async (request) => {
    const options = await request('/_contentkit/login', { method: 'OPTIONS' })
    assert.equal(options.status, 204)
    assert.equal(options.headers.get('allow'), 'GET, POST, OPTIONS')
    const unsupported = await request('/_contentkit/login', { method: 'PUT' })
    assert.equal(unsupported.status, 405)
    assert.equal(unsupported.headers.get('allow'), 'GET, POST, OPTIONS')
  })
})

test('site:admin manages reader groups through the access API', async () => {
  const calls = []
  const repo = {
    async getSite() {
      return { id: 'site-1' }
    },
    async listAccessGroups() {
      calls.push('list')
      return [{ id: 'g1', slug: 'customers', name: 'Customers' }]
    },
    async createAccessGroup(_siteId, input) {
      calls.push(['create', input])
      return { id: 'g2', ...input }
    },
  }
  await withApp({ repo, auth: scopedAuth(['site:admin']) }, async (request) => {
    const listed = await request('/v1/sites/site-1/access/groups', { headers: { 'x-api-key': 'valid' } })
    assert.equal(listed.status, 200)
    const created = await request('/v1/sites/site-1/access/groups', {
      method: 'POST',
      headers: { 'x-api-key': 'valid', 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'team', name: 'Team' }),
    })
    assert.equal(created.status, 201)
    assert.deepEqual(calls, ['list', ['create', { slug: 'team', name: 'Team' }]])
  })
})

function webhookRepo(calls = []) {
  return {
    async getSite(slug) {
      return slug === 'my-site' ? { id: 'site-1', slug: 'my-site' } : null
    },
    async createWebhookEndpoint(siteId, input) {
      calls.push(['create', siteId, input])
      return { id: 'ep-1', url: input.url, events: input.events || [], secret: 'whsec_generated' }
    },
    async listWebhookEndpoints(siteId) {
      calls.push(['list', siteId])
      return [{ id: 'ep-1', url: 'https://hooks.me/x', events: [] }]
    },
    async updateWebhookEndpoint(siteId, id, input) {
      calls.push(['update', siteId, id, input])
      return id === 'ep-1' ? { id, url: input.url || 'https://hooks.me/x' } : null
    },
    async deleteWebhookEndpoint(siteId, id) {
      calls.push(['delete', siteId, id])
      return id === 'ep-1'
    },
    async rotateWebhookSecret(siteId, id) {
      calls.push(['rotate', siteId, id])
      return id === 'ep-1' ? { id, secret: 'whsec_rotated' } : null
    },
    async listDeliveries(opts) {
      calls.push(['deliveries', opts])
      return [{ id: 'del-1', status: 'delivered' }]
    },
    async getDelivery(id) {
      return id === 'del-1' ? { id, site_id: 'site-1', status: 'failed' } : null
    },
    async retryDelivery(id) {
      calls.push(['retry', id])
      return { id, status: 'pending' }
    },
  }
}

test('POST /v1/sites/{site}/webhooks creates an endpoint and returns the secret once', async () => {
  const calls = []
  await withApp({ repo: webhookRepo(calls), auth: scopedAuth(['site:admin']) }, async (request) => {
    const response = await request('/v1/sites/my-site/webhooks', {
      method: 'POST',
      headers: { 'x-api-key': 'valid' },
      body: JSON.stringify({ url: 'https://hooks.me/ck', events: ['contact.submitted'] }),
    })
    assert.equal(response.status, 201)
    assert.equal((await response.json()).secret, 'whsec_generated')
    assert.deepEqual(calls[0], ['create', 'site-1', { url: 'https://hooks.me/ck', events: ['contact.submitted'] }])
  })
})

test('POST /v1/sites/{site}/webhooks without url is 422', async () => {
  await withApp({ repo: webhookRepo(), auth: scopedAuth(['site:admin']) }, async (request) => {
    const response = await request('/v1/sites/my-site/webhooks', {
      method: 'POST',
      headers: { 'x-api-key': 'valid' },
      body: '{}',
    })
    assert.equal(response.status, 422)
  })
})

test('webhook management requires site:admin (403 for content:read)', async () => {
  await withApp({ repo: webhookRepo(), auth: scopedAuth(['content:read']) }, async (request) => {
    const response = await request('/v1/sites/my-site/webhooks', { headers: { 'x-api-key': 'valid' } })
    assert.equal(response.status, 403)
  })
})

test('rotate, delete and delivery retry route to the repository', async () => {
  const calls = []
  await withApp({ repo: webhookRepo(calls), auth: scopedAuth(['site:admin']) }, async (request) => {
    const rotate = await request('/v1/sites/my-site/webhooks/ep-1/rotate', {
      method: 'POST',
      headers: { 'x-api-key': 'valid' },
    })
    assert.equal(rotate.status, 200)
    assert.equal((await rotate.json()).secret, 'whsec_rotated')

    const del = await request('/v1/sites/my-site/webhooks/ep-1', {
      method: 'DELETE',
      headers: { 'x-api-key': 'valid' },
    })
    assert.equal(del.status, 200)

    const missing = await request('/v1/sites/my-site/webhooks/nope', {
      method: 'DELETE',
      headers: { 'x-api-key': 'valid' },
    })
    assert.equal(missing.status, 404)

    const retry = await request('/v1/webhook-deliveries/del-1/retry', {
      method: 'POST',
      headers: { 'x-api-key': 'valid' },
    })
    assert.equal(retry.status, 200)
    assert.deepEqual(calls.at(-1), ['retry', 'del-1'])
  })
})

test('OPTIONS on the webhooks collection advertises GET, POST', async () => {
  await withApp({ repo: webhookRepo() }, async (request) => {
    const response = await request('/v1/sites/my-site/webhooks', { method: 'OPTIONS' })
    assert.equal(response.status, 204)
    assert.equal(response.headers.get('allow'), 'GET, POST, OPTIONS')
  })
})

// A site-scoped site:admin principal used to probe API-key minting escalation.
const siteAdminAuth = (scopes, site_ids) => ({
  async authenticate(headers) {
    return headers.get?.('x-api-key') === 'valid' || headers['x-api-key'] === 'valid'
      ? { id: 'k', scopes, site_ids }
      : null
  },
  authorize(principal, scope) {
    return Boolean(principal) && (principal.scopes.includes('*') || principal.scopes.includes(scope))
  },
})

test('API-key minting forbids the global * scope for a non-bootstrap caller', async () => {
  const repo = {
    async createApiKey() {
      return { key: 'ck_new' }
    },
  }
  await withApp({ repo, auth: siteAdminAuth(['site:admin'], ['site-1']) }, async (request) => {
    const response = await request('/v1/api-keys', {
      method: 'POST',
      headers: { 'x-api-key': 'valid' },
      body: JSON.stringify({ name: 'x', scopes: ['*'], site_ids: ['site-1'] }),
    })
    assert.equal(response.status, 403)
    assert.match((await response.json()).error, /global/)
  })
})

test('API-key minting allows a site:admin to provision content/release keys (documented flow)', async () => {
  const created = []
  const repo = {
    async createApiKey(input) {
      created.push(input)
      return { ...input, key: 'ck_new' }
    },
  }
  await withApp({ repo, auth: siteAdminAuth(['site:admin'], ['site-1']) }, async (request) => {
    const response = await request('/v1/api-keys', {
      method: 'POST',
      headers: { 'x-api-key': 'valid' },
      body: JSON.stringify({
        name: 'pub',
        scopes: ['content:read', 'content:write', 'release:write'],
        site_ids: ['site-1'],
      }),
    })
    assert.equal(response.status, 201)
    assert.deepEqual(created[0].scopes, ['content:read', 'content:write', 'release:write'])
  })
})

test('API-key minting rejects an implicit-global (empty) site_ids for a site-scoped caller', async () => {
  const repo = {
    async createApiKey() {
      return { key: 'ck_new' }
    },
  }
  await withApp({ repo, auth: siteAdminAuth(['site:admin'], ['site-1']) }, async (request) => {
    const response = await request('/v1/api-keys', {
      method: 'POST',
      headers: { 'x-api-key': 'valid' },
      body: JSON.stringify({ name: 'x', scopes: ['site:admin'], site_ids: [] }),
    })
    assert.equal(response.status, 403)
    assert.match((await response.json()).error, /your own site/)
  })
})

test('API-key minting allows an in-scope subset', async () => {
  const created = []
  const repo = {
    async createApiKey(input) {
      created.push(input)
      return { ...input, key: 'ck_new' }
    },
  }
  await withApp({ repo, auth: siteAdminAuth(['site:admin'], ['site-1']) }, async (request) => {
    const response = await request('/v1/api-keys', {
      method: 'POST',
      headers: { 'x-api-key': 'valid' },
      body: JSON.stringify({ name: 'x', scopes: ['site:admin'], site_ids: ['site-1'] }),
    })
    assert.equal(response.status, 201)
    assert.equal(created.length, 1)
  })
})

const MEDIA_BODY = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz')

// Models an object store behind /media. `honoursRange` picks which of the two
// backends we have to survive: one that answers a range with a 206 (Supabase),
// and one that ignores the header and hands back the whole object, which the
// route then has to slice itself.
function mediaFixture(asset, { honoursRange = false, body = MEDIA_BODY } = {}) {
  const downloads = []
  return {
    downloads,
    repo: {
      async getSiteByHost() {
        return null
      },
      async asset(id) {
        return id === asset.id ? { byte_size: body.length, ...asset } : null
      },
    },
    storage: {
      async download(path, { head = false, range = '' } = {}) {
        downloads.push({ head, range })
        const spec = honoursRange && range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null
        const slice = spec ? body.subarray(Number(spec[1]), Number(spec[2]) + 1) : body
        return {
          status: spec ? 206 : 200,
          headers: { get: (name) => (name === 'content-length' ? String(slice.length) : null) },
          async arrayBuffer() {
            return head ? Buffer.alloc(0) : slice
          },
        }
      },
    },
  }
}

test('/media serves images inline with a sandbox CSP', async () => {
  const { repo, storage } = mediaFixture({
    id: 'a1',
    storage_path: 'p',
    content_type: 'image/png',
    sha256: 'h',
    filename: 'pic.png',
  })
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/media/a1/pic.png')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox")
    assert.equal(response.headers.get('content-disposition'), null)
  })
})

test('/media forces download for non-image content types', async () => {
  const { repo, storage } = mediaFixture({
    id: 'a2',
    storage_path: 'p',
    content_type: 'text/html',
    sha256: 'h',
    filename: 'evil.html',
  })
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/media/a2/evil.html')
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-disposition') || '', /attachment/)
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox")
  })
})

test('/media serves audio inline with a sandbox CSP (the read-aloud player streams from here)', async () => {
  for (const contentType of ['audio/mpeg', 'audio/mp4']) {
    const { repo, storage } = mediaFixture({
      id: 'a3',
      storage_path: 'p',
      content_type: contentType,
      sha256: 'h',
      filename: 'post-vorlesen.mp3',
    })
    await withApp({ repo, storage }, async (request) => {
      const response = await request('/media/a3/post-vorlesen.mp3')
      assert.equal(response.status, 200, contentType)
      assert.equal(response.headers.get('content-disposition'), null, `${contentType} must be inline`)
      assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox")
      assert.equal(response.headers.get('content-type'), contentType)
    })
  }
})

// Without ranges a browser will play an <audio> from the top but refuse to seek
// inside it, which is what left the read-aloud player's scrubber and ±15 s
// buttons dead. These pin the range contract down on both kinds of backend.
const audioAsset = {
  id: 'a4',
  storage_path: 'p',
  content_type: 'audio/mpeg',
  sha256: 'h',
  filename: 'post-vorlesen.mp3',
}

test('/media advertises range support and serves the whole entity when no range is asked for', async () => {
  const { repo, storage } = mediaFixture(audioAsset)
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/media/a4/post-vorlesen.mp3')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('accept-ranges'), 'bytes')
    assert.equal(response.headers.get('content-range'), null)
    assert.equal(response.headers.get('content-length'), String(MEDIA_BODY.length))
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), MEDIA_BODY.toString())
  })
})

test('/media answers a byte range with a 206 slice when the store ignores the range header', async () => {
  const { repo, storage, downloads } = mediaFixture(audioAsset, { honoursRange: false })
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/media/a4/post-vorlesen.mp3', { headers: { range: 'bytes=10-19' } })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), `bytes 10-19/${MEDIA_BODY.length}`)
    assert.equal(response.headers.get('content-length'), '10')
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'abcdefghij')
    assert.equal(downloads.at(-1).range, 'bytes=10-19')
  })
})

test('/media passes a store-honoured 206 straight through without re-slicing', async () => {
  const { repo, storage } = mediaFixture(audioAsset, { honoursRange: true })
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/media/a4/post-vorlesen.mp3', { headers: { range: 'bytes=10-19' } })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), `bytes 10-19/${MEDIA_BODY.length}`)
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'abcdefghij')
  })
})

test('/media serves an open-ended range to the end (this is the request Chrome opens media with)', async () => {
  const { repo, storage } = mediaFixture(audioAsset)
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/media/a4/post-vorlesen.mp3', { headers: { range: 'bytes=0-' } })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), `bytes 0-${MEDIA_BODY.length - 1}/${MEDIA_BODY.length}`)
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), MEDIA_BODY.toString())
  })
})

test('/media serves a suffix range', async () => {
  const { repo, storage } = mediaFixture(audioAsset)
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/media/a4/post-vorlesen.mp3', { headers: { range: 'bytes=-6' } })
    assert.equal(response.status, 206)
    assert.equal(response.headers.get('content-range'), `bytes 30-35/${MEDIA_BODY.length}`)
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'uvwxyz')
  })
})

test('/media rejects a range that starts past the end with a 416', async () => {
  const { repo, storage } = mediaFixture(audioAsset)
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/media/a4/post-vorlesen.mp3', { headers: { range: 'bytes=999-1200' } })
    assert.equal(response.status, 416)
    assert.equal(response.headers.get('content-range'), `bytes */${MEDIA_BODY.length}`)
  })
})

test('/media falls back to the whole entity for a range it cannot serve', async () => {
  const { repo, storage } = mediaFixture(audioAsset)
  await withApp({ repo, storage }, async (request) => {
    // Multi-range would mean multipart/byteranges; serving the full entity is a
    // legal answer and no media element asks for it.
    for (const range of ['bytes=0-9,20-29', 'pages=1-2', 'bytes=abc']) {
      const response = await request('/media/a4/post-vorlesen.mp3', { headers: { range } })
      assert.equal(response.status, 200, range)
      assert.equal(Buffer.from(await response.arrayBuffer()).toString(), MEDIA_BODY.toString(), range)
    }
  })
})

test('HEAD /media reports the real length, not an empty body length', async () => {
  const { repo, storage } = mediaFixture(audioAsset)
  await withApp({ repo, storage }, async (request) => {
    const response = await request('/media/a4/post-vorlesen.mp3', { method: 'HEAD' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-length'), String(MEDIA_BODY.length))
    assert.equal(response.headers.get('accept-ranges'), 'bytes')
  })
})

test('GET /v1/content/{item}/audio requires content:read and returns the worker status', async () => {
  const db = {
    async select(table) {
      if (table === 'ck_content_items') return [{ id: 'item-1', site_id: 'site-1' }]
      return []
    },
  }
  const audio = {
    async status(itemId) {
      return { item_id: itemId, status: 'done', audio: { url: '/media/a1/x.mp3' } }
    },
  }
  await withApp({ db, audio, auth: scopedAuth(['content:read']) }, async (request) => {
    assert.equal((await request('/v1/content/item-1/audio')).status, 401)
    const response = await request('/v1/content/item-1/audio', { headers: { 'x-api-key': 'valid' } })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.status, 'done')
    assert.equal(body.audio.url, '/media/a1/x.mp3')
  })
})

test('POST /v1/sites/{site}/audio/backfill requires release:write and forwards limit/dry_run', async () => {
  const calls = []
  const repo = {
    async getSite() {
      return { id: 'site-1', settings: { audio: { enabled: true } } }
    },
  }
  const audio = {
    async backfill(input) {
      calls.push(input)
      return { dry_run: input.dryRun, jobs: [], total_chars: 0, estimated_usd: 0, skipped: 0 }
    },
  }
  await withApp({ repo, audio, auth: scopedAuth(['release:write']) }, async (request) => {
    const denied = await request('/v1/sites/site-1/audio/backfill', { method: 'POST', body: '{}' })
    assert.equal(denied.status, 401)
    const response = await request('/v1/sites/site-1/audio/backfill', {
      method: 'POST',
      headers: { 'x-api-key': 'valid' },
      body: JSON.stringify({ dry_run: true, limit_chars: 5000 }),
    })
    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].dryRun, true)
    assert.equal(calls[0].limitChars, 5000)
    assert.equal(calls[0].site.id, 'site-1')
  })
})

test('DELETE /v1/content/{item}/audio requires release:write and forwards item and site to the worker', async () => {
  const db = {
    async select(table, query) {
      if (table === 'ck_content_items' && query.id === 'eq.item-1') return [{ id: 'item-1', site_id: 'site-1' }]
      return []
    },
  }
  const repo = {
    async getSite(id) {
      return id === 'site-1' ? { id: 'site-1', settings: { audio: { enabled: true } } } : null
    },
  }
  const calls = []
  const audio = {
    async remove(input) {
      calls.push(input)
      return { item_id: input.item.id, deleted_jobs: 2, deleted_assets: 1, rebuild_scheduled: true }
    },
  }
  await withApp({ db, repo, audio, auth: scopedAuth(['release:write']) }, async (request) => {
    assert.equal((await request('/v1/content/item-1/audio', { method: 'DELETE' })).status, 401)
    const response = await request('/v1/content/item-1/audio', { method: 'DELETE', headers: { 'x-api-key': 'valid' } })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      item_id: 'item-1',
      deleted_jobs: 2,
      deleted_assets: 1,
      rebuild_scheduled: true,
    })
    assert.equal(calls[0].site.id, 'site-1')
    assert.equal(calls[0].item.id, 'item-1')
    const missing = await request('/v1/content/nope/audio', { method: 'DELETE', headers: { 'x-api-key': 'valid' } })
    assert.equal(missing.status, 404)
  })
})

test('GET /v1/sites/{site}/audio/jobs requires content:read and forwards status/limit', async () => {
  const repo = {
    async getSite(slug) {
      return slug === 'my-site' ? { id: 'site-1', slug: 'my-site' } : null
    },
  }
  const calls = []
  const audio = {
    async listJobs(input) {
      calls.push(input)
      if (input.status && !['pending', 'processing', 'done', 'failed', 'skipped'].includes(input.status)) {
        throw Object.assign(new Error('status must be one of …'), { statusCode: 422 })
      }
      return { jobs: [], summary: { pending: 0, chars_this_month: 0 } }
    },
  }
  await withApp({ repo, audio, auth: scopedAuth(['content:read']) }, async (request) => {
    assert.equal((await request('/v1/sites/my-site/audio/jobs')).status, 401)
    assert.equal((await request('/v1/sites/nope/audio/jobs', { headers: { 'x-api-key': 'valid' } })).status, 404)
    const response = await request('/v1/sites/my-site/audio/jobs?status=failed&limit=5', {
      headers: { 'x-api-key': 'valid' },
    })
    assert.equal(response.status, 200)
    assert.equal(calls[0].site.id, 'site-1')
    assert.equal(calls[0].status, 'failed')
    assert.equal(calls[0].limit, '5')
    // The worker's status validation surfaces as a 422, not a 500.
    const invalid = await request('/v1/sites/my-site/audio/jobs?status=nope', { headers: { 'x-api-key': 'valid' } })
    assert.equal(invalid.status, 422)
  })
})

test('OPTIONS advertises GET, DELETE on item audio and GET on the jobs listing', async () => {
  await withApp({}, async (request) => {
    const item = await request('/v1/content/item-1/audio', { method: 'OPTIONS' })
    assert.equal(item.status, 204)
    assert.equal(item.headers.get('allow'), 'GET, DELETE, OPTIONS')
    const jobs = await request('/v1/sites/my-site/audio/jobs', { method: 'OPTIONS' })
    assert.equal(jobs.status, 204)
    assert.equal(jobs.headers.get('allow'), 'GET, OPTIONS')
  })
})

test('publish-due publishes the latest scheduled revision per item and archives the rest', async () => {
  const due = [
    { id: 'r1', item_id: 'itemA', scheduled_at: '2026-01-01T00:00:00Z' },
    { id: 'r2', item_id: 'itemA', scheduled_at: '2026-01-02T00:00:00Z' },
    { id: 'r3', item_id: 'itemB', scheduled_at: '2026-01-01T00:00:00Z' },
  ]
  const updates = []
  const db = {
    async select(table) {
      if (table === 'ck_content_revisions') return due
      if (table === 'ck_content_items') return [{ site_id: 'site-1' }]
      return []
    },
    async update(table, filters, body) {
      updates.push({ table, filters, body })
      return [body]
    },
  }
  const published = []
  const releases = {
    inflight() {
      return 0
    },
    async publish(input) {
      published.push(input)
      return { release_id: 'rel', active: true }
    },
  }
  await withApp({ db, releases, auth: scopedAuth(['release:write']) }, async (request) => {
    const response = await request('/v1/publish-due', { method: 'POST', headers: { 'x-api-key': 'valid' } })
    assert.equal(response.status, 200)
  })
  // itemA -> latest r2, itemB -> r3; r1 stale
  assert.deepEqual(new Set(published[0].revisionIds), new Set(['r2', 'r3']))
  const archive = updates.find((u) => u.table === 'ck_content_revisions')
  assert.match(archive.filters.id, /r1/)
  assert.equal(archive.body.status, 'archived')
})

test('publish-due isolates a failing site and still reports per-site results', async () => {
  const db = {
    async select(table) {
      if (table === 'ck_content_revisions')
        return [{ id: 'r1', item_id: 'itemA', scheduled_at: '2026-01-01T00:00:00Z' }]
      if (table === 'ck_content_items') return [{ site_id: 'site-boom' }]
      return []
    },
    async update() {
      return [{}]
    },
  }
  const releases = {
    inflight() {
      return 0
    },
    async publish() {
      throw new Error('build exploded')
    },
  }
  await withApp({ db, releases, auth: scopedAuth(['release:write']) }, async (request) => {
    const response = await request('/v1/publish-due', { method: 'POST', headers: { 'x-api-key': 'valid' } })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.published[0].site_id, 'site-boom')
    assert.match(body.published[0].error, /exploded/)
  })
})

test('comment approval returns 200 even when the republish fails', async () => {
  const comment = { id: 'c1', site_id: 's1', content_item_id: 'i1', author_name: 'A', body: 'b', status: 'approved' }
  const db = {
    async select(table) {
      return table === 'ck_comments' ? [comment] : []
    },
    async update() {
      return [comment]
    },
  }
  const repo = {
    async getSite() {
      return { id: 's1', name: 'S' }
    },
    async enqueueEvent() {},
  }
  const releases = {
    inflight() {
      return 0
    },
    async publish() {
      throw new Error('build exploded')
    },
  }
  await withApp({ db, repo, releases, auth: scopedAuth(['moderation:write']) }, async (request) => {
    const response = await request('/v1/comments/c1', {
      method: 'PATCH',
      headers: { 'x-api-key': 'valid', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.comment.status, 'approved')
    assert.equal(body.release, null)
    assert.match(body.republish_error, /exploded/)
  })
})

test('storage-gc runs for an unrestricted release:write key', async () => {
  let ran = false
  const maintenance = {
    async run() {
      ran = true
      return { reaped_builds: 0, removed_releases: 2, removed_objects: 5 }
    },
  }
  await withApp({ maintenance, auth: scopedAuth(['release:write']) }, async (request) => {
    const response = await request('/v1/maintenance/storage-gc', { method: 'POST', headers: { 'x-api-key': 'valid' } })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { reaped_builds: 0, removed_releases: 2, removed_objects: 5 })
    assert.ok(ran)
  })
})

test('storage-gc rejects a site-restricted key', async () => {
  const auth = {
    async authenticate(headers) {
      return headers.get?.('x-api-key') === 'valid' || headers['x-api-key'] === 'valid'
        ? { scopes: ['release:write'], site_ids: ['s1'] }
        : null
    },
    authorize(principal, scope) {
      return Boolean(principal) && principal.scopes.includes(scope)
    },
  }
  const maintenance = {
    async run() {
      throw new Error('should not run')
    },
  }
  await withApp({ maintenance, auth }, async (request) => {
    const response = await request('/v1/maintenance/storage-gc', { method: 'POST', headers: { 'x-api-key': 'valid' } })
    assert.equal(response.status, 403)
  })
})

test('feed.xml is served as RSS while other xml stays application/xml', () => {
  assert.equal(releaseContentType('de/feed.xml'), 'application/rss+xml; charset=utf-8')
  assert.equal(releaseContentType('de/tags/react/feed.xml'), 'application/rss+xml; charset=utf-8')
  assert.equal(releaseContentType('sitemap.xml'), 'application/xml; charset=utf-8')
  assert.equal(releaseContentType('de/index.html'), 'text/html; charset=utf-8')
  assert.equal(releaseContentType('llms.txt'), 'text/plain; charset=utf-8')
  assert.equal(releaseContentType('de/llms-full.txt'), 'text/plain; charset=utf-8')
  assert.equal(releaseContentType('assets/report-chart-light-abc.svg'), 'image/svg+xml')
  assert.equal(releaseContentType('robots.txt'), 'text/plain; charset=utf-8')
  assert.equal(releaseContentType('assets/logo.woff2'), undefined)
})

describe('visual composition APIs', () => {
  const markdown = `---
kind: page
layout: composition
title: Tool call
locale: en
slug: tool-call
composition:
  format: infographic
  canvas: landscape
  intent: sequence
  preferredPattern: connected-process
---
:::process{title="Tool call" role="primary"}
- Client
- Server
- Tool
:::`

  test('the public Pattern Registry is filterable and cacheable', async () => {
    await withApp({}, async (request) => {
      const response = await request('/v1/composition-patterns?category=process&nodeType=process')
      assert.equal(response.status, 200)
      const etag = response.headers.get('etag')
      const body = await response.json()
      assert.ok(body.patterns.length >= 4)
      assert.ok(body.patterns.every((pattern) => pattern.category === 'process'))
      assert.ok(body.patterns.every((pattern) => pattern.accepts.node_types.includes('process')))

      const staticPatterns = await request('/v1/composition-patterns?capability=svg')
      assert.equal(staticPatterns.status, 200)
      assert.ok((await staticPatterns.json()).patterns.every((pattern) => pattern.capabilities.outputs.includes('svg')))

      const cached = await request('/v1/composition-patterns', { headers: { 'if-none-match': etag } })
      assert.equal(cached.status, 304)
      assert.equal(await cached.text(), '')
      assert.equal((await request('/v1/composition-patterns/not-a-pattern')).status, 404)
    })
  })

  test('publishing guides expose semantic story selection to humans and agents', async () => {
    await withApp({}, async (request) => {
      const response = await request('/v1/publishing-guides?kind=diagram')
      assert.equal(response.status, 200)
      const etag = response.headers.get('etag')
      const body = await response.json()
      assert.ok(body.guides.length >= 5)
      assert.ok(body.guides.every((guide) => guide.kind === 'diagram'))
      assert.ok(body.guides.every((guide) => guide.narrative.question && guide.selection.use_when.length))
      const guide = await request('/v1/publishing-guides/decision-report')
      assert.equal(guide.status, 200)
      assert.equal((await guide.json()).kind, 'report')
      const cached = await request('/v1/publishing-guides', { headers: { 'if-none-match': etag } })
      assert.equal(cached.status, 304)
      assert.equal((await request('/v1/publishing-guides/not-a-guide')).status, 404)
    })
  })

  test('site-scoped agents can recommend, validate and compile', async () => {
    const repo = {
      async getSite(slug) {
        return slug === 'my-site' ? { id: 'site-1', slug, settings: {} } : null
      },
    }
    await withApp({ repo, auth: scopedAuth(['content:write']) }, async (request) => {
      const headers = { 'x-api-key': 'valid', 'content-type': 'application/json' }
      const recommended = await request('/v1/sites/my-site/compositions/recommend', {
        method: 'POST',
        headers,
        body: JSON.stringify({ markdown, viewport: { width: 1200, height: 800 } }),
      })
      assert.equal(recommended.status, 200)
      assert.ok((await recommended.json()).recommendations.some((entry) => entry.pattern === 'connected-process'))

      const validated = await request('/v1/sites/my-site/compositions/validate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ markdown, pattern: 'connected-process' }),
      })
      assert.equal(validated.status, 200)
      assert.equal((await validated.json()).valid, true)

      const compiled = await request('/v1/sites/my-site/compositions/compile', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          markdown,
          outputs: ['svg', 'print'],
          scheme: 'light',
          viewport: { width: 1200, height: 800 },
          container: { width: 720, height: 680 },
          capabilities: ['svg'],
        }),
      })
      assert.equal(compiled.status, 200)
      const compileBody = await compiled.json()
      assert.match(compileBody.renders.svg, /^<svg/)
      assert.match(compileBody.renders.print_html, /composition-print/)
      assert.equal(compileBody.layout.responsive.container.width, 720)
      assert.equal(compileBody.render_tree.type, 'svg')
    })
  })
})

describe('published read API', () => {
  const PUBLISHED_DOC = {
    item_id: 'item-1',
    kind: 'post',
    locale: 'de',
    translation_key: 'hello',
    slug: 'hello',
    title: 'Hello',
    summary: 'Hi',
    tags: ['a'],
    metadata: { kind: 'post', title: 'Hello' },
    revision_id: 'rev-1',
    published_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-02T00:00:00.000Z',
    markdown: '# Hello',
    html: '<h1>Hello</h1>',
    source_sha256: 'abc123',
    _composition_assets: {
      light: { svg: '<svg/>', png: Buffer.from('png'), svg_sha256: 'svg-hash', png_sha256: 'png-hash' },
      dark: {
        svg: '<svg data-dark="true"/>',
        png: Buffer.from('dark-png'),
        svg_sha256: 'dark-svg',
        png_sha256: 'dark-png',
      },
    },
  }

  function publishedApiRepo(calls = []) {
    return {
      async getSite(slug) {
        return slug === 'my-site' ? { id: 'site-1', slug: 'my-site', publish_epoch: 7 } : null
      },
      async listPublished(siteId, query) {
        calls.push(['list', siteId, query])
        return { items: [{ item_id: 'item-1', slug: 'hello' }], next_cursor: null }
      },
      async getPublished(siteId, kind, locale, slug) {
        calls.push(['doc', siteId, kind, locale, slug])
        return slug === 'hello' && kind === 'post' && locale === 'de' ? { ...PUBLISHED_DOC } : null
      },
    }
  }

  test('both routes require content:read (401/403) and 404 an unknown site first', async () => {
    await withApp({ repo: publishedApiRepo(), auth: scopedAuth(['release:write']) }, async (request) => {
      for (const path of ['/v1/sites/my-site/published', '/v1/sites/my-site/published/post/de/hello']) {
        assert.equal((await request(path)).status, 401, path)
        const forbidden = await request(path, { headers: { 'x-api-key': 'valid' } })
        assert.equal(forbidden.status, 403, path)
        assert.deepEqual(await forbidden.json(), {
          error: 'insufficient_scope',
          scope: 'content:read',
          site: 'site-1',
        })
      }
      // The site lookup precedes the scope check, exactly like /content.
      assert.equal((await request('/v1/sites/nope/published', { headers: { 'x-api-key': 'valid' } })).status, 404)
    })
  })

  test('the list forwards filters, answers with the publish-epoch weak ETag and honours 304', async () => {
    const calls = []
    await withApp({ repo: publishedApiRepo(calls), auth: scopedAuth(['content:read']) }, async (request) => {
      const response = await request(
        '/v1/sites/my-site/published?kind=post&locale=de&tag=a&updated_since=2026-07-01T00:00:00Z&limit=2&cursor=abc',
        { headers: { 'x-api-key': 'valid' } },
      )
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('etag'), 'W/"7"')
      assert.deepEqual(await response.json(), { items: [{ item_id: 'item-1', slug: 'hello' }], next_cursor: null })
      assert.deepEqual(calls, [
        [
          'list',
          'site-1',
          { kind: 'post', locale: 'de', tag: 'a', updated_since: '2026-07-01T00:00:00Z', limit: '2', cursor: 'abc' },
        ],
      ])

      // A matching If-None-Match answers before any query work happens.
      calls.length = 0
      const cached = await request('/v1/sites/my-site/published', {
        headers: { 'x-api-key': 'valid', 'if-none-match': 'W/"7"' },
      })
      assert.equal(cached.status, 304)
      assert.equal(cached.headers.get('etag'), 'W/"7"')
      assert.equal(await cached.text(), '')
      assert.deepEqual(calls, [])
    })
  })

  test('the single document carries markdown and html, a strong ETag and a dedicated 404', async () => {
    await withApp({ repo: publishedApiRepo(), auth: scopedAuth(['content:read']) }, async (request) => {
      const response = await request('/v1/sites/my-site/published/post/de/hello', {
        headers: { 'x-api-key': 'valid' },
      })
      assert.equal(response.status, 200)
      // config.version is 'test' in withApp.
      const etag = response.headers.get('etag')
      assert.match(etag, /^"abc123:test:[0-9a-f]{16}:[0-9a-f]{16}"$/)
      const body = await response.json()
      assert.equal(body.markdown, '# Hello')
      assert.equal(body.html, '<h1>Hello</h1>')
      assert.equal(body.source_sha256, undefined, 'the ETag ingredient must not leak into the body')

      const cached = await request('/v1/sites/my-site/published/post/de/hello', {
        headers: { 'x-api-key': 'valid', 'if-none-match': etag },
      })
      assert.equal(cached.status, 304)
      assert.equal(cached.headers.get('etag'), etag)

      const missing = await request('/v1/sites/my-site/published/post/de/nope', {
        headers: { 'x-api-key': 'valid' },
      })
      assert.equal(missing.status, 404)
      assert.deepEqual(await missing.json(), { error: 'published content not found' })
    })
  })

  test('published composition representations are binary, scheme-aware and cacheable', async () => {
    await withApp({ repo: publishedApiRepo(), auth: scopedAuth(['content:read']) }, async (request) => {
      const response = await request('/v1/sites/my-site/published/post/de/hello/composition.svg?scheme=dark', {
        headers: { 'x-api-key': 'valid' },
      })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'image/svg+xml')
      assert.equal(await response.text(), '<svg data-dark="true"/>')
      assert.equal(response.headers.get('etag'), '"dark-svg"')

      const cached = await request('/v1/sites/my-site/published/post/de/hello/composition.svg?scheme=dark', {
        headers: { 'x-api-key': 'valid', 'if-none-match': '"dark-svg"' },
      })
      assert.equal(cached.status, 304)
      assert.equal(
        (
          await request('/v1/sites/my-site/published/post/de/hello/composition.png?scheme=sepia', {
            headers: { 'x-api-key': 'valid' },
          })
        ).status,
        422,
      )
    })
  })

  test('a repository 422 (malformed query) surfaces as a 422 response', async () => {
    const repo = {
      ...publishedApiRepo(),
      async listPublished() {
        throw Object.assign(new Error('limit must be a positive integer'), { statusCode: 422 })
      },
    }
    await withApp({ repo, auth: scopedAuth(['content:read']) }, async (request) => {
      const response = await request('/v1/sites/my-site/published?limit=abc', { headers: { 'x-api-key': 'valid' } })
      assert.equal(response.status, 422)
      assert.match((await response.json()).error, /positive integer/)
    })
  })

  test('OPTIONS advertises GET on both read-API routes', async () => {
    await withApp({}, async (request) => {
      for (const path of ['/v1/sites/my-site/published', '/v1/sites/my-site/published/post/de/hello']) {
        const response = await request(path, { method: 'OPTIONS' })
        assert.equal(response.status, 204, path)
        assert.equal(response.headers.get('allow'), 'GET, OPTIONS', path)
      }
    })
  })
})

describe('published search', () => {
  // The real repository over a stub db, so the route tests exercise the actual
  // query validation and the parameter forwarding into ck_search_published.
  function searchRepo(rpcCalls = [], rows = []) {
    return createRepository(
      {},
      {
        async select(table, query) {
          if (table === 'ck_sites' && query.slug === 'eq.my-site') {
            return [{ id: 'site-1', slug: 'my-site' }]
          }
          return []
        },
        async rpc(name, body) {
          rpcCalls.push([name, body])
          return rows
        },
      },
      {},
    )
  }

  test('the route requires content:read (401/403) and 404s an unknown site first', async () => {
    await withApp({ repo: searchRepo(), auth: scopedAuth(['release:write']) }, async (request) => {
      assert.equal((await request('/v1/sites/my-site/search?q=hallo')).status, 401)
      const forbidden = await request('/v1/sites/my-site/search?q=hallo', { headers: { 'x-api-key': 'valid' } })
      assert.equal(forbidden.status, 403)
      assert.deepEqual(await forbidden.json(), {
        error: 'insufficient_scope',
        scope: 'content:read',
        site: 'site-1',
      })
      // The site lookup precedes the scope check, exactly like the read API.
      assert.equal((await request('/v1/sites/nope/search?q=hallo', { headers: { 'x-api-key': 'valid' } })).status, 404)
    })
  })

  test('forwards q, locale, kind and limit into ck_search_published and returns uncached results', async () => {
    const rpcCalls = []
    const rows = [{ item_id: 'item-1', slug: 'hallo', rank: 0.5, headline: '<mark>Hallo</mark> Welt' }]
    await withApp({ repo: searchRepo(rpcCalls, rows), auth: scopedAuth(['content:read']) }, async (request) => {
      const response = await request('/v1/sites/my-site/search?q=+hallo+welt+&locale=de&kind=post&limit=5', {
        headers: { 'x-api-key': 'valid' },
      })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('etag'), null, 'search responses carry no ETag')
      // The query lands trimmed in both the SQL call and the response envelope.
      assert.deepEqual(await response.json(), { query: 'hallo welt', results: rows })
      assert.deepEqual(rpcCalls, [
        [
          'ck_search_published',
          { p_site_id: 'site-1', p_query: 'hallo welt', p_locale: 'de', p_kind: 'post', p_limit: 5 },
        ],
      ])

      // Absent filters become nulls, the limit defaults to 20 and caps at 100.
      rpcCalls.length = 0
      await request('/v1/sites/my-site/search?q=hallo', { headers: { 'x-api-key': 'valid' } })
      assert.deepEqual(rpcCalls[0][1], {
        p_site_id: 'site-1',
        p_query: 'hallo',
        p_locale: null,
        p_kind: null,
        p_limit: 20,
      })
      await request('/v1/sites/my-site/search?q=hallo&limit=500', { headers: { 'x-api-key': 'valid' } })
      assert.equal(rpcCalls[1][1].p_limit, 100)
    })
  })

  test('malformed queries are 422 with the documented messages', async () => {
    const rpcCalls = []
    await withApp({ repo: searchRepo(rpcCalls), auth: scopedAuth(['content:read']) }, async (request) => {
      const expect422 = async (query, message) => {
        const response = await request(`/v1/sites/my-site/search${query}`, { headers: { 'x-api-key': 'valid' } })
        assert.equal(response.status, 422, query)
        assert.equal((await response.json()).error, message, query)
      }
      await expect422('', 'q is required')
      await expect422('?q=+++', 'q is required')
      await expect422(`?q=${'a'.repeat(201)}`, 'q must be at most 200 characters')
      await expect422('?q=hallo&kind=article', 'kind must be page, post or project')
      await expect422('?q=hallo&limit=abc', 'limit must be a positive integer')
      await expect422('?q=hallo&limit=0', 'limit must be a positive integer')
      assert.deepEqual(rpcCalls, [], 'no search runs for a rejected query')
    })
  })

  test('OPTIONS advertises GET on the search route', async () => {
    await withApp({}, async (request) => {
      const response = await request('/v1/sites/my-site/search', { method: 'OPTIONS' })
      assert.equal(response.status, 204)
      assert.equal(response.headers.get('allow'), 'GET, OPTIONS')
    })
  })
})

describe('theme settings', () => {
  // The real repository over a stub db, so the PATCH exercises the actual
  // settings validation; `updates` records whether a write got through.
  function siteRepo(updates = []) {
    return createRepository(
      {},
      {
        async select(table, query) {
          if (table === 'ck_sites' && query.slug === 'eq.my-site') {
            return [{ id: 'site-1', slug: 'my-site' }]
          }
          return []
        },
        async update(table, filters, patch) {
          updates.push([table, filters, patch])
          return [{ id: 'site-1', slug: 'my-site', settings: patch.settings }]
        },
      },
      {},
    )
  }

  const patchSettings = (request, settings) =>
    request('/v1/sites/my-site', {
      method: 'PATCH',
      headers: { 'x-api-key': 'valid', 'content-type': 'application/json' },
      body: JSON.stringify({ settings }),
    })

  test('an unknown theme token 422s the whole PATCH instead of silently doing nothing', async () => {
    const updates = []
    await withApp({ repo: siteRepo(updates), auth: scopedAuth(['site:admin']) }, async (request) => {
      const response = await patchSettings(request, { theme: { tokens: { primry: '#dc2626' } } })
      assert.equal(response.status, 422)
      assert.equal((await response.json()).error, 'settings.theme.tokens: unknown token "primry"')

      const badValue = await patchSettings(request, { theme: { tokens: { primary: { light: '#fff' } } } })
      assert.equal(badValue.status, 422)
      assert.equal(
        (await badValue.json()).error,
        'settings.theme.tokens values must be strings or { light, dark } objects',
      )
      assert.deepEqual(updates, [], 'a rejected settings write must not reach the database')
    })
  })

  test('token values are capped at 256 bytes and must not contain "<"', async () => {
    const updates = []
    await withApp({ repo: siteRepo(updates), auth: scopedAuth(['site:admin']) }, async (request) => {
      // themeStyles() inlines every value into each generated page, so an
      // uncapped token would bloat the whole site the way custom_css could.
      const oversized = await patchSettings(request, { theme: { tokens: { font_family: 'x'.repeat(257) } } })
      assert.equal(oversized.status, 422)
      assert.equal((await oversized.json()).error, 'settings.theme.tokens values must not exceed 256 bytes')

      // Token values are emitted verbatim into a raw-text <style> element.
      const breakout = await patchSettings(request, {
        theme: { tokens: { primary: { light: '#fff', dark: '</style><script>' } } },
      })
      assert.equal(breakout.status, 422)
      assert.equal((await breakout.json()).error, 'settings.theme.tokens values must not contain "<"')

      // Quoted font stacks stay legal — the reason values are not HTML-escaped.
      const quoted = await patchSettings(request, {
        theme: { tokens: { font_family: '"Helvetica Neue", Arial, sans-serif' } },
      })
      assert.equal(quoted.status, 200)
      assert.deepEqual(updates.length, 1, 'only the valid write reaches the database')
    })
  })

  test('custom_css is capped at 8192 bytes, must be a string and must not contain "</style"', async () => {
    const updates = []
    await withApp({ repo: siteRepo(updates), auth: scopedAuth(['site:admin']) }, async (request) => {
      const oversized = await patchSettings(request, { theme: { custom_css: 'x'.repeat(8193) } })
      assert.equal(oversized.status, 422)
      assert.equal((await oversized.json()).error, 'settings.theme.custom_css must not exceed 8192 bytes')

      const nonString = await patchSettings(request, { theme: { custom_css: ['body{}'] } })
      assert.equal(nonString.status, 422)
      assert.equal((await nonString.json()).error, 'settings.theme.custom_css must be a string')

      const breakout = await patchSettings(request, { theme: { custom_css: 'body{}</STYLE><script>' } })
      assert.equal(breakout.status, 422)
      assert.equal((await breakout.json()).error, 'settings.theme.custom_css must not contain "</style"')
      assert.deepEqual(updates, [], 'a rejected settings write must not reach the database')
    })
  })

  test('valid theme settings pass validation and land in the update', async () => {
    const updates = []
    await withApp({ repo: siteRepo(updates), auth: scopedAuth(['site:admin']) }, async (request) => {
      const settings = {
        accent: '#2563eb',
        theme: {
          tokens: {
            background: { light: '#ffffff', dark: '#0b0b0c' },
            chart_1: { light: '#2563eb', dark: '#93c5fd' },
            radius: '0.75rem',
          },
          custom_css: '.hero{border:1px solid}',
        },
      }
      const response = await patchSettings(request, settings)
      assert.equal(response.status, 200)
      assert.equal(updates.length, 1)
      assert.deepEqual(updates[0][2].settings, settings)
    })
  })
})
