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

const draftItem = { id: '11111111-1111-4111-8111-111111111111', site_id: 'site-1', published_revision_id: null }

function confirmationDeps() {
  let removals = 0
  return {
    removals: () => removals,
    deps: {
      auth: {
        async authenticate(headers) {
          return headers.get('authorization') === 'Bearer key-a'
            ? { id: 'writer', name: 'writer', scopes: ['content:write'], site_ids: ['site-1'] }
            : null
        },
        authorize: () => true,
      },
      logger: { info() {}, warn() {}, debug() {} },
      usage: { async recordMcp() {}, quality: () => ({}) },
      repo: {
        async getSite() {
          return { id: 'site-1', slug: 'site-1', name: 'Site' }
        },
      },
      db: {
        async select(table) {
          return table === 'ck_content_items' ? [draftItem] : []
        },
        async remove() {
          removals += 1
        },
      },
      audit: { async record() {} },
      secretHandoffs: { setNotifier() {} },
    },
  }
}

async function initialize(mount, capabilities) {
  const response = await mount.handler(
    rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities, clientInfo: { name: 'test', version: '1' } },
    }),
  )
  assert.equal(response.status, 200)
  const session = response.headers.get('mcp-session-id')
  assert.ok(session)
  await response.text()
  return session
}

function deleteDraftCall(session) {
  return rpc(
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'contentkit_content',
        arguments: { action: 'delete_draft', site: 'site-1', item_id: draftItem.id },
      },
    },
    { session },
  )
}

// Reads the POST SSE stream message by message so a server->client elicitation
// request can be observed and answered while the tool call is still running.
function sseEvents(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const pending = []
  return {
    async next(predicate) {
      while (true) {
        while (pending.length) {
          const message = pending.shift()
          if (!predicate || predicate(message)) return message
        }
        const { done, value } = await reader.read()
        assert.equal(done, false, 'SSE stream ended before the expected message')
        buffer += decoder.decode(value, { stream: true })
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          for (const line of event.split('\n'))
            if (line.startsWith('data:')) pending.push(JSON.parse(line.slice(5).trim()))
        }
      }
    },
  }
}

function toolPayload(message) {
  return JSON.parse(message.result.content[0].text)
}

test('elicitation capability matrix: {} and {form:{}} elicit, {url:{}} and absent fail closed', async () => {
  for (const capabilities of [{ elicitation: {} }, { elicitation: { form: {} } }]) {
    const { deps: confirmDeps, removals } = confirmationDeps()
    const mount = createMcpMount(config, confirmDeps)
    try {
      const session = await initialize(mount, capabilities)
      const events = sseEvents(await mount.handler(deleteDraftCall(session)))
      const elicitation = await events.next((message) => message.method === 'elicitation/create')
      assert.equal(elicitation.params.mode, 'form')
      assert.match(elicitation.params.message, /Delete draft content item/)
      await mount.handler(rpc({ jsonrpc: '2.0', id: elicitation.id, result: { action: 'decline' } }, { session }))
      const final = await events.next((message) => message.id === 7)
      assert.equal(final.result.isError, true)
      assert.equal(toolPayload(final).error, 'Operation cancelled; no change was made.')
      assert.equal(removals(), 0)
    } finally {
      mount.stop()
    }
  }

  for (const capabilities of [{ elicitation: { url: {} } }, {}]) {
    const { deps: confirmDeps, removals } = confirmationDeps()
    const mount = createMcpMount(config, confirmDeps)
    try {
      const session = await initialize(mount, capabilities)
      const response = await mount.handler(deleteDraftCall(session))
      const final = sseJson(await response.text())
      assert.equal(final.result.isError, true)
      const payload = toolPayload(final)
      assert.equal(payload.reason, 'elicitation_unsupported')
      assert.ok(payload.next_best_actions.some((action) => /Codex.*config\.toml/.test(action)))
      assert.equal(removals(), 0)
    } finally {
      mount.stop()
    }
  }
})

test('a fast client auto-cancel is retried once end-to-end then reported as elicitation_auto_cancelled', async () => {
  const { deps: confirmDeps, removals } = confirmationDeps()
  const mount = createMcpMount(config, confirmDeps)
  try {
    const session = await initialize(mount, { elicitation: { form: {} } })
    const events = sseEvents(await mount.handler(deleteDraftCall(session)))
    const first = await events.next((message) => message.method === 'elicitation/create')
    await mount.handler(rpc({ jsonrpc: '2.0', id: first.id, result: { action: 'cancel' } }, { session }))
    const second = await events.next((message) => message.method === 'elicitation/create')
    assert.notEqual(second.id, first.id)
    await mount.handler(rpc({ jsonrpc: '2.0', id: second.id, result: { action: 'cancel' } }, { session }))
    const final = await events.next((message) => message.id === 7)
    assert.equal(final.result.isError, true)
    const payload = toolPayload(final)
    assert.equal(payload.reason, 'elicitation_auto_cancelled')
    assert.notEqual(payload.error, 'Operation cancelled; no change was made.')
    assert.equal(removals(), 0)
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
