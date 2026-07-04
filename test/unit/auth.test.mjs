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
