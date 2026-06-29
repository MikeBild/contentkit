import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createOutboxWorker } from '../../src/webhooks.mjs'

test('delivers a Subkit Standard Webhook envelope', async () => {
  const updates = []
  const db = {
    async select(table) {
      if (table === 'ck_outbox_events') return [{
        id: 'evt-1', site_id: 'site-1', type: 'contentkit.comment.submitted',
        resource_kind: 'comment', resource_id: 'comment-1', payload: { summary: 'Pending' },
        attempts: 0, created_at: '2026-06-29T10:00:00Z', status: 'pending',
      }]
      return [{ id: 'site-1', name: 'Example' }]
    },
    async update(...args) { updates.push(args) },
  }
  let request
  const worker = createOutboxWorker({
    subkitWebhookUrl: 'https://subkit.example/v1/hooks/contentkit-notifications',
    subkitWebhookSecret: 'secret',
    webhookPollMs: 1000,
  }, db, { warn() {}, error() {} }, async (url, options) => {
    request = { url, options }
    return new Response('{}', { status: 200 })
  })
  await worker.tick()
  assert.equal(request.url, 'https://subkit.example/v1/hooks/contentkit-notifications')
  assert.equal(request.options.headers['webhook-id'], 'evt-1')
  assert.equal(request.options.headers['webhook-type'], 'contentkit.comment.submitted')
  const ts = request.options.headers['webhook-timestamp']
  const expected = createHmac('sha256', 'secret')
    .update(`evt-1.${ts}.${request.options.body}`).digest('base64')
  assert.equal(request.options.headers['webhook-signature'], `v1,${expected}`)
  assert.equal(updates[0][2].status, 'delivered')
})
