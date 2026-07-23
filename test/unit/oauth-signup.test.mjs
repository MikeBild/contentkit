import test from 'node:test'
import assert from 'node:assert/strict'
import { createOAuthMount } from '../../src/oauth/server.mjs'
import { hmac256 } from '../../src/utils.mjs'

const logger = { info() {}, warn() {} }
const RAW_STATE = `ckls_${'a'.repeat(43)}`
const REDIRECT_URI = 'https://client.example.test/callback'

function baseConfig(overrides = {}) {
  return {
    publicUrl: 'https://contentkit-api.example.test',
    oauthSecret: 'signup-test-secret',
    keyPepper: 'signup-test-pepper',
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
    ...overrides,
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
    provider_id: 'workforce',
    oidc_nonce: 'nonce',
    oidc_code_verifier: 'verifier',
    grant_id: null,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    consumed_at: null,
    ...overrides,
  }
}

// Same injection seam as oauth-browser-errors.test.mjs, extended with a
// query() that understands the signup INSERT ... ON CONFLICT DO NOTHING and a
// select() honouring the revoked_at/subject filters the signup path relies on.
function fakeDb(rows, { grantInsertConflicts = false } = {}) {
  const calls = { insert: [], update: [], query: [] }
  let signupSequence = 0
  return {
    calls,
    async select(table, filters = {}) {
      let result = rows[table] || []
      if (filters.revoked_at === 'is.null') result = result.filter((row) => !row.revoked_at)
      if (typeof filters.subject === 'string') {
        result = result.filter((row) => String(row.subject) === filters.subject.replace(/^eq\./, ''))
      }
      return result.map((row) => ({ ...row }))
    },
    async insert(table, values) {
      calls.insert.push({ table, values })
      return [{ id: `inserted-${calls.insert.length}`, ...values }]
    },
    async update(table, filter, values) {
      calls.update.push({ table, filter, values })
      return [{ ...values }]
    },
    async query(sql, params) {
      calls.query.push({ sql, params })
      if (/INSERT INTO ck_oauth_identity_grants/.test(sql)) {
        if (grantInsertConflicts) return []
        signupSequence += 1
        return [
          {
            id: `signup-grant-${signupSequence}`,
            provider_id: params[0],
            issuer: params[1],
            subject: params[2],
            email: params[3],
            display_name: params[4],
            role: 'reader',
            product_scopes: [...params[5]],
            site_ids: [],
            revoked_at: null,
          },
        ]
      }
      return []
    },
  }
}

function recordingAudit() {
  const events = []
  return {
    events,
    async record(event) {
      events.push(event)
    },
  }
}

function mountWith(config, db, oidc, audit = recordingAudit()) {
  return { mount: createOAuthMount(config, { db, auth: {}, audit, logger, oidc }), audit }
}

function signupInserts(db) {
  return db.calls.query.filter((call) => /INSERT INTO ck_oauth_identity_grants/.test(call.sql))
}

test('signup off (default): an unknown identity is still denied and nothing is provisioned', async () => {
  const config = baseConfig()
  const db = fakeDb({
    ck_oauth_login_states: [loginStateRow(config)],
    ck_oauth_clients: [
      { client_id: 'client-1', client_name: 'MCP client', redirect_uris: [REDIRECT_URI], revoked_at: null },
    ],
    ck_oauth_identity_grants: [],
  })
  const { mount, audit } = mountWith(config, db, {
    async finishOidcLogin() {
      return { subject: 'unknown-operator', email: null, name: null }
    },
  })
  const response = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/callback?state=${RAW_STATE}&code=abc`),
  )
  assert.equal(response.status, 302)
  const location = new URL(response.headers.get('location'))
  assert.equal(location.searchParams.get('error'), 'access_denied')
  assert.equal(signupInserts(db).length, 0, 'the default-off switch must not provision any grant')
  assert.equal(audit.events.filter((event) => event.action === 'oauth.signup').length, 0)
})

test('signup on: an unknown identity is provisioned as reader and reaches the consent page', async () => {
  const config = baseConfig({ oauthSignupEnabled: true })
  const db = fakeDb({
    ck_oauth_login_states: [loginStateRow(config)],
    ck_oauth_clients: [
      { client_id: 'client-1', client_name: 'MCP client', redirect_uris: [REDIRECT_URI], revoked_at: null },
    ],
    ck_oauth_identity_grants: [],
  })
  const { mount, audit } = mountWith(config, db, {
    async finishOidcLogin() {
      return { subject: 'new-operator', email: 'new.operator@example.test', name: 'New Operator' }
    },
  })
  const response = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/callback?state=${RAW_STATE}&code=abc`),
  )
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/html/)
  const inserts = signupInserts(db)
  assert.equal(inserts.length, 1)
  const [providerId, issuer, subject, email, displayName, productScopes] = inserts[0].params
  assert.equal(providerId, 'workforce')
  assert.equal(issuer, 'https://issuer.example.test')
  assert.equal(subject, 'new-operator')
  assert.equal(email, 'new.operator@example.test')
  assert.equal(displayName, 'New Operator')
  assert.deepEqual(productScopes, ['content:read', 'stats:read'])
  assert.match(inserts[0].sql, /'reader'/)
  assert.match(inserts[0].sql, /'signup'/, 'self-provisioned grants must be marked grant_source=signup')
  assert.match(inserts[0].sql, /ON CONFLICT \(provider_id, issuer, subject\) DO NOTHING/)
  const signupEvents = audit.events.filter((event) => event.action === 'oauth.signup')
  assert.equal(signupEvents.length, 1)
  assert.equal(signupEvents[0].resourceType, 'oauth_grant')
  assert.equal(signupEvents[0].result, 'success')
})

test('signup on: display_name falls back to the verified email when no name claim exists', async () => {
  const config = baseConfig({ oauthSignupEnabled: true })
  const db = fakeDb({
    ck_oauth_login_states: [loginStateRow(config)],
    ck_oauth_clients: [
      { client_id: 'client-1', client_name: 'MCP client', redirect_uris: [REDIRECT_URI], revoked_at: null },
    ],
    ck_oauth_identity_grants: [],
  })
  const { mount } = mountWith(config, db, {
    async finishOidcLogin() {
      return { subject: 'new-operator', email: 'new.operator@example.test', name: null }
    },
  })
  const response = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/callback?state=${RAW_STATE}&code=abc`),
  )
  assert.equal(response.status, 200)
  assert.equal(signupInserts(db)[0].params[4], 'new.operator@example.test')
})

test('signup on: a known identity uses its existing grant and no new grant is inserted', async () => {
  const config = baseConfig({ oauthSignupEnabled: true })
  const db = fakeDb({
    ck_oauth_login_states: [loginStateRow(config)],
    ck_oauth_clients: [
      { client_id: 'client-1', client_name: 'MCP client', redirect_uris: [REDIRECT_URI], revoked_at: null },
    ],
    ck_oauth_identity_grants: [
      {
        id: 'grant-existing',
        provider_id: 'workforce',
        issuer: 'https://issuer.example.test',
        subject: 'known-operator',
        email: 'known@example.test',
        display_name: 'Known Operator',
        role: 'admin',
        product_scopes: ['content:read'],
        site_ids: [],
        revoked_at: null,
      },
    ],
  })
  const { mount, audit } = mountWith(config, db, {
    async finishOidcLogin() {
      return { subject: 'known-operator', email: 'known@example.test', name: 'Known Operator' }
    },
  })
  const response = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/callback?state=${RAW_STATE}&code=abc`),
  )
  assert.equal(response.status, 200)
  assert.equal(signupInserts(db).length, 0, 'an existing grant must never be re-provisioned')
  assert.equal(audit.events.filter((event) => event.action === 'oauth.signup').length, 0)
  // The consent page derives the offered mcp tiers from the stored
  // product-scope ceiling, not from the denormalized role: this grant says
  // role=admin but its ceiling is only content:read, so authoring is absent.
  const consentHtml = await response.text()
  assert.match(consentHtml, /value="mcp:read"/)
  assert.doesNotMatch(consentHtml, /value="mcp:authoring"/)
  assert.doesNotMatch(consentHtml, /value="mcp:admin"/)
})

test('signup on: a revoked grant is never resurrected and sign-in stays denied', async () => {
  const config = baseConfig({ oauthSignupEnabled: true })
  const db = fakeDb(
    {
      ck_oauth_login_states: [loginStateRow(config)],
      ck_oauth_clients: [
        { client_id: 'client-1', client_name: 'MCP client', redirect_uris: [REDIRECT_URI], revoked_at: null },
      ],
      ck_oauth_identity_grants: [
        {
          id: 'grant-revoked',
          provider_id: 'workforce',
          issuer: 'https://issuer.example.test',
          subject: 'revoked-operator',
          role: 'reader',
          product_scopes: ['content:read', 'stats:read'],
          site_ids: [],
          revoked_at: new Date().toISOString(),
        },
      ],
    },
    { grantInsertConflicts: true },
  )
  const { mount, audit } = mountWith(config, db, {
    async finishOidcLogin() {
      return { subject: 'revoked-operator', email: null, name: null }
    },
  })
  const response = await mount.handler(
    new Request(`${config.publicUrl}/v1/identity/login/callback?state=${RAW_STATE}&code=abc`),
  )
  assert.equal(response.status, 302)
  assert.equal(new URL(response.headers.get('location')).searchParams.get('error'), 'access_denied')
  assert.equal(audit.events.filter((event) => event.action === 'oauth.signup').length, 0)
})

test('headless POST /v1/identity/sessions respects the signup switch in both states', async () => {
  const identity = { subject: 'headless-operator', email: 'headless@example.test', name: 'Headless Operator' }
  const request = (config) =>
    new Request(`${config.publicUrl}/v1/identity/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider_id: 'workforce', identity_token: 'assertion' }),
    })
  const oidc = {
    async verifyOidcIdentityToken() {
      return { ...identity }
    },
  }

  const offConfig = baseConfig()
  const offDb = fakeDb({ ck_oauth_identity_grants: [] })
  const off = mountWith(offConfig, offDb, oidc)
  const denied = await off.mount.handler(request(offConfig))
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error, 'access_denied')
  assert.equal(signupInserts(offDb).length, 0)

  const onConfig = baseConfig({ oauthSignupEnabled: true })
  const onDb = fakeDb({ ck_oauth_identity_grants: [] })
  const on = mountWith(onConfig, onDb, oidc)
  const created = await on.mount.handler(request(onConfig))
  assert.equal(created.status, 200)
  const session = await created.json()
  assert.match(session.api_key, /^ck_/)
  assert.equal(session.principal_id, 'signup-grant-1')
  assert.equal(session.email, 'headless@example.test')
  assert.equal(signupInserts(onDb).length, 1)
  const keyInsert = onDb.calls.insert.find((call) => call.table === 'ck_api_keys')
  assert.ok(keyInsert, 'the headless exchange must still mint a scoped API key')
  assert.deepEqual(keyInsert.values.scopes, ['content:read', 'stats:read'])
  assert.equal(on.audit.events.filter((event) => event.action === 'oauth.signup').length, 1)
})
