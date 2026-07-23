import test from 'node:test'
import assert from 'node:assert/strict'
import { oidcIdentityFromClaims } from '../../src/oauth/oidc.mjs'

test('OIDC identity requires only the immutable subject', () => {
  assert.deepEqual(oidcIdentityFromClaims({ sub: 'operator-subject' }), {
    subject: 'operator-subject',
    email: null,
  })
})

test('OIDC identity keeps only an explicitly verified email', () => {
  assert.deepEqual(
    oidcIdentityFromClaims({
      sub: 'operator-subject',
      email: ' Operator@Example.Test ',
      email_verified: true,
    }),
    { subject: 'operator-subject', email: 'operator@example.test' },
  )
  assert.deepEqual(
    oidcIdentityFromClaims({
      sub: 'operator-subject',
      email: 'operator@example.test',
      email_verified: false,
    }),
    { subject: 'operator-subject', email: null },
  )
})

test('OIDC identity rejects a token without subject', () => {
  assert.throws(() => oidcIdentityFromClaims({ email: 'operator@example.test', email_verified: true }), /contain sub/)
})
