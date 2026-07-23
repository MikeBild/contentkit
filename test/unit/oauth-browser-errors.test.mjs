import test from 'node:test'
import assert from 'node:assert/strict'
import { createOAuthMount } from '../../src/oauth/server.mjs'
import { hmac256 } from '../../src/utils.mjs'

const logger = { info() {}, warn() {} }
const RAW_STATE = `ckls_${'a'.repeat(43)}`
const REDIRECT_URI = 'https://client.example.test/callback'

function baseConfig() {
  return {
    publicUrl: 'https://contentkit-api.example.test',
    oauthSecret: 'browser-error-test-secret',
    oauthAllowedScopes: ['mcp:read', 'mcp:authoring', 'mcp:admin'],
    oauthDynamicRegistrationEnabled: true,
    oauthProviders: [
      { protocol: 'api_key', id: 'api-key', label: 'ContentKit API key' },
      {
        protocol: 'oidc',
        id: 'workforce',
        label: 'SSO',
        issuer: 'https://issuer.example.test',
        clientId: 'contentkit',
        scopes: 'openid email profile',
      },
    ],
  }
}

function loginStateRow(config, overrides = {}) {
  return {
    id: 'state-row-1',
    state_hash: hmac256(config.oauthSecret, RAW_STATE),
    client_id: 'client-1',
    redirect_uri: REDIRECT_URI,
    requested_scopes: ['mcp:read', 'mcp:authoring'],
    code_challenge: 'C'.repeat(43),
    resource: `${config.publicUrl}/mcp`,
    client_state: 'client-opaque-state',
    provider_id: null,
    oidc_nonce: null,
    oidc_code_verifier: null,
    grant_id: null,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    consumed_at: null,
    ...overrides,
  }
}

function fakeDb(rows) {
  const calls = { insert: [], update: [] }
  return {
    calls,
    async select(table) {
      return (rows[table] || []).map((row) => ({ ...row }))
    },
    async insert(table, values) {
      calls.insert.push({ table, values })
      return [{ id: `inserted-${calls.insert.length}`, ...values }]
    },
    async update(table, filter, values) {
      calls.update.push({ table, filter, values })
      return [{ ...values }]
    },
    async query() {
      return []
    },
  }
}

function mountWith(config, db, oidc) {
  return createOAuthMount(config, { db, auth: {}, audit: { async record() {} }, logger, oidc })
}

test('every Continue-with-SSO click starts a fresh login state and keeps the old one intact', async () => {
  const config = baseConfig()
  const db = fakeDb({ ck_oauth_login_states: [loginStateRow(config)] })
  let starts = 0
  const seenStates = []
  const mount = mountWith(config, db, {
    async startOidcLogin({ state }) {
      starts += 1
      seenStates.push(state)
      return {
        authorizationUrl: `https://issuer.example.test/authorize?state=${state}`,
        codeVerifier: `verifier-${starts}`,
        nonce: `nonce-${starts}`,
      }
    },
  })
  const url = `${config.publicUrl}/v1/identity/login/start?login_state=${RAW_STATE}&provider=workforce`
  const first = await mount.handler(new Request(url))
  const second = await mount.handler(new Request(url))
  assert.equal(first.status, 302)
  assert.equal(second.status, 302)
  assert.equal(starts, 2)
  const inserted = db.calls.insert.filter((call) => call.table === 'ck_oauth_login_states')
  assert.equal(inserted.length, 2, 'each SSO click must insert its own login state')
  assert.equal(
    db.calls.update.filter((call) => call.table === 'ck_oauth_login_states').length,
    0,
    'an existing login state must never have its nonce or code verifier overwritten',
  )
  const originalHash = hmac256(config.oauthSecret, RAW_STATE)
  for (const [index, call] of inserted.entries()) {
    assert.notEqual(call.values.state_hash, originalHash)
    assert.match(seenStates[index], /^ckls_[A-Za-z0-9_-]{43}$/)
    assert.notEqual(seenStates[index], RAW_STATE)
    assert.equal(call.values.state_hash, hmac256(config.oauthSecret, seenStates[index]))
    assert.equal(call.values.client_id, 'client-1')
    assert.equal(call.values.redirect_uri, REDIRECT_URI)
    assert.equal(call.values.provider_id, 'workforce')
    assert.equal(call.values.oidc_nonce, `nonce-${index + 1}`)
    assert.equal(call.values.oidc_code_verifier, `verifier-${index + 1}`)
  }
  assert.notEqual(inserted[0].values.state_hash, inserted[1].values.state_hash)
  assert.equal(first.headers.get('location'), `https://issuer.example.test/authorize?state=${seenStates[0]}`)
})

test('a missing identity grant redirects the waiting validated OAuth client with error=access_denied', async () => {
  const config = baseConfig()
  const db = fakeDb({
    ck_oauth_login_states: [
      loginStateRow(config, { provider_id: 'workforce', oidc_nonce: 'nonce', oidc_code_verifier: 'verifier' }),
    ],
    ck_oauth_clients: [
      { client_id: 'client-1', client_name: 'MCP client', redirect_uris: [REDIRECT_URI], revoked_at: null },
    ],
    ck_oauth_identity_grants: [],
  })
  const mount = mountWith(config, db, {
    async finishOidcLogin() {
      return { subject: 'unknown-operator', email: null }
    },
  })
  const response = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/callback?state=${RAW_STATE}&code=abc`),
  )
  assert.equal(response.status, 302)
  const location = new URL(response.headers.get('location'))
  assert.equal(`${location.origin}${location.pathname}`, REDIRECT_URI)
  assert.equal(location.searchParams.get('error'), 'access_denied')
  assert.equal(location.searchParams.get('state'), 'client-opaque-state')
})

test('a missing identity grant without a validated client renders the human sign-in error page', async () => {
  const config = baseConfig()
  const db = fakeDb({
    ck_oauth_login_states: [
      loginStateRow(config, { provider_id: 'workforce', oidc_nonce: 'nonce', oidc_code_verifier: 'verifier' }),
    ],
    ck_oauth_clients: [],
    ck_oauth_identity_grants: [],
  })
  const mount = mountWith(config, db, {
    async finishOidcLogin() {
      return { subject: 'unknown-operator', email: null }
    },
  })
  const response = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/callback?state=${RAW_STATE}&code=abc`),
  )
  assert.equal(response.status, 403)
  assert.match(response.headers.get('content-type'), /text\/html/)
  const html = await response.text()
  assert.match(html, /<h1>Sign-in failed<\/h1>/)
  assert.match(html, /Your account is not authorized for ContentKit\. Contact the operator\./)
  assert.match(html, /href="\/v1\/identity\/login\/start">Sign in again<\/a>/)
  assert.match(html, /data-auth-contract="mcp-auth-v2"/)
})

test('an OIDC code-exchange failure unblocks the validated waiting client instead of dead-ending', async () => {
  const config = baseConfig()
  const db = fakeDb({
    ck_oauth_login_states: [
      loginStateRow(config, { provider_id: 'workforce', oidc_nonce: 'nonce', oidc_code_verifier: 'verifier' }),
    ],
    ck_oauth_clients: [
      { client_id: 'client-1', client_name: 'MCP client', redirect_uris: [REDIRECT_URI], revoked_at: null },
    ],
  })
  const mount = mountWith(config, db, {
    async finishOidcLogin() {
      throw new Error('authorization code exchange failed')
    },
  })
  const response = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/callback?state=${RAW_STATE}&code=abc`),
  )
  assert.equal(response.status, 302)
  const location = new URL(response.headers.get('location'))
  assert.equal(location.searchParams.get('error'), 'access_denied')
})

test('an unknown or expired callback state renders the browser error page, JSON only on request', async () => {
  const config = baseConfig()
  const mount = mountWith(config, fakeDb({ ck_oauth_login_states: [] }), {})
  const browser = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/callback?state=${RAW_STATE}&code=abc`),
  )
  assert.equal(browser.status, 400)
  assert.match(browser.headers.get('content-type'), /text\/html/)
  const html = await browser.text()
  assert.match(html, /This sign-in attempt expired or was already used\. Please sign in again\./)
  assert.match(html, /Sign in again/)

  const api = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/callback?state=${RAW_STATE}&code=abc`, {
      headers: { accept: 'application/json' },
    }),
  )
  assert.equal(api.status, 400)
  assert.match(api.headers.get('content-type'), /application\/json/)
  assert.equal((await api.json()).error, 'invalid_request')
})

test('an expired login_state on the browser chooser renders HTML instead of JSON', async () => {
  const config = baseConfig()
  const mount = mountWith(config, fakeDb({ ck_oauth_login_states: [] }), {})
  const browser = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/start?login_state=${RAW_STATE}`),
  )
  assert.equal(browser.status, 400)
  assert.match(browser.headers.get('content-type'), /text\/html/)
  const html = await browser.text()
  assert.match(html, /<h1>Sign-in failed<\/h1>/)
  assert.match(html, /This sign-in attempt expired or was already used\. Please sign in again\./)

  const api = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/start?login_state=${RAW_STATE}`, {
      headers: { accept: 'application/json' },
    }),
  )
  assert.match(api.headers.get('content-type'), /application\/json/)
  assert.equal((await api.json()).error, 'invalid_request')
})

test('non-browser OAuth endpoints keep the JSON error contract', async () => {
  const config = baseConfig()
  const mount = mountWith(config, fakeDb({ ck_oauth_clients: [] }), {})
  const response = await mount.handler(
    new Request(`${config.publicUrl}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code&client_id=missing',
    }),
  )
  assert.equal(response.status, 400)
  assert.match(response.headers.get('content-type'), /application\/json/)
  assert.equal((await response.json()).error, 'invalid_client')
})
