import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuth, credentialFromHeaders, hashApiKey, keyFingerprint } from '../../src/auth.mjs'

test('authenticates hashed keys and enforces scopes and sites', async () => {
  const raw = 'ck_test'
  const pepper = 'pepper'
  const row = {
    id: 'key',
    key_hash: hashApiKey(raw, pepper),
    scopes: ['content:read'],
    site_ids: ['site-a'],
  }
  const auth = createAuth(
    { bootstrapApiKey: '', keyPepper: pepper },
    {
      async select(_table, query) {
        return query.key_hash === `eq.${row.key_hash}` ? [row] : []
      },
      async update() {},
    },
  )
  const principal = await auth.authenticate({ authorization: `Bearer ${raw}` })
  assert.equal(principal.id, 'key')
  assert.equal(auth.authorize(principal, 'content:read', 'site-a'), true)
  assert.equal(auth.authorize(principal, 'content:read', 'site-b'), false)
  assert.equal(auth.authorize(principal, 'content:write', 'site-a'), false)
})

test('bootstrap key has global access', async () => {
  const auth = createAuth({ bootstrapApiKey: 'root', keyPepper: '' }, {})
  const principal = await auth.authenticate({ 'x-api-key': 'root' })
  assert.equal(auth.authorize(principal, 'site:admin', 'any-site'), true)
})

test('OAuth access tokens are resource-bound and intersect the live identity site ceiling', async () => {
  let values
  const auth = createAuth(
    {
      bootstrapApiKey: '',
      keyPepper: 'pepper',
      oauthSecret: 'oauth-secret',
      publicUrl: 'https://contentkit-api.example.com',
    },
    {
      async query(sql, input) {
        assert.match(sql, /t\.resource = \$2/)
        values = input
        return [
          {
            id: 'token-id',
            grant_id: 'grant-id',
            scopes: ['mcp:read', 'mcp:admin'],
            role: 'admin',
            product_scopes: ['content:read', 'identity:admin'],
            token_site_ids: ['site-a', 'site-b'],
            grant_site_ids: ['site-b', 'site-c'],
            display_name: 'Operator',
          },
        ]
      },
    },
  )
  const principal = await auth.authenticate(new Headers({ authorization: 'Bearer cko_example' }))
  assert.equal(values[1], 'https://contentkit-api.example.com/mcp')
  assert.deepEqual(principal.scopes, ['content:read', 'identity:admin'])
  assert.deepEqual(principal.site_ids, ['site-b'])
  assert.equal(auth.authorize(principal, 'identity:admin', 'site-b'), true)
  assert.equal(auth.authorize(principal, 'identity:admin', 'site-a'), false)
})

test('an active OAuth token immediately respects a live scope-ceiling downgrade and ignores the display role', async () => {
  const auth = createAuth(
    {
      bootstrapApiKey: '',
      keyPepper: 'pepper',
      oauthSecret: 'oauth-secret',
      publicUrl: 'https://contentkit-api.example.com',
    },
    {
      async query() {
        return [
          {
            id: 'token-id',
            grant_id: 'grant-id',
            scopes: ['mcp:read', 'mcp:authoring', 'mcp:admin'],
            // stale denormalized display role: never read for authorization
            role: 'admin',
            // the admin shrank the ceiling after the token was issued
            product_scopes: ['content:read', 'stats:read'],
            token_site_ids: [],
            grant_site_ids: [],
          },
        ]
      },
    },
  )
  const principal = await auth.authenticate({ authorization: 'Bearer cko_example' })
  assert.deepEqual(principal.scopes, ['content:read', 'stats:read'])
})

function operatorAuth(rows, options = {}) {
  const updates = []
  const auth = createAuth(
    {
      bootstrapApiKey: '',
      keyPepper: 'pepper',
      oauthSecret: 'oauth-secret',
      publicUrl: options.publicUrl || 'http://127.0.0.1:4050',
    },
    {
      async query() {
        return rows
      },
      async update(table, match, patch) {
        updates.push({ table, match, patch })
      },
      async select() {
        return []
      },
    },
  )
  return { auth, updates }
}

const OPERATOR_SESSION = {
  id: 'session-id',
  grant_id: 'grant-id',
  subject: 'operator@example.com',
  email: 'operator@example.com',
  display_name: 'Operator',
  product_scopes: ['content:read', 'content:write', 'release:write'],
  grant_site_ids: ['site-a'],
}

test('the operator-session cookie authenticates the dashboard with the live grant ceiling', async () => {
  const { auth, updates } = operatorAuth([OPERATOR_SESSION])
  const principal = await auth.authenticate({ cookie: 'contentkit_operator=ckos_example' })
  assert.equal(principal.id, 'operator:grant-id')
  assert.equal(principal.via, 'operator_session')
  assert.equal(principal.operator_session_id, 'session-id')
  assert.deepEqual(principal.scopes, ['content:read', 'content:write', 'release:write'])
  assert.deepEqual(principal.site_ids, ['site-a'])
  assert.equal(auth.authorize(principal, 'release:write', 'site-a'), true)
  assert.equal(auth.authorize(principal, 'release:write', 'site-b'), false)
  assert.equal(auth.authorize(principal, 'identity:admin', 'site-a'), false)
  // The idle window slides on use; the absolute expiry is never touched.
  assert.equal(updates[0].table, 'ck_operator_sessions')
  assert.ok(updates[0].patch.expires_at)
  assert.equal(updates[0].patch.absolute_expires_at, undefined)
})

test('an unknown, expired or revoked operator session authenticates nobody', async () => {
  const { auth } = operatorAuth([])
  assert.equal(await auth.authenticate({ cookie: 'contentkit_operator=ckos_example' }), null)
  assert.equal(await auth.authenticate({ cookie: 'unrelated=value' }), null)
  assert.equal(await auth.authenticate({}), null)
})

test('the operator cookie is only read on https under the __Host- prefix', async () => {
  const { auth } = operatorAuth([OPERATOR_SESSION], { publicUrl: 'https://contentkit-api.example.com' })
  // The unprefixed name is what an http deployment sets; on https it must not
  // be accepted, because only __Host- guarantees the origin could not set it.
  assert.equal(await auth.authenticate({ cookie: 'contentkit_operator=ckos_example' }), null)
  const principal = await auth.authenticate({ cookie: '__Host-contentkit_operator=ckos_example' })
  assert.equal(principal.id, 'operator:grant-id')
})

test('an explicit credential is never overridden by a session cookie', async () => {
  const { auth } = operatorAuth([OPERATOR_SESSION])
  // A stale or foreign cookie riding along on an API-key request must not
  // silently upgrade a rejected key into an authenticated operator.
  const principal = await auth.authenticate({
    authorization: 'Bearer ck_unknown',
    cookie: 'contentkit_operator=ckos_example',
  })
  assert.equal(principal, null)
})

test('credential extraction covers both transports and strips the Bearer prefix', () => {
  assert.equal(credentialFromHeaders({ authorization: 'Bearer ck_secret' }), 'ck_secret')
  assert.equal(credentialFromHeaders({ 'x-api-key': 'ck_secret' }), 'ck_secret')
  assert.equal(credentialFromHeaders({}), null)
  // An x-api-key caller used to log as `none`, hiding which key failed.
  assert.notEqual(keyFingerprint(credentialFromHeaders({ 'x-api-key': 'ck_secret' })), 'none')
  // One key must yield one fingerprint, whichever header carried it.
  assert.equal(
    keyFingerprint(credentialFromHeaders({ authorization: 'Bearer ck_secret' })),
    keyFingerprint(credentialFromHeaders({ 'x-api-key': 'ck_secret' })),
  )
})
