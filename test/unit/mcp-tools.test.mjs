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

// MCP identity administration follows the same scope-ceiling contract v1 as
// the REST admin surface: role XOR product_scopes, the stored role is always
// derived from the ceiling, manual writes stamp grant_source=admin and a
// duplicate identity is a 409 conflict, never a server error.
test('MCP identity create enforces role XOR product_scopes and stores the derived role and grant_source', async () => {
  const tool = findTool(principal(['identity:admin']), 'contentkit_manage_identities')
  const admin = { ...principal(['identity:admin']), site_ids: [] }
  const inserted = []
  const deps = {
    auth: { authorize: () => true },
    config: {
      oauthProviders: [{ protocol: 'oidc', id: 'corp', issuer: 'https://login.example', clientId: 'ck' }],
    },
    db: {
      async insert(table, values) {
        inserted.push(values)
        return [{ id: 'grant-1', revoked_at: null, ...values }]
      },
      async select() {
        return []
      },
    },
    audit: { async record() {} },
  }
  const context = {
    async elicitForm() {
      return { action: 'accept', content: { confirmed: true } }
    },
  }
  const create = (input) => tool.execute(deps, admin, { action: 'create', input }, context)
  const base = { provider_id: 'corp', issuer: 'https://login.example', subject: 'operator-1' }

  await assert.rejects(
    () => create({ ...base, role: 'reader', product_scopes: ['content:read'] }),
    /mutually exclusive/,
  )
  await assert.rejects(() => create(base), /either role or product_scopes is required/)
  assert.equal(inserted.length, 0)

  // scopes-only create: the denormalized role is derived, never stored verbatim
  const scoped = await create({ ...base, product_scopes: ['content:read', 'identity:admin'] })
  assert.equal(scoped.role, 'admin')
  assert.equal(inserted[0].role, 'admin')
  assert.equal(inserted[0].grant_source, 'admin')

  // a role body is a shorthand: expanded once, role derived from the ceiling
  const legacy = await create({ ...base, subject: 'operator-2', role: 'author' })
  assert.equal(legacy.role, 'author')
  assert.ok(inserted[1].product_scopes.includes('content:write'))
  assert.equal(inserted[1].grant_source, 'admin')
})

test('MCP identity create maps the unique-identity violation to a 409 with the existing grant', async () => {
  const tool = findTool(principal(['identity:admin']), 'contentkit_manage_identities')
  const admin = { ...principal(['identity:admin']), site_ids: [] }
  const existing = { id: 'grant-live', revoked_at: null, provider_id: 'corp', subject: 'operator-1' }
  const deps = {
    auth: { authorize: () => true },
    config: {
      oauthProviders: [{ protocol: 'oidc', id: 'corp', issuer: 'https://login.example', clientId: 'ck' }],
    },
    db: {
      async insert() {
        throw Object.assign(
          new Error(
            'duplicate key value violates unique constraint "ck_oauth_identity_grants_provider_id_issuer_subject_key"',
          ),
          { code: '23505' },
        )
      },
      async select(table, query) {
        assert.equal(table, 'ck_oauth_identity_grants')
        assert.equal(query.provider_id, 'eq.corp')
        assert.equal(query.subject, 'eq.operator-1')
        return [existing]
      },
    },
    audit: { async record() {} },
  }
  const context = {
    async elicitForm() {
      return { action: 'accept', content: { confirmed: true } }
    },
  }
  const create = () =>
    tool.execute(
      deps,
      admin,
      {
        action: 'create',
        input: { provider_id: 'corp', issuer: 'https://login.example', subject: 'operator-1', role: 'reader' },
      },
      context,
    )
  await assert.rejects(create, (error) => {
    assert.equal(error.statusCode, 409)
    assert.match(error.message, /already exists \(id grant-live\)/)
    assert.match(error.message, /PATCH \/v1\/identity-grants\/grant-live/)
    return true
  })
  existing.revoked_at = new Date().toISOString()
  await assert.rejects(create, (error) => {
    assert.equal(error.statusCode, 409)
    assert.match(error.message, /restore:true/)
    return true
  })
})

test('MCP identity list forwards provider_id and subject filters like the REST list', async () => {
  const tool = findTool(principal(['identity:admin']), 'contentkit_manage_identities')
  const queries = []
  const deps = {
    auth: { authorize: () => true },
    db: {
      async select(table, query) {
        queries.push(query)
        return [{ id: 'grant-1', site_ids: [], source_credential_hash: 'hidden' }]
      },
    },
  }
  const admin = { ...principal(['identity:admin']), site_ids: [] }
  const unfiltered = await tool.execute(deps, admin, { action: 'list', input: {} }, {})
  assert.equal('provider_id' in queries[0], false)
  assert.equal('source_credential_hash' in unfiltered.identities[0], false)
  await tool.execute(deps, admin, { action: 'list', input: { provider_id: 'corp', subject: 'operator-1' } }, {})
  assert.equal(queries[1].provider_id, 'eq.corp')
  assert.equal(queries[1].subject, 'eq.operator-1')
})

test('MCP identity update keeps role XOR product_scopes and re-derives the display role', async () => {
  const tool = findTool(principal(['identity:admin']), 'contentkit_manage_identities')
  const admin = { ...principal(['identity:admin']), site_ids: [] }
  const updates = []
  const deps = {
    auth: { authorize: () => true },
    config: { oauthProviders: [] },
    db: {
      async select() {
        return [{ id: '33333333-3333-4333-8333-333333333333', revoked_at: null, site_ids: [] }]
      },
      async update(table, filter, values) {
        updates.push([table, filter, values])
        return [{ id: '33333333-3333-4333-8333-333333333333', ...values }]
      },
    },
    audit: { async record() {} },
  }
  const context = {
    async elicitForm() {
      return { action: 'accept', content: { confirmed: true } }
    },
  }
  const update = (body) =>
    tool.execute(deps, admin, { action: 'update', id: '33333333-3333-4333-8333-333333333333', input: body }, context)

  await assert.rejects(() => update({ role: 'reader', product_scopes: ['content:read'] }), /mutually exclusive/)
  assert.equal(updates.length, 0)

  const scoped = await update({ product_scopes: ['content:read', 'identity:admin'] })
  assert.equal(scoped.role, 'admin')
  assert.equal(updates[0][2].grant_source, 'admin')

  const shorthand = await update({ role: 'author' })
  assert.ok(updates[1][2].product_scopes.includes('release:preview'))
  assert.equal(shorthand.role, 'author')
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
