const SENSITIVE = /(?:secret|token|password|authorization|cookie|markdown|content|body|email)/i

function sanitize(value, depth = 0) {
  if (depth > 3 || value == null) return value == null ? null : undefined
  if (typeof value === 'string') return value.slice(0, 500)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value))
    return value
      .slice(0, 50)
      .map((entry) => sanitize(entry, depth + 1))
      .filter((v) => v !== undefined)
  if (typeof value !== 'object') return undefined
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE.test(key))
      .slice(0, 50)
      .map(([key, entry]) => [key.slice(0, 80), sanitize(entry, depth + 1)])
      .filter(([, entry]) => entry !== undefined),
  )
}

export function createAudit(db, logger) {
  return {
    async record(event) {
      if (!db.insert) return null
      const row = {
        site_id: event.siteId || null,
        actor_type: event.actorType || 'system',
        actor_id: event.actorId ? String(event.actorId).slice(0, 200) : null,
        action: String(event.action).slice(0, 120),
        resource_type: String(event.resourceType || 'system').slice(0, 80),
        resource_id: event.resourceId ? String(event.resourceId).slice(0, 200) : null,
        result: event.result || 'success',
        transport: event.transport || 'worker',
        request_id: event.requestId ? String(event.requestId).slice(0, 80) : null,
        metadata: sanitize(event.metadata || {}),
      }
      try {
        return (await db.insert('ck_audit_events', row))[0] || null
      } catch (error) {
        logger?.warn?.('audit write failed', { action: row.action, error: String(error.message || error) })
        return null
      }
    },
  }
}
