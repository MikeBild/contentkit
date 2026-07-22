import test from 'node:test'
import assert from 'node:assert/strict'
import { createOAuthMount } from '../../src/oauth/server.mjs'

const config = {
  publicUrl: 'https://contentkit-api.example.com',
  oauthAllowedScopes: ['mcp:read', 'mcp:authoring', 'mcp:admin'],
  oauthDynamicRegistrationEnabled: true,
  oauthSecret: 'secret',
  oauthProviders: [{ protocol: 'api_key', id: 'api-key', label: 'ContentKit API key' }],
}
const mount = createOAuthMount(config, {
  db: {},
  auth: {},
  audit: { async record() {} },
  logger: { warn() {} },
})

test('OAuth protected-resource metadata is MCP endpoint-specific', async () => {
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const response = await mount.handler(new Request(`${config.publicUrl}${path}`))
    assert.equal(response.status, 200)
    const metadata = await response.json()
    assert.equal(metadata.resource, `${config.publicUrl}/mcp`)
    assert.deepEqual(metadata.authorization_servers, [config.publicUrl])
    assert.ok(metadata.scopes_supported.includes('mcp:read'))
  }
})

test('OAuth authorization-server metadata advertises PKCE and public clients', async () => {
  const response = await mount.handler(new Request(`${config.publicUrl}/.well-known/oauth-authorization-server`))
  const metadata = await response.json()
  assert.equal(metadata.issuer, config.publicUrl)
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256'])
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none'])
  assert.match(metadata.authorization_endpoint, /\/v1\/oauth\/authorize$/)
  assert.match(metadata.registration_endpoint, /\/v1\/oauth\/register$/)
})

test('API-key login never accepts an OAuth bearer token as its operator credential', async () => {
  const state = `ckls_${'a'.repeat(43)}`
  const guarded = createOAuthMount(config, {
    db: {
      async select(table) {
        assert.equal(table, 'ck_oauth_login_states')
        return [{ id: 'state-id', expires_at: new Date(Date.now() + 60_000).toISOString() }]
      },
    },
    auth: {
      async authenticate() {
        return { id: 'oauth:token', oauth: true, scopes: ['content:read'], site_ids: [] }
      },
    },
    audit: { async record() {} },
    logger: { warn() {} },
  })
  const response = await guarded.handler(
    new Request(`${config.publicUrl}/v1/identity/login/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ provider: 'api-key', login_state: state, api_key: 'cko_not-an-operator-key' }),
    }),
  )
  assert.equal(response.status, 401)
  assert.match(await response.text(), /invalid or expired/)
})
