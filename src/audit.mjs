const SENSITIVE = /(?:secret|token|password|authorization|cookie|markdown|content|body|email)/i

/**
 * The closed sets `ck_audit_events` enforces, named here so a call site can be
 * checked against them without a database.
 *
 * They are not the source of truth — the `check` constraints in
 * 0012_contentkit_mcp_oauth.sql are — and test/unit/audit-enums.test.mjs holds
 * these three to that file. They exist because an audit write that violates a
 * constraint fails at the database, and `record()` deliberately swallows that:
 * a destructive verb once deleted content and left no trail at all, with a
 * single warn line as the only signal. A closed set a test can read turns that
 * into a build failure.
 */
export const AUDIT_ACTOR_TYPES = Object.freeze(['api_key', 'oauth', 'operator', 'system'])
export const AUDIT_TRANSPORTS = Object.freeze(['http', 'mcp', 'oauth', 'worker'])
export const AUDIT_RESULTS = Object.freeze(['success', 'denied', 'failed', 'cancelled'])

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

/**
 * The actor half of an audit row, derived from the principal rather than
 * restated at each call site.
 *
 * `ck_audit_events.actor_type` admits `operator` alongside `api_key` and
 * `oauth`, and the Cockpit's session principal is neither of the latter two —
 * recording it as `api_key` made every console action look like it came from a
 * credential that does not exist. Every surface (HTTP, MCP, assistant) derives
 * it here so the Audit page's actor column means one thing.
 */
export function auditActor(principal) {
  return {
    actorType: principal?.oauth ? 'oauth' : principal?.via === 'operator_session' ? 'operator' : 'api_key',
    actorId: principal?.id ?? null,
  }
}

export function createAudit(db, logger) {
  const rowFor = (event) => ({
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
  })
  return {
    async record(event) {
      if (!db.insert) return null
      const row = rowFor(event)
      try {
        return (await db.insert('ck_audit_events', row))[0] || null
      } catch (error) {
        logger?.warn?.('audit write failed', { action: row.action, error: String(error.message || error) })
        return null
      }
    },
    // Human decisions are one transaction with their business write. Unlike
    // record(), this deliberately propagates a failure so the mutation cannot
    // commit without its durable history.
    async recordStrict(event, exec = db) {
      if (!exec.insert) throw new Error('audit storage is unavailable')
      return (await exec.insert('ck_audit_events', rowFor(event)))[0] || null
    },
  }
}
