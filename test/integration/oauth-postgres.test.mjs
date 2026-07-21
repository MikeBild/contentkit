import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createAuth, hashApiKey } from '../../src/auth.mjs'
import { runMigrations } from '../../src/db/migrate.mjs'
import { createMcpMount } from '../../src/mcp/server.mjs'
import { createOAuthMount } from '../../src/oauth/server.mjs'
import { defaultProductScopes } from '../../src/oauth/policy.mjs'
import { createPostgres } from '../../src/postgres.mjs'

const databaseUrl = process.env.CONTENTKIT_TEST_DATABASE_URL
const logger = { info() {}, warn() {}, error() {} }
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

function encoded(values) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry)
  }
  return params.toString()
}

function hidden(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`))
  assert.ok(match, `expected hidden field ${name}`)
  return match[1]
}

test(
  'OAuth authorization-code, PKCE, live scope ceiling, refresh rotation and replay work against PostgreSQL',
  { skip: databaseUrl ? false : 'CONTENTKIT_TEST_DATABASE_URL is not set', timeout: 30000 },
  async () => {
    await runMigrations({ databaseUrl }, logger)
    const pool = new pg.Pool({ connectionString: databaseUrl })
    const db = createPostgres({ databaseUrl }, { pool }).db
    const config = {
      publicUrl: 'https://contentkit-api.example.test',
      bootstrapApiKey: '',
      keyPepper: 'oauth-integration-key-pepper',
      oauthAllowedScopes: ['mcp:read', 'mcp:authoring', 'mcp:admin'],
      oauthDynamicRegistrationEnabled: true,
      oauthSecret: 'oauth-integration-test-secret',
      oauthLoginProvider: 'api_key',
      oauthOidcProviders: [],
      oauthAuthorizationCodeTtlMs: 10 * 60 * 1000,
      oauthAccessTokenTtlMs: 60 * 60 * 1000,
      oauthRefreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
      root,
      version: '1.23.0-test',
      mcpSessionTtlMs: 60_000,
      mcpMaxSessions: 10,
      mcpElicitationTimeoutMs: 30_000,
    }
    const [apiKey] = await db.insert('ck_api_keys', {
      name: `OAuth integration operator ${randomUUID()}`,
      key_hash: hashApiKey('operator-key', config.keyPepper),
      key_prefix: 'ck_itest',
      scopes: defaultProductScopes('admin'),
      site_ids: [],
    })
    const operatorAuth = createAuth(config, db)
    const mount = createOAuthMount(config, {
      db,
      auth: operatorAuth,
      audit: { async record() {} },
      logger,
    })
    let clientId
    try {
      const registered = await mount.handler(
        new Request(`${config.publicUrl}/v1/oauth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: 'ContentKit integration client',
            redirect_uris: ['https://client.example.test/callback'],
            token_endpoint_auth_method: 'none',
          }),
        }),
      )
      assert.equal(registered.status, 201)
      clientId = (await registered.json()).client_id

      const verifier = randomBytes(32).toString('base64url')
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      const authorizeUrl = new URL(`${config.publicUrl}/v1/oauth/authorize`)
      authorizeUrl.search = encoded({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: 'https://client.example.test/callback',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: `${config.publicUrl}/mcp`,
        scope: 'mcp:read',
        state: 'client-state',
      })
      const login = await mount.handler(new Request(authorizeUrl))
      assert.equal(login.status, 200)
      const loginState = hidden(await login.text(), 'login_state')

      const consent = await mount.handler(
        new Request(`${config.publicUrl}/v1/identity/login/api-key`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: encoded({ login_state: loginState, api_key: 'operator-key' }),
        }),
      )
      assert.equal(consent.status, 200)
      const cookie = consent.headers.get('set-cookie').split(';')[0]
      const consentHtml = await consent.text()
      const csrf = hidden(consentHtml, 'csrf_token')

      // A forged checkbox may not expand the scopes requested by the OAuth client.
      const decisionBody = encoded({
        login_state: loginState,
        csrf_token: csrf,
        decision: 'approve',
        scope: ['mcp:read', 'mcp:admin'],
      })
      const approved = await mount.handler(
        new Request(`${config.publicUrl}/v1/oauth/authorize/decision`, {
          method: 'POST',
          headers: {
            cookie,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: decisionBody,
        }),
      )
      assert.equal(approved.status, 302)
      const callback = new URL(approved.headers.get('location'))
      assert.equal(callback.searchParams.get('state'), 'client-state')
      const code = callback.searchParams.get('code')
      assert.ok(code)

      const duplicateDecision = await mount.handler(
        new Request(`${config.publicUrl}/v1/oauth/authorize/decision`, {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
          body: decisionBody,
        }),
      )
      assert.equal(duplicateDecision.status, 400)
      assert.equal((await duplicateDecision.json()).error, 'invalid_request')

      const tokenUrl = `${config.publicUrl}/v1/oauth/token`
      const badExchange = await mount.handler(
        new Request(tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: encoded({
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            redirect_uri: 'https://client.example.test/callback',
            code_verifier: randomBytes(32).toString('base64url'),
            resource: `${config.publicUrl}/mcp`,
          }),
        }),
      )
      assert.equal(badExchange.status, 400)
      assert.equal((await badExchange.json()).error, 'invalid_grant')

      // A bad PKCE attempt must not consume the single-use authorization code.
      const exchanged = await mount.handler(
        new Request(tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: encoded({
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            redirect_uri: 'https://client.example.test/callback',
            code_verifier: verifier,
            resource: `${config.publicUrl}/mcp`,
          }),
        }),
      )
      assert.equal(exchanged.status, 200)
      const first = await exchanged.json()
      assert.match(first.access_token, /^cko_[A-Za-z0-9_-]{43}$/)
      assert.match(first.refresh_token, /^ckr_[A-Za-z0-9_-]{43}$/)
      assert.equal(first.scope, 'mcp:read')
      assert.equal(first.resource, `${config.publicUrl}/mcp`)

      const liveAuth = createAuth(config, db)
      const principal = await liveAuth.authenticate(new Headers({ authorization: `Bearer ${first.access_token}` }))
      assert.deepEqual(principal.scopes, ['content:read', 'stats:read'])

      await db.update('ck_api_keys', { id: `eq.${apiKey.id}` }, { revoked_at: new Date().toISOString() })
      assert.equal(await liveAuth.authenticate(new Headers({ authorization: `Bearer ${first.access_token}` })), null)
      await db.update('ck_api_keys', { id: `eq.${apiKey.id}` }, { revoked_at: null })
      assert.ok(await liveAuth.authenticate(new Headers({ authorization: `Bearer ${first.access_token}` })))
      const rotatedPepperAuth = createAuth({ ...config, keyPepper: 'rotated-key-pepper' }, db)
      assert.equal(
        await rotatedPepperAuth.authenticate(new Headers({ authorization: `Bearer ${first.access_token}` })),
        null,
      )

      const mcp = createMcpMount(config, {
        auth: liveAuth,
        logger,
        usage: { async recordMcp() {}, quality: () => ({}) },
        repo: { async getSite() {} },
        secretHandoffs: { setNotifier() {} },
      })
      try {
        const initialized = await mcp.handler(
          new Request(`${config.publicUrl}/mcp`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${first.access_token}`,
              accept: 'application/json, text/event-stream',
              'content-type': 'application/json',
              'mcp-protocol-version': '2025-11-25',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'oauth-postgres-itest', version: '1' },
              },
            }),
          }),
        )
        assert.equal(initialized.status, 200)
        const data = (await initialized.text()).split('\n').find((line) => line.startsWith('data:'))
        assert.ok(data)
        assert.equal(JSON.parse(data.slice(5)).result.serverInfo.name, 'contentkit')
      } finally {
        await mcp.stop()
      }

      const refreshed = await mount.handler(
        new Request(tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: encoded({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: first.refresh_token,
            resource: `${config.publicUrl}/mcp`,
          }),
        }),
      )
      assert.equal(refreshed.status, 200)
      const second = await refreshed.json()
      assert.notEqual(second.access_token, first.access_token)
      assert.notEqual(second.refresh_token, first.refresh_token)

      const replay = await mount.handler(
        new Request(tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: encoded({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: first.refresh_token,
            resource: `${config.publicUrl}/mcp`,
          }),
        }),
      )
      assert.equal(replay.status, 400)
      assert.equal((await replay.json()).error, 'invalid_grant')
      assert.equal(await liveAuth.authenticate(new Headers({ authorization: `Bearer ${second.access_token}` })), null)
    } finally {
      if (clientId) await pool.query('DELETE FROM ck_oauth_clients WHERE client_id=$1', [clientId]).catch(() => {})
      await pool
        .query("DELETE FROM ck_oauth_identity_grants WHERE provider_id='api-key' AND subject=$1", [apiKey.id])
        .catch(() => {})
      await pool.query('DELETE FROM ck_api_keys WHERE id=$1', [apiKey.id]).catch(() => {})
      await pool.end()
    }
  },
)
