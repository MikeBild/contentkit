import test from 'node:test'
import assert from 'node:assert/strict'
import { FORM_FAST_CANCEL_MS, buildToolManifest, findTool } from '../../src/mcp/tools.mjs'

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

test('every tool inputSchema root is a flat object so strict clients accept the listing', () => {
  const manifest = buildToolManifest(principal(['*']))
  assert.ok(manifest.length > 0)
  for (const entry of manifest) {
    assert.equal(entry.inputSchema.type, 'object', `${entry.name} root must be type object`)
    assert.equal('oneOf' in entry.inputSchema, false, `${entry.name} root must not use oneOf`)
    assert.equal('anyOf' in entry.inputSchema, false, `${entry.name} root must not use anyOf`)
  }
  const content = manifest.find((entry) => entry.name === 'contentkit_content')
  assert.deepEqual(content.inputSchema.properties.action.enum, ['list', 'revisions', 'delete_draft'])
  const publish = manifest.find((entry) => entry.name === 'contentkit_publish')
  assert.deepEqual(publish.inputSchema.properties.action.enum, [
    'preview',
    'promote',
    'publish',
    'activate',
    'unpublish',
  ])
  assert.equal(publish.inputSchema.properties.manifest_sha256.pattern, '^[0-9a-f]{64}$')
})

test('MCP preview promotion confirms and forwards the exact immutable binding', async () => {
  const tool = findTool(principal(['release:write']), 'contentkit_publish')
  let promoted
  let confirmation
  const deps = {
    repo: {
      async getSite() {
        return { id: 'site-1', name: 'Site' }
      },
    },
    auth: { authorize: () => true },
    releases: {
      async promote(input) {
        promoted = input
        return { release_id: input.releaseId, manifest_sha256: input.manifestSha256, active: true }
      },
    },
    audit: {
      async record() {
        return { id: 1 }
      },
    },
  }
  const releaseId = '11111111-1111-4111-8111-111111111111'
  const digest = 'a'.repeat(64)
  const result = await tool.execute(
    deps,
    principal(['release:write']),
    {
      action: 'promote',
      site: 'site-1',
      revision_ids: [],
      item_ids: [],
      release_id: releaseId,
      manifest_sha256: digest,
      reason: 'approved preview',
      expires_in: 3600,
    },
    {
      async elicitForm(input) {
        confirmation = input
        return { action: 'accept', content: { confirmed: true } }
      },
    },
  )
  assert.match(confirmation.message, new RegExp(releaseId))
  assert.deepEqual(promoted, { siteId: 'site-1', releaseId, manifestSha256: digest })
  assert.equal(result.release_id, releaseId)
  assert.equal(result.active, true)
})

test('MCP preview promotion without a live form returns a durable exact browser review and performs no mutation', async () => {
  const tool = findTool(principal(['release:write']), 'contentkit_publish')
  let promoted = false
  const auditRows = []
  let reviewRow = null
  const fakeDb = {
    async tx(fn) {
      return fn(fakeDb)
    },
    async select(table) {
      return table === 'ck_promotion_reviews' && reviewRow ? [reviewRow] : []
    },
    async insert(table, row) {
      if (table !== 'ck_promotion_reviews') throw new Error(`unexpected insert ${table}`)
      reviewRow = { ...row, requested_at: '2026-08-17T10:00:00.000Z' }
      return [reviewRow]
    },
    async query(sql, values) {
      if (!sql.includes('INSERT INTO ck_decisions')) throw new Error('unexpected query')
      return [{ id: 'decision-1', source_id: values[3] }]
    },
  }
  const deps = {
    repo: {
      async getSite() {
        return { id: 'site-1', slug: 'mikebild', name: 'Site' }
      },
      async getRelease() {
        return { id: releaseId, site_id: 'site-1', kind: 'preview', status: 'preview', manifest_sha256: digest }
      },
    },
    db: fakeDb,
    auth: { authorize: () => true },
    releases: {
      async promote() {
        promoted = true
      },
    },
    audit: {
      async record(row) {
        auditRows.push(row)
      },
    },
  }
  const releaseId = '11111111-1111-4111-8111-111111111111'
  const digest = 'b'.repeat(64)
  const result = await tool.execute(
    deps,
    principal(['release:write']),
    {
      action: 'promote',
      site: 'site-1',
      revision_ids: [],
      item_ids: [],
      release_id: releaseId,
      manifest_sha256: digest,
      reason: 'reviewed preview',
      expires_in: 3600,
    },
    {
      formElicitationSupported: false,
      publicUrl: 'https://contentkit.example',
      async elicitForm() {
        throw new Error('must not elicit')
      },
    },
  )
  assert.equal(promoted, false)
  assert.equal(result.status, 'human_review_required')
  assert.equal(result.mutation_applied, false)
  assert.equal(result.release_id, releaseId)
  assert.equal(result.manifest_sha256, digest)
  const review = new URL(result.review_url)
  assert.equal(review.origin, 'https://contentkit.example')
  assert.equal(review.pathname, '/cockpit/releases')
  assert.equal(review.searchParams.get('site'), 'mikebild')
  assert.equal(review.searchParams.get('promotion_review'), result.promotion_review_id)
  assert.equal(review.searchParams.size, 2)
  assert.equal(auditRows.length, 1)
  assert.equal(auditRows[0].action, 'promotion_review.request')
  assert.equal(auditRows[0].resourceId, result.promotion_review_id)
  assert.equal(auditRows[0].metadata.manifest_sha256, digest)
})

test('MCP preview promotion refuses the mutation when the human-decision audit cannot be persisted', async () => {
  const tool = findTool(principal(['release:write']), 'contentkit_publish')
  let promoted = false
  const releaseId = '11111111-1111-4111-8111-111111111111'
  const digest = 'e'.repeat(64)
  await assert.rejects(
    () =>
      tool.execute(
        {
          repo: {
            async getSite() {
              return { id: 'site-1', name: 'Site' }
            },
          },
          auth: { authorize: () => true },
          releases: {
            async promote() {
              promoted = true
            },
          },
          audit: {
            async record() {
              return null
            },
          },
        },
        principal(['release:write']),
        {
          action: 'promote',
          site: 'site-1',
          release_id: releaseId,
          manifest_sha256: digest,
        },
        {
          async elicitForm() {
            return { action: 'accept', content: { confirmed: true } }
          },
        },
      ),
    (error) => {
      assert.equal(error.statusCode, 503)
      assert.equal(error.reason, 'approval_audit_unavailable')
      return true
    },
  )
  assert.equal(promoted, false)
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

function draftDeletionHarness() {
  let removals = 0
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
        removals += 1
      },
    },
    audit: { async record() {} },
  }
  const run = (elicitForm) =>
    tool.execute(
      deps,
      principal(['content:write']),
      { action: 'delete_draft', site: 'site-1', item_id: '11111111-1111-4111-8111-111111111111' },
      { elicitForm },
    )
  return { run, removals: () => removals }
}

test('a fast client cancel is retried once then surfaces elicitation_auto_cancelled without mutating', async () => {
  const harness = draftDeletionHarness()
  let calls = 0
  await assert.rejects(
    () =>
      harness.run(async () => {
        calls += 1
        return { action: 'cancel' }
      }),
    (error) => {
      assert.equal(error.statusCode, 409)
      assert.equal(error.reason, 'elicitation_auto_cancelled')
      assert.notEqual(error.cancelled, true)
      return true
    },
  )
  assert.equal(calls, 2)
  assert.equal(harness.removals(), 0)
})

test('a fast cancel followed by a rendered accept performs the mutation exactly once', async () => {
  const harness = draftDeletionHarness()
  let calls = 0
  const result = await harness.run(async () => {
    calls += 1
    return calls === 1 ? { action: 'cancel' } : { action: 'accept', content: { confirmed: true } }
  })
  assert.equal(calls, 2)
  assert.equal(result.deleted, true)
  assert.equal(harness.removals(), 1)
})

test('a cancel after the fast-cancel window is a human decision: no retry, byte-stable error', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  const harness = draftDeletionHarness()
  let calls = 0
  await assert.rejects(
    () =>
      harness.run(async () => {
        calls += 1
        t.mock.timers.tick(FORM_FAST_CANCEL_MS + 100)
        return { action: 'cancel' }
      }),
    (error) => {
      assert.equal(error.message, 'Operation cancelled; no change was made.')
      assert.equal(error.statusCode, 409)
      assert.equal(error.cancelled, true)
      return true
    },
  )
  assert.equal(calls, 1)
  assert.equal(harness.removals(), 0)
})

test('an immediate decline is never retried and keeps the byte-stable human-decline error', async () => {
  const harness = draftDeletionHarness()
  let calls = 0
  await assert.rejects(
    () =>
      harness.run(async () => {
        calls += 1
        return { action: 'decline' }
      }),
    (error) => {
      assert.equal(error.message, 'Operation cancelled; no change was made.')
      assert.equal(error.statusCode, 409)
      assert.equal(error.cancelled, true)
      return true
    },
  )
  assert.equal(calls, 1)
  assert.equal(harness.removals(), 0)
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
