import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createAuth, hashApiKey } from '../../src/auth.mjs'
import { runMigrations } from '../../src/db/migrate.mjs'
import { createOAuthMount } from '../../src/oauth/server.mjs'
import { createPostgres } from '../../src/postgres.mjs'
import { createApp } from '../../src/server.mjs'

const databaseUrl = process.env.CONTENTKIT_TEST_DATABASE_URL
const logger = { info() {}, warn() {}, error() {}, debug() {} }
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

// Scope-ceiling contract v1 end to end against PostgreSQL: the admin REST is
// the management surface, product_scopes is the only stored truth, changes are
// effective immediately on the auth path (no restart) and revoked_at always
// wins until an explicit restore.
test(
  'identity-grant admin REST: scopes-only create, seed takeover, immediate revoke and explicit restore',
  { skip: databaseUrl ? false : 'CONTENTKIT_TEST_DATABASE_URL is not set', timeout: 30000 },
  async () => {
    await runMigrations({ databaseUrl }, logger)
    const pool = new pg.Pool({ connectionString: databaseUrl })
    const db = createPostgres({ databaseUrl }, { pool }).db
    const subject = `itest-operator-${randomUUID()}`
    const config = {
      publicUrl: 'https://contentkit-api.example.test',
      version: 'itest',
      root,
      trustProxy: false,
      maxBodyBytes: 1024 * 1024,
      keyPepper: 'identity-grants-itest-pepper',
      oauthSecret: 'identity-grants-itest-oauth-secret',
      oauthAllowedScopes: ['mcp:read', 'mcp:authoring', 'mcp:admin'],
      oauthProviders: [
        {
          protocol: 'oidc',
          id: 'corp',
          label: 'Corporate SSO',
          issuer: 'https://login.example.test',
          clientId: 'contentkit',
          scopes: 'openid email profile',
        },
      ],
    }
    const [adminKey] = await db.insert('ck_api_keys', {
      name: `identity-grants itest admin ${randomUUID()}`,
      key_hash: hashApiKey('itest-admin-key', config.keyPepper),
      key_prefix: 'ck_itest',
      scopes: ['identity:admin'],
      site_ids: [],
    })
    const auth = createAuth(config, db)
    const app = createApp(config, {
      logger,
      database: { db, async close() {} },
      storage: {},
      repo: {},
      releases: {
        inflight() {
          return 0
        },
      },
      auth,
      outbox: { start() {}, stop() {} },
    })
    const oauthMount = createOAuthMount(config, {
      db,
      auth,
      audit: { async record() {} },
      logger,
      oidc: {
        async verifyOidcIdentityToken() {
          return { subject, email: 'itest.operator@example.test', name: 'Itest Operator' }
        },
      },
    })
    await new Promise((resolve) => {
      app.server.listen(0, '127.0.0.1', resolve)
    })
    const { port } = app.server.address()
    const rest = (path, init = {}) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        ...init,
        headers: { 'x-api-key': 'itest-admin-key', ...(init.headers || {}) },
      })
    const headlessLogin = () =>
      oauthMount.handler(
        new Request(`${config.publicUrl}/v1/identity/sessions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider_id: 'corp', identity_token: 'assertion' }),
        }),
      )
    let grantId
    try {
      // scopes-only create (no role): the denormalized role is derived
      const created = await rest('/v1/identity-grants', {
        method: 'POST',
        body: JSON.stringify({
          provider_id: 'corp',
          issuer: 'https://login.example.test',
          subject,
          email: 'itest.operator@example.test',
          product_scopes: ['content:read', 'stats:read'],
          source: 'seed',
        }),
      })
      assert.equal(created.status, 201)
      const grant = await created.json()
      grantId = grant.id
      assert.deepEqual(grant.product_scopes, ['content:read', 'stats:read'])
      assert.equal(grant.role, 'reader')
      assert.equal(grant.grant_source, 'seed')
      assert.equal('source_credential_hash' in grant, false)

      // GET filters find exactly this row and expose grant_source
      const listed = await rest(`/v1/identity-grants?provider_id=corp&subject=${encodeURIComponent(subject)}`)
      assert.equal(listed.status, 200)
      const identities = (await listed.json()).identities
      assert.equal(identities.length, 1)
      assert.equal(identities[0].grant_source, 'seed')

      // the live grant admits the identity through the headless exchange
      const firstLogin = await headlessLogin()
      assert.equal(firstLogin.status, 200)
      assert.equal((await firstLogin.json()).principal_id, grantId)
      const [mintedKey] = await pool
        .query("SELECT scopes FROM ck_api_keys WHERE name LIKE 'SSO %' ORDER BY created_at DESC LIMIT 1")
        .then((result) => result.rows)
      assert.deepEqual(mintedKey.scopes, ['content:read', 'stats:read'])

      // a manual PATCH without source takes the row over from the seeder
      const takeover = await rest(`/v1/identity-grants/${grantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ display_name: 'Managed by hand' }),
      })
      assert.equal(takeover.status, 200)
      assert.equal((await takeover.json()).grant_source, 'admin')

      // DELETE revokes and the very next login is denied — no restart involved
      const revoked = await rest(`/v1/identity-grants/${grantId}`, { method: 'DELETE' })
      assert.equal(revoked.status, 200)
      const deniedLogin = await headlessLogin()
      assert.equal(deniedLogin.status, 403)
      assert.equal((await deniedLogin.json()).error, 'access_denied')

      // a PATCH without restore never matches the revoked row
      const blindPatch = await rest(`/v1/identity-grants/${grantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: 'admin' }),
      })
      assert.equal(blindPatch.status, 404)

      // restore:true is the only way back; the identity signs in again
      const restored = await rest(`/v1/identity-grants/${grantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ restore: true }),
      })
      assert.equal(restored.status, 200)
      assert.equal((await restored.json()).revoked_at, null)
      const backIn = await headlessLogin()
      assert.equal(backIn.status, 200)
    } finally {
      app.limiter.stop()
      app.loginLimiter.stop()
      app.deckJobs.stop()
      await new Promise((resolve) => app.server.close(resolve))
      if (grantId) await pool.query('DELETE FROM ck_oauth_identity_grants WHERE id=$1', [grantId]).catch(() => {})
      await pool.query('DELETE FROM ck_api_keys WHERE id=$1', [adminKey.id]).catch(() => {})
      await pool.query("DELETE FROM ck_api_keys WHERE name LIKE 'SSO %itest.operator@example.test%'").catch(() => {})
      await pool.end()
    }
  },
)
