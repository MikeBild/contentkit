import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createAuth, hashApiKey } from '../../src/auth.mjs'
import { runMigrations } from '../../src/db/migrate.mjs'
import { createOAuthMount } from '../../src/oauth/server.mjs'
import { defaultProductScopes } from '../../src/oauth/policy.mjs'
import { createPostgres } from '../../src/postgres.mjs'

const databaseUrl = process.env.CONTENTKIT_TEST_DATABASE_URL
const logger = { info() {}, warn() {}, error() {} }
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

function encoded(values) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) params.append(key, value)
  return params.toString()
}

function hidden(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`))
  assert.ok(match, `expected hidden field ${name}`)
  return match[1]
}

function providerHref(html, id) {
  const match = html.match(new RegExp(`href="([^"]*provider=${encodeURIComponent(id)}[^"]*)"`))
  assert.ok(match, `expected provider link ${id}`)
  return match[1].replaceAll('&amp;', '&')
}

test(
  'ContentKit Cockpit signs in without an OAuth client and authenticates the API with the session cookie',
  { skip: databaseUrl ? false : 'CONTENTKIT_TEST_DATABASE_URL is not set', timeout: 30000 },
  async () => {
    await runMigrations({ databaseUrl }, logger)
    const pool = new pg.Pool({ connectionString: databaseUrl })
    const db = createPostgres({ databaseUrl }, { pool }).db
    const config = {
      publicUrl: 'https://contentkit-api.example.test',
      bootstrapApiKey: '',
      keyPepper: 'cockpit-integration-key-pepper',
      oauthAllowedScopes: ['mcp:read', 'mcp:authoring', 'mcp:admin'],
      oauthSecret: 'cockpit-integration-test-secret',
      oauthProviders: [{ protocol: 'api_key', id: 'api-key', label: 'ContentKit API key' }],
      root,
      version: '1.23.0-test',
    }
    const rawKey = `cockpit-operator-${randomUUID()}`
    await db.insert('ck_api_keys', {
      name: `Cockpit integration operator ${randomUUID()}`,
      key_hash: hashApiKey(rawKey, config.keyPepper),
      key_prefix: 'ck_ctest',
      scopes: defaultProductScopes('admin'),
      site_ids: [],
    })
    const auth = createAuth(config, db)
    const mount = createOAuthMount(config, { db, auth, audit: { async record() {} }, logger })

    try {
      // No client_id, no redirect_uri, no PKCE, no resource: the console asks
      // for a session, not for a token.
      const chooser = await mount.handler(
        new Request(`${config.publicUrl}/v1/identity/cockpit-login?return_to=/cockpit/sites`),
      )
      assert.equal(chooser.status, 200)
      const chooserHtml = await chooser.text()
      const method = await mount.handler(new Request(new URL(providerHref(chooserHtml, 'api-key'), config.publicUrl)))
      assert.equal(method.status, 200)
      const loginState = hidden(await method.text(), 'login_state')

      const signedIn = await mount.handler(
        new Request(`${config.publicUrl}/v1/identity/login/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: encoded({ provider: 'api-key', login_state: loginState, api_key: rawKey }),
        }),
      )
      // The cockpit exit redirects straight back instead of rendering consent.
      assert.equal(signedIn.status, 302)
      assert.equal(signedIn.headers.get('location'), '/cockpit/sites')
      const setCookie = signedIn.headers.get('set-cookie')
      assert.match(setCookie, /^__Host-contentkit_operator=/)
      assert.match(setCookie, /HttpOnly/)
      const cookie = setCookie.split(';')[0]

      // The very same cookie now authenticates the product API, resolving to
      // the grant's live ceiling rather than to anything stored on the session.
      const principal = await auth.authenticate({ cookie })
      assert.equal(principal.via, 'operator_session')
      assert.ok(principal.scopes.includes('release:write'))
      assert.equal(auth.authorize(principal, 'release:write'), true)

      const session = await mount.handler(
        new Request(`${config.publicUrl}/v1/identity/session`, { headers: { cookie } }),
      )
      assert.equal(session.status, 200)
      const body = await session.json()
      assert.equal(body.role, 'admin')
      assert.ok(body.csrf_token)
      assert.match(session.headers.get('set-cookie'), /^__Host-contentkit_csrf=/)

      // A cockpit login state is single-use: replaying it must not mint a
      // second session.
      const replay = await mount.handler(
        new Request(`${config.publicUrl}/v1/identity/login/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: encoded({ provider: 'api-key', login_state: loginState, api_key: rawKey }),
        }),
      )
      assert.notEqual(replay.status, 302)

      // An operator who already holds a session skips the chooser entirely.
      const returning = await mount.handler(
        new Request(`${config.publicUrl}/v1/identity/cockpit-login?return_to=/cockpit/releases`, {
          headers: { cookie },
        }),
      )
      assert.equal(returning.status, 302)
      assert.equal(returning.headers.get('location'), '/cockpit/releases')

      // An off-origin return_to is never honoured.
      const hijack = await mount.handler(
        new Request(`${config.publicUrl}/v1/identity/cockpit-login?return_to=//evil.example/`, {
          headers: { cookie },
        }),
      )
      assert.equal(hijack.headers.get('location'), '/cockpit/')

      const loggedOut = await mount.handler(
        new Request(`${config.publicUrl}/v1/identity/logout`, { method: 'POST', headers: { cookie } }),
      )
      assert.equal(loggedOut.status, 204)
      assert.equal(await auth.authenticate({ cookie }), null)
    } finally {
      mount.stop?.()
      await pool.end()
    }
  },
)
