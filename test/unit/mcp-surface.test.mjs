import test from 'node:test'
import assert from 'node:assert/strict'
import { createMcpMount } from '../../src/mcp/server.mjs'

const config = {
  root: new URL('../..', import.meta.url).pathname,
  publicUrl: 'https://contentkit-api.example.com',
  version: '1.23.0',
  mcpSessionTtlMs: 60_000,
  mcpMaxSessions: 10,
  mcpElicitationTimeoutMs: 30_000,
  oauthAllowedScopes: ['mcp:read', 'mcp:authoring', 'mcp:admin'],
}

const principal = (id) => ({ id, name: id, scopes: ['content:read'], site_ids: [] })
const deps = {
  auth: {
    async authenticate(headers) {
      const value = headers.get('authorization')
      return value === 'Bearer key-a' ? principal('a') : value === 'Bearer key-b' ? principal('b') : null
    },
    authorize(value, scope) {
      return value.scopes.includes(scope)
    },
  },
  logger: { info() {}, warn() {}, debug() {} },
  usage: { async recordMcp() {}, quality: () => ({}) },
  repo: { async getSite() {} },
  secretHandoffs: { setNotifier() {} },
}

function rpc(body, { key = 'key-a', session } = {}) {
  return new Request(`${config.publicUrl}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(body),
  })
}

function sseJson(text) {
  const line = text.split('\n').find((entry) => entry.startsWith('data:'))
  assert.ok(line, `missing SSE data in ${text}`)
  return JSON.parse(line.slice(5).trim())
}

test('MCP initializes, lists only scoped tools and hides a session from another credential', async () => {
  const mount = createMcpMount(config, deps)
  try {
    const initialized = await mount.handler(
      rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: { elicitation: { form: {}, url: {} } },
          clientInfo: { name: 'test', version: '1' },
        },
      }),
    )
    assert.equal(initialized.status, 200)
    const session = initialized.headers.get('mcp-session-id')
    assert.ok(session)
    assert.equal(sseJson(await initialized.text()).result.serverInfo.name, 'contentkit')

    const listed = await mount.handler(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { session }))
    const names = sseJson(await listed.text()).result.tools.map((entry) => entry.name)
    assert.ok(names.includes('contentkit_context'))
    assert.ok(names.includes('contentkit_read'))
    assert.equal(names.includes('contentkit_publish'), false)
    assert.equal(names.includes('contentkit_manage_identities'), false)

    const foreign = await mount.handler(
      rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, { session, key: 'key-b' }),
    )
    assert.equal(foreign.status, 404)
    assert.equal((await foreign.json()).error.code, -32001)
  } finally {
    mount.stop()
  }
})

test('MCP rejects invalid browser origins and advertises OAuth discovery on 401', async () => {
  const mount = createMcpMount(config, deps)
  try {
    const badOrigin = rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    badOrigin.headers.set('origin', 'https://attacker.example')
    assert.equal((await mount.handler(badOrigin)).status, 403)

    const productionLoopbackOrigin = rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    productionLoopbackOrigin.headers.set('origin', 'http://localhost:4050')
    assert.equal((await mount.handler(productionLoopbackOrigin)).status, 403)

    const missing = rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { key: 'missing' })
    const response = await mount.handler(missing)
    assert.equal(response.status, 401)
    assert.match(response.headers.get('www-authenticate'), /oauth-protected-resource\/mcp/)
    assert.match(response.headers.get('www-authenticate'), /scope="mcp:read mcp:authoring mcp:admin"/)
  } finally {
    mount.stop()
  }
})
