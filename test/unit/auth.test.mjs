import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuth, hashApiKey } from '../../src/auth.mjs'

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

test('an active OAuth token immediately respects a live identity role downgrade', async () => {
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
            role: 'reader',
            product_scopes: ['content:read', 'content:write', 'identity:admin', 'stats:read'],
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
