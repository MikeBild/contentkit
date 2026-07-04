import { createHmac } from 'node:crypto'
import { decryptSecret } from './secrets.mjs'

// Standard Webhooks signature: v1,<base64 HMAC-SHA256 of "id.timestamp.body">.
function signature(secret, id, timestamp, body) {
  const digest = createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64')
  return `v1,${digest}`
}

// Exponential backoff (base 10s, doubling, capped 30min) with ±15% jitter so a
// fleet of due deliveries doesn't retry in lockstep against a recovering endpoint.
function nextDelaySeconds(attempts) {
  const base = Math.min(10 * 2 ** Math.min(attempts - 1, 8), 1800)
  return base * (0.85 + Math.random() * 0.3)
}

export function createOutboxWorker(config, db, logger, fetchImpl = fetch) {
  let timer
  let running = false

  // Resolves a delivery to its live target. endpoint_id=null is the legacy
  // env-configured default endpoint; a set endpoint_id loads and decrypts it.
  async function resolveTarget(delivery) {
    if (!delivery.endpoint_id) {
      if (!config.webhookUrl || !config.webhookSecret) return null
      return { url: config.webhookUrl, secret: config.webhookSecret, endpoint: null }
    }
    const [endpoint] = await db.select('ck_webhook_endpoints', { id: `eq.${delivery.endpoint_id}`, limit: '1' })
    if (!endpoint || endpoint.disabled_at) return null
    return { url: endpoint.url, secret: decryptSecret(endpoint.secret_encrypted, config.keyPepper), endpoint }
  }

  async function deliver(delivery) {
    const target = await resolveTarget(delivery)
    if (!target) {
      await db.update(
        'ck_webhook_deliveries',
        { id: `eq.${delivery.id}` },
        {
          status: 'failed',
          last_error: 'endpoint unavailable or disabled',
          attempts: Number(delivery.attempts || 0) + 1,
        },
        { returning: false },
      )
      return
    }
    const body = JSON.stringify(delivery.payload)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.webhookTimeoutMs)
    let response
    try {
      response = await fetchImpl(target.url, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'webhook-id': delivery.id,
          'webhook-timestamp': timestamp,
          'webhook-type': delivery.type,
          'webhook-signature': signature(target.secret, delivery.id, timestamp, body),
        },
        body,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok)
      throw Object.assign(new Error(`endpoint returned ${response.status}`), { responseStatus: response.status })
    await db.update(
      'ck_webhook_deliveries',
      { id: `eq.${delivery.id}` },
      {
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        last_error: null,
        response_status: response.status,
        attempts: Number(delivery.attempts || 0) + 1,
      },
      { returning: false },
    )
    if (target.endpoint && Number(target.endpoint.consecutive_failures || 0) > 0) {
      await db
        .update(
          'ck_webhook_endpoints',
          { id: `eq.${target.endpoint.id}` },
          { consecutive_failures: 0 },
          { returning: false },
        )
        .catch(() => {})
    }
  }

  async function onFailure(delivery, error) {
    const attempts = Number(delivery.attempts || 0) + 1
    const terminal = attempts >= config.webhookMaxAttempts
    await db
      .update(
        'ck_webhook_deliveries',
        { id: `eq.${delivery.id}` },
        {
          attempts,
          last_error: String(error.message || error).slice(0, 500),
          response_status: error.responseStatus ?? null,
          status: terminal ? 'failed' : 'pending',
          next_attempt_at: new Date(Date.now() + nextDelaySeconds(attempts) * 1000).toISOString(),
        },
        { returning: false },
      )
      .catch(() => {})
    // Circuit breaker: count fully-exhausted deliveries per endpoint; auto-disable
    // once an endpoint crosses the threshold so a dead URL stops burning retries.
    if (terminal && delivery.endpoint_id) {
      const [endpoint] = await db.select('ck_webhook_endpoints', { id: `eq.${delivery.endpoint_id}`, limit: '1' })
      if (endpoint) {
        const failures = Number(endpoint.consecutive_failures || 0) + 1
        const patch = { consecutive_failures: failures }
        if (failures >= config.webhookCircuitThreshold) patch.disabled_at = new Date().toISOString()
        await db
          .update('ck_webhook_endpoints', { id: `eq.${endpoint.id}` }, patch, { returning: false })
          .catch(() => {})
        if (patch.disabled_at) logger.warn('webhook endpoint auto-disabled', { endpointId: endpoint.id, failures })
      }
    }
    logger.warn('webhook delivery failed', {
      deliveryId: delivery.id,
      attempts,
      terminal,
      error: String(error.message || error),
    })
  }

  async function tick() {
    if (running) return
    running = true
    try {
      const deliveries = await db.select('ck_webhook_deliveries', {
        status: 'eq.pending',
        next_attempt_at: `lte.${new Date().toISOString()}`,
        order: 'created_at.asc',
        limit: '20',
      })
      for (const delivery of deliveries) {
        try {
          await deliver(delivery)
        } catch (error) {
          await onFailure(delivery, error)
        }
      }
    } catch (error) {
      logger.error('webhook poll failed', { error: String(error.message || error) })
    } finally {
      running = false
    }
  }

  return {
    start() {
      timer = setInterval(tick, config.webhookPollMs)
      timer.unref?.()
      tick()
    },
    stop() {
      clearInterval(timer)
    },
    tick,
  }
}
