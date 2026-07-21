import test from 'node:test'
import assert from 'node:assert/strict'
import { createSecretHandoffs } from '../../src/secret-handoffs.mjs'

test('secret handoff reveals once with no-store and completes URL elicitation', async () => {
  const handoffs = createSecretHandoffs(
    { publicUrl: 'https://contentkit-api.example.com', oauthSecret: 'oauth-secret' },
    { warn() {} },
  )
  try {
    let activated = 0
    const entry = handoffs.create({
      secret: 'ck_super-secret',
      label: 'API key',
      async onReveal() {
        activated++
      },
    })
    let completed = 0
    handoffs.setNotifier(entry.id, async () => completed++)
    const preview = await handoffs.handler(new Request(entry.url))
    assert.equal(preview.status, 200)
    assert.equal(preview.headers.get('cache-control'), 'no-store, max-age=0')
    assert.doesNotMatch(await preview.text(), /ck_super-secret/)
    assert.equal(completed, 0)
    assert.equal(activated, 0)

    const first = await handoffs.handler(
      new Request(entry.url, {
        method: 'POST',
        headers: { origin: 'https://contentkit-api.example.com' },
      }),
    )
    assert.equal(first.status, 200)
    assert.match(await first.text(), /ck_super-secret/)
    assert.equal(completed, 1)
    assert.equal(activated, 1)
    const second = await handoffs.handler(new Request(entry.url))
    assert.equal(second.status, 410)
    assert.doesNotMatch(await second.text(), /ck_super-secret/)
  } finally {
    await handoffs.stop()
  }
})
