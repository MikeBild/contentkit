import test from 'node:test'
import assert from 'node:assert/strict'
import { oidcIdentityFromClaims } from '../../src/oauth/oidc.mjs'

test('OIDC identity requires only the immutable subject', () => {
  assert.deepEqual(oidcIdentityFromClaims({ sub: 'operator-subject' }), {
    subject: 'operator-subject',
    email: null,
    name: null,
  })
})

test('OIDC identity keeps only an explicitly verified email', () => {
  assert.deepEqual(
    oidcIdentityFromClaims({
      sub: 'operator-subject',
      email: ' Operator@Example.Test ',
      email_verified: true,
    }),
    { subject: 'operator-subject', email: 'operator@example.test', name: null },
  )
  assert.deepEqual(
    oidcIdentityFromClaims({
      sub: 'operator-subject',
      email: 'operator@example.test',
      email_verified: false,
    }),
    { subject: 'operator-subject', email: null, name: null },
  )
})

test('OIDC identity keeps a trimmed, bounded name claim for display purposes', () => {
  assert.deepEqual(oidcIdentityFromClaims({ sub: 'operator-subject', name: '  Op Erator  ' }), {
    subject: 'operator-subject',
    email: null,
    name: 'Op Erator',
  })
  assert.equal(oidcIdentityFromClaims({ sub: 'operator-subject', name: 'x'.repeat(400) }).name, 'x'.repeat(255))
  assert.equal(oidcIdentityFromClaims({ sub: 'operator-subject', name: '   ' }).name, null)
  assert.equal(oidcIdentityFromClaims({ sub: 'operator-subject', name: 42 }).name, null)
})

test('OIDC identity rejects a token without subject', () => {
  assert.throws(() => oidcIdentityFromClaims({ email: 'operator@example.test', email_verified: true }), /contain sub/)
})
