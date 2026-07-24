import test from 'node:test'
import assert from 'node:assert/strict'
import { createOAuthMount } from '../../src/oauth/server.mjs'

// RFC 6749 §3.3 — an authorize request WITHOUT a scope parameter must default
// to the full configured scope set, not bare mcp:read. Scope-less clients
// (ChatGPT omits the parameter entirely) would otherwise be pinned to
// read-only forever; the identity-grant ceiling and the consent checkboxes
// remain the actual gate.

const logger = { info() {}, warn() {} }
const REDIRECT_URI = 'https://client.example.test/callback'

function baseConfig() {
  return {
    publicUrl: 'https://contentkit-api.example.test',
    oauthSecret: 'scope-default-test-secret',
    oauthAllowedScopes: ['mcp:read', 'mcp:authoring', 'mcp:admin'],
    oauthDynamicRegistrationEnabled: true,
    oauthProviders: [{ protocol: 'api_key', id: 'api-key', label: 'ContentKit API key' }],
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

function authorizeUrl(config, params = {}) {
  const url = new URL(`${config.publicUrl}/v1/oauth/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', 'client-1')
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('code_challenge', 'C'.repeat(43))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('resource', `${config.publicUrl}/mcp`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

function mountWith(config, db) {
  return createOAuthMount(config, { db, auth: {}, audit: { async record() {} }, logger, oidc: {} })
}

const CLIENT_ROW = {
  client_id: 'client-1',
  client_name: 'Scope-less Client',
  redirect_uris: [REDIRECT_URI],
  revoked_at: null,
}

test('authorize without a scope param stores the full configured scope set as requested_scopes', async () => {
  const config = baseConfig()
  const db = fakeDb({ ck_oauth_clients: [CLIENT_ROW] })
  const mount = mountWith(config, db)
  const res = await mount.handler(new Request(authorizeUrl(config)))
  assert.notEqual(res.status, 500)
  const inserted = db.calls.insert.filter((call) => call.table === 'ck_oauth_login_states')
  assert.equal(inserted.length, 1, 'authorize must insert exactly one login state')
  assert.deepEqual(inserted[0].values.requested_scopes, ['mcp:read', 'mcp:authoring', 'mcp:admin'])
})

test('an explicit scope param still narrows requested_scopes exactly as sent', async () => {
  const config = baseConfig()
  const db = fakeDb({ ck_oauth_clients: [CLIENT_ROW] })
  const mount = mountWith(config, db)
  const res = await mount.handler(new Request(authorizeUrl(config, { scope: 'mcp:read' })))
  assert.notEqual(res.status, 500)
  const inserted = db.calls.insert.filter((call) => call.table === 'ck_oauth_login_states')
  assert.equal(inserted.length, 1)
  assert.deepEqual(inserted[0].values.requested_scopes, ['mcp:read'])
})

test('an unsupported scope still redirects with error=invalid_scope', async () => {
  const config = baseConfig()
  const db = fakeDb({ ck_oauth_clients: [CLIENT_ROW] })
  const mount = mountWith(config, db)
  const res = await mount.handler(new Request(authorizeUrl(config, { scope: 'mcp:read totally:bogus' })))
  assert.equal(res.status, 302)
  const location = new URL(res.headers.get('location'))
  assert.equal(location.searchParams.get('error'), 'invalid_scope')
})
