import test from 'node:test'
import assert from 'node:assert/strict'
import { buildToolManifest, findTool } from '../../src/mcp/tools.mjs'

const principal = (scopes) => ({ id: 'actor', name: 'Actor', scopes, site_ids: ['site-1'] })

test('MCP tool discovery is product-scope filtered', () => {
  const reader = buildToolManifest(principal(['content:read', 'stats:read'])).map((entry) => entry.name)
  assert.ok(reader.includes('contentkit_context'))
  assert.ok(reader.includes('contentkit_stats'))
  assert.equal(reader.includes('contentkit_ingest'), false)
  assert.equal(reader.includes('contentkit_publish'), false)

  const admin = buildToolManifest(principal(['identity:admin', 'audit:read'])).map((entry) => entry.name)
  assert.deepEqual(admin.sort(), ['contentkit_audit', 'contentkit_manage_identities'])
})

test('declining draft deletion performs no database mutation', async () => {
  let removed = false
  const tool = findTool(principal(['content:write']), 'contentkit_content')
  const deps = {
    repo: {
      async getSite() {
        return { id: 'site-1', name: 'Site' }
      },
    },
    auth: {
      authorize() {
        return true
      },
    },
    db: {
      async select(table) {
        return table === 'ck_content_items'
          ? [{ id: '11111111-1111-4111-8111-111111111111', site_id: 'site-1', published_revision_id: null }]
          : []
      },
      async remove() {
        removed = true
      },
    },
    audit: { async record() {} },
  }
  await assert.rejects(
    () =>
      tool.execute(
        deps,
        principal(['content:write']),
        { action: 'delete_draft', site: 'site-1', item_id: '11111111-1111-4111-8111-111111111111' },
        {
          async elicitForm() {
            return { action: 'decline' }
          },
        },
      ),
    /cancelled/,
  )
  assert.equal(removed, false)
})

test('MCP API-key creation returns only URL-handoff metadata and starts revoked', async () => {
  const tool = findTool(principal(['api-key:admin']), 'contentkit_manage_api_keys')
  const updates = []
  let handoffInput
  const deps = {
    auth: {
      authorize() {
        return true
      },
    },
    repo: {
      async createApiKey() {
        return { id: 'key-id', key_prefix: 'ck_example', key: 'ck_raw-secret' }
      },
    },
    db: {
      async update(...args) {
        updates.push(args)
        return []
      },
    },
    secretHandoffs: {
      create(input) {
        handoffInput = input
        return { id: 'handoff-id', url: 'https://contentkit.example/oauth/secret/x', expiresInSeconds: 600 }
      },
    },
    audit: { async record() {} },
  }
  const result = await tool.execute(
    deps,
    principal(['api-key:admin']),
    { action: 'create', name: 'agent', site_ids: ['site-1'] },
    {
      async elicitUrl() {
        return { action: 'accept' }
      },
    },
  )
  assert.match(updates[0][2].revoked_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(handoffInput.secret, 'ck_raw-secret')
  assert.equal(result.status, 'secret_handoff_pending')
  assert.doesNotMatch(JSON.stringify(result), /raw-secret|oauth\/secret/)
})

test('site-scoped MCP administrators cannot create sites outside their ceiling', async () => {
  const tool = findTool(principal(['site:admin']), 'contentkit_manage_sites')
  let confirmed = false
  let created = false
  await assert.rejects(
    () =>
      tool.execute(
        {
          auth: { authorize: () => true },
          repo: {
            async createSite() {
              created = true
            },
          },
        },
        principal(['site:admin']),
        { action: 'create', name: 'Escaped site' },
        {
          async elicitForm() {
            confirmed = true
            return { action: 'accept', content: { confirmed: true } }
          },
        },
      ),
    /unrestricted site administrator/,
  )
  assert.equal(confirmed, false)
  assert.equal(created, false)
})

test('MCP webhook retries verify the delivery belongs to the selected site before confirmation', async () => {
  const tool = findTool(principal(['webhook:admin']), 'contentkit_manage_webhooks')
  let confirmed = false
  let retried = false
  await assert.rejects(
    () =>
      tool.execute(
        {
          auth: { authorize: () => true },
          repo: {
            async getSite() {
              return { id: 'site-1', name: 'Site 1' }
            },
            async getDelivery() {
              return { id: '11111111-1111-4111-8111-111111111111', site_id: 'site-2' }
            },
            async retryDelivery() {
              retried = true
            },
          },
        },
        principal(['webhook:admin']),
        {
          action: 'retry',
          site: 'site-1',
          id: '11111111-1111-4111-8111-111111111111',
          input: {},
        },
        {
          async elicitForm() {
            confirmed = true
            return { action: 'accept', content: { confirmed: true } }
          },
        },
      ),
    /delivery not found/,
  )
  assert.equal(confirmed, false)
  assert.equal(retried, false)
})

test('MCP webhook secrets remain disabled until the one-time browser reveal', async () => {
  const tool = findTool(principal(['webhook:admin']), 'contentkit_manage_webhooks')
  const updates = []
  let handoffInput
  const result = await tool.execute(
    {
      auth: { authorize: () => true },
      repo: {
        async getSite() {
          return { id: 'site-1', name: 'Site 1' }
        },
        async createWebhookEndpoint(siteId, input) {
          assert.equal(siteId, 'site-1')
          assert.equal(input.enabled, false)
          return { id: '22222222-2222-4222-8222-222222222222', secret: 'whsec_raw', description: '' }
        },
      },
      db: {
        async update(...args) {
          updates.push(args)
          return []
        },
      },
      secretHandoffs: {
        create(input) {
          handoffInput = input
          return { id: 'handoff', url: 'https://contentkit.example/oauth/secret/x', expiresInSeconds: 600 }
        },
      },
      audit: { async record() {} },
    },
    principal(['webhook:admin']),
    { action: 'create', site: 'site-1', input: { url: 'https://webhook.example' } },
    {
      async elicitForm() {
        return { action: 'accept', content: { confirmed: true } }
      },
      async elicitUrl() {
        return { action: 'accept' }
      },
    },
  )
  assert.match(updates[0][2].disabled_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(result.status, 'secret_handoff_pending')
  assert.doesNotMatch(JSON.stringify(result), /whsec_raw/)
  await handoffInput.onReveal()
  assert.equal(updates.at(-1)[2].disabled_at, null)
})
