import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createOutboxWorker } from '../../src/webhooks.mjs'
import { encryptSecret } from '../../src/secrets.mjs'

const baseConfig = {
  webhookUrl: 'https://hooks.example/hooks',
  webhookSecret: 'env-secret',
  webhookPollMs: 1000,
  webhookTimeoutMs: 5000,
  webhookMaxAttempts: 10,
  webhookCircuitThreshold: 5,
  keyPepper: 'pepper',
}

function makeDb({ deliveries = [], endpoints = {} }) {
  const updates = []
  return {
    updates,
    async select(table, query = {}) {
      if (table === 'ck_webhook_deliveries') return deliveries
      if (table === 'ck_webhook_endpoints') {
        const id = String(query.id || '').slice(3)
        return endpoints[id] ? [endpoints[id]] : []
      }
      return []
    },
    async update(table, filters, body) {
      updates.push({ table, filters, body })
      return [body]
    },
  }
}

const logger = { warn() {}, error() {} }

test('delivers the legacy env endpoint (endpoint_id null), signed with the env secret', async () => {
  const db = makeDb({
    deliveries: [
      {
        id: 'del-1',
        endpoint_id: null,
        site_id: 'site-1',
        type: 'contentkit.comment.submitted',
        payload: { event_id: 'evt-1', data: { body: 'hi' } },
        attempts: 0,
        status: 'pending',
      },
    ],
  })
  let request
  const worker = createOutboxWorker(baseConfig, db, logger, async (url, options) => {
    request = { url, options }
    return new Response('{}', { status: 200 })
  })
  await worker.tick()
  assert.equal(request.url, 'https://hooks.example/hooks')
  assert.equal(request.options.headers['webhook-id'], 'del-1')
  assert.equal(request.options.headers['webhook-type'], 'contentkit.comment.submitted')
  const ts = request.options.headers['webhook-timestamp']
  const expected = createHmac('sha256', 'env-secret').update(`del-1.${ts}.${request.options.body}`).digest('base64')
  assert.equal(request.options.headers['webhook-signature'], `v1,${expected}`)
  const delivered = db.updates.find((u) => u.table === 'ck_webhook_deliveries')
  assert.equal(delivered.body.status, 'delivered')
})

test('delivers a managed endpoint, signed with its own decrypted secret, and carries the form content', async () => {
  const db = makeDb({
    deliveries: [
      {
        id: 'del-2',
        endpoint_id: 'ep-1',
        site_id: 'site-1',
        type: 'contentkit.contact.submitted',
        payload: { data: { name: 'Ada', email: 'ada@example.com', message: 'Hi' } },
        attempts: 0,
        status: 'pending',
      },
    ],
    endpoints: {
      'ep-1': {
        id: 'ep-1',
        url: 'https://hooks.example/x',
        secret_encrypted: encryptSecret('whsec_managed', 'pepper'),
        disabled_at: null,
        consecutive_failures: 0,
      },
    },
  })
  let request
  const worker = createOutboxWorker(baseConfig, db, logger, async (url, options) => {
    request = { url, options }
    return new Response('{}', { status: 200 })
  })
  await worker.tick()
  assert.equal(request.url, 'https://hooks.example/x')
  const ts = request.options.headers['webhook-timestamp']
  const expected = createHmac('sha256', 'whsec_managed').update(`del-2.${ts}.${request.options.body}`).digest('base64')
  assert.equal(request.options.headers['webhook-signature'], `v1,${expected}`)
  assert.match(request.options.body, /ada@example\.com/)
})

test('retries with backoff on a failed delivery (non-terminal)', async () => {
  const db = makeDb({
    deliveries: [
      {
        id: 'del-3',
        endpoint_id: null,
        site_id: 'site-1',
        type: 'contentkit.contact.submitted',
        payload: {},
        attempts: 0,
        status: 'pending',
      },
    ],
  })
  const worker = createOutboxWorker(baseConfig, db, logger, async () => new Response('nope', { status: 500 }))
  await worker.tick()
  const update = db.updates.find((u) => u.table === 'ck_webhook_deliveries')
  assert.equal(update.body.status, 'pending')
  assert.equal(update.body.attempts, 1)
  assert.match(update.body.last_error, /500/)
  assert.ok(new Date(update.body.next_attempt_at) > new Date())
})

test('auto-disables an endpoint after the circuit-breaker threshold of terminal failures', async () => {
  const db = makeDb({
    deliveries: [
      {
        id: 'del-4',
        endpoint_id: 'ep-1',
        site_id: 'site-1',
        type: 'contentkit.contact.submitted',
        payload: {},
        attempts: 0,
        status: 'pending',
      },
    ],
    endpoints: {
      'ep-1': {
        id: 'ep-1',
        url: 'https://hooks.example/x',
        secret_encrypted: encryptSecret('whsec_managed', 'pepper'),
        disabled_at: null,
        consecutive_failures: 0,
      },
    },
  })
  const worker = createOutboxWorker(
    { ...baseConfig, webhookMaxAttempts: 1, webhookCircuitThreshold: 1 },
    db,
    logger,
    async () => new Response('down', { status: 503 }),
  )
  await worker.tick()
  const delivery = db.updates.find((u) => u.table === 'ck_webhook_deliveries')
  assert.equal(delivery.body.status, 'failed')
  const endpoint = db.updates.find((u) => u.table === 'ck_webhook_endpoints')
  assert.equal(endpoint.body.consecutive_failures, 1)
  assert.ok(endpoint.body.disabled_at)
})
