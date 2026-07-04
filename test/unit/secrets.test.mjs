import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertDeliverableUrl,
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  isBlockedAddress,
} from '../../src/secrets.mjs'

test('encrypt/decrypt round-trips a secret and is non-deterministic', () => {
  const secret = generateWebhookSecret()
  const a = encryptSecret(secret, 'pepper')
  const b = encryptSecret(secret, 'pepper')
  assert.notEqual(a, b, 'random IV makes ciphertext differ each time')
  assert.equal(decryptSecret(a, 'pepper'), secret)
  assert.equal(decryptSecret(b, 'pepper'), secret)
})

test('decrypt fails with the wrong pepper (GCM auth tag)', () => {
  const enc = encryptSecret('whsec_abc', 'right')
  assert.throws(() => decryptSecret(enc, 'wrong'))
})

test('generated webhook secrets are prefixed and unique', () => {
  const a = generateWebhookSecret()
  const b = generateWebhookSecret()
  assert.match(a, /^whsec_[A-Za-z0-9_-]+$/)
  assert.notEqual(a, b)
})

test('isBlockedAddress flags private/loopback/link-local, allows public', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.1',
    '172.16.5.5',
    '169.254.169.254',
    '::1',
    'fe80::1',
    'fd00::1',
    '100.64.0.1',
  ]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`)
  }
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`)
  }
})

test('assertDeliverableUrl rejects non-https and credentials, accepts https public host', async () => {
  await assert.rejects(() => assertDeliverableUrl('ftp://example.com'), /http/)
  await assert.rejects(() => assertDeliverableUrl('http://example.com'), /https/)
  await assert.rejects(() => assertDeliverableUrl('https://user:pass@example.com'), /credentials/)
  const ok = await assertDeliverableUrl('https://example.com/hooks')
  assert.equal(ok, 'https://example.com/hooks')
})

test('assertDeliverableUrl blocks SSRF to loopback/metadata but allows insecure local in dev mode', async () => {
  await assert.rejects(() => assertDeliverableUrl('https://127.0.0.1/x'), /private|loopback/)
  await assert.rejects(() => assertDeliverableUrl('https://169.254.169.254/latest/meta-data'), /private|loopback/)
  const local = await assertDeliverableUrl('http://127.0.0.1:9999/hook', { allowInsecure: true })
  assert.equal(local, 'http://127.0.0.1:9999/hook')
})
