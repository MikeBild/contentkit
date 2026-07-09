import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../src/server.mjs'
import { releaseContentType } from '../../src/routes.mjs'
import { clientIp } from '../../src/security.mjs'
import { StorageError } from '../../src/storage.mjs'

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
  { db = {}, repo = {}, releases = {}, auth = {}, storage = {}, config = {}, maintenance } = {},
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
      logger: { info() {}, warn() {}, error() {}, debug() {} },
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
    await new Promise((resolve) => app.server.close(resolve))
  }
}

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

function mediaFixture(asset) {
  return {
    repo: {
      async getSiteByHost() {
        return null
      },
      async asset(id) {
        return id === asset.id ? asset : null
      },
    },
    storage: {
      async download() {
        return {
          async arrayBuffer() {
            return Buffer.from('bytes')
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
  assert.equal(releaseContentType('robots.txt'), 'text/plain; charset=utf-8')
  assert.equal(releaseContentType('assets/logo.woff2'), undefined)
})
