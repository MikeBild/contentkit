import { createHmac } from 'node:crypto'

function signature(secret, id, timestamp, body) {
  const digest = createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64')
  return `v1,${digest}`
}

export function createOutboxWorker(config, db, logger, fetchImpl = fetch) {
  let timer
  let running = false

  async function deliver(event) {
    const sites = await db.select('ck_sites', { id: `eq.${event.site_id}`, limit: '1' })
    const site = sites[0]
    const body = JSON.stringify({
      event_id: event.id,
      type: event.type,
      site: { id: site?.id, name: site?.name },
      occurred_at: event.created_at,
      summary: event.payload?.summary || event.type,
      resource: { kind: event.resource_kind, id: event.resource_id },
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const response = await fetchImpl(config.subkitWebhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': event.id,
        'webhook-timestamp': timestamp,
        'webhook-type': event.type,
        'webhook-signature': signature(config.subkitWebhookSecret, event.id, timestamp, body),
      },
      body,
    })
    if (!response.ok) throw new Error(`Subkit webhook returned ${response.status}`)
    await db.update('ck_outbox_events', { id: `eq.${event.id}` }, {
      status: 'delivered', delivered_at: new Date().toISOString(), last_error: null,
      attempts: Number(event.attempts || 0) + 1,
    }, { returning: false })
  }

  async function tick() {
    if (running || !config.subkitWebhookUrl || !config.subkitWebhookSecret) return
    running = true
    try {
      const events = await db.select('ck_outbox_events', {
        status: 'eq.pending', next_attempt_at: `lte.${new Date().toISOString()}`, order: 'created_at.asc', limit: '10',
      })
      for (const event of events) {
        try {
          await deliver(event)
        } catch (error) {
          const attempts = Number(event.attempts || 0) + 1
          const backoffSeconds = Math.min(10 * (2 ** Math.min(attempts - 1, 8)), 1800)
          await db.update('ck_outbox_events', { id: `eq.${event.id}` }, {
            attempts, last_error: String(error.message || error).slice(0, 500),
            status: attempts >= 10 ? 'failed' : 'pending',
            next_attempt_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
          }, { returning: false }).catch(() => {})
          logger.warn('webhook delivery failed', { eventId: event.id, attempts, error: String(error.message || error) })
        }
      }
    } catch (error) {
      logger.error('outbox poll failed', { error: String(error.message || error) })
    } finally {
      running = false
    }
  }

  return {
    start() { timer = setInterval(tick, config.webhookPollMs); timer.unref?.(); tick() },
    stop() { clearInterval(timer) },
    tick,
  }
}
