import { hmac256 } from './utils.mjs'

const TRAFFIC_CLASSES = new Set(['organic', 'synthetic', 'internal'])
const REQUEST_SOURCES = new Set(['api', 'gateway', 'reader', 'scheduler', 'manual', 'mcp'])
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

function bounded(value, max) {
  if (value == null) return null
  const text = String(value)
  return text.length > 0 && text.length <= max ? text : null
}

function integer(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function outcomeForStatus(statusCode) {
  if (statusCode >= 500) return 'server_error'
  if (statusCode >= 400) return 'client_error'
  return 'success'
}

function internalRoute(route) {
  return /^(?:\/health|\/ready|\/metrics|\/v1\/sites\/:site\/stats\/)/.test(route || '')
}

export function markUsageContext(req, input = {}) {
  const previous = req.contentkitUsage || {}
  req.contentkitUsage = {
    ...previous,
    ...(input.siteId ? { siteId: input.siteId } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestSource ? { requestSource: input.requestSource } : {}),
  }
  return req.contentkitUsage
}

export function createUsageTelemetry(config, db, logger) {
  const enabled = config.usageTelemetryEnabled === true
  const secret = config.usageHmacSecret || ''
  const retentionDays = config.usageRetentionDays || 90
  let cleanupTimer = null
  let dropped = 0

  const hash = (kind, value) => (value && secret ? hmac256(secret, `${kind}:${value}`) : null)

  async function write(row) {
    if (!enabled || !db.insert) return false
    try {
      await db.insert('ck_usage_events', row, { returning: false })
      return true
    } catch (error) {
      dropped += 1
      logger?.warn?.('usage telemetry write failed', {
        surface: row.surface,
        operation: row.operation,
        error: String(error.message || error),
      })
      return false
    }
  }

  function identity(context = {}) {
    return {
      actor_hmac: hash('actor', context.actorId),
      session_hmac: hash('session', context.sessionId),
    }
  }

  async function recordHttp(req, res, input) {
    if (!enabled) return false
    const context = req.contentkitUsage || {}
    if (!context.siteId) return false
    const route = bounded(input.route, 200)
    const authenticated = Boolean(context.actorId)
    const declaredTraffic = bounded(req.headers['x-contentkit-traffic-class'], 16)
    const trafficClass = internalRoute(route)
      ? 'internal'
      : authenticated && TRAFFIC_CLASSES.has(declaredTraffic)
        ? declaredTraffic
        : 'organic'
    const declaredSource = bounded(req.headers['x-contentkit-request-source'], 16)
    const requestSource = REQUEST_SOURCES.has(context.requestSource)
      ? context.requestSource
      : authenticated && REQUEST_SOURCES.has(declaredSource)
        ? declaredSource
        : route?.startsWith('/_contentkit/')
          ? 'reader'
          : context.requestSource || 'api'
    const headerSession = authenticated ? bounded(req.headers['x-contentkit-session-id'], 200) : null
    const responseLength = integer(res.getHeader('content-length'))
    return write({
      site_id: context.siteId,
      surface: 'http',
      operation: 'request',
      route,
      method: METHODS.has(req.method) ? req.method : null,
      status_code: res.statusCode,
      outcome: outcomeForStatus(res.statusCode),
      traffic_class: trafficClass,
      request_source: requestSource,
      ...identity({ ...context, sessionId: context.sessionId || headerSession }),
      duration_ms: integer(input.durationMs) || 0,
      request_bytes: integer(req.headers['content-length']),
      response_bytes: responseLength,
      semantic_node_count: null,
      diagnostic_count: null,
      requested_pattern: null,
      resolved_pattern: null,
      fallback: null,
      output_format: null,
    })
  }

  async function recordComposition(req, input) {
    if (!enabled) return false
    const context = req.contentkitUsage || {}
    if (!context.siteId) return false
    const declaredTraffic = bounded(req.headers['x-contentkit-traffic-class'], 16)
    const declaredSource = bounded(req.headers['x-contentkit-request-source'], 16)
    const headerSession = context.actorId ? bounded(req.headers['x-contentkit-session-id'], 200) : null
    const requested = bounded(input.requestedPattern, 80)
    const resolved = bounded(input.resolvedPattern, 80)
    return write({
      site_id: context.siteId,
      surface: 'composition',
      operation: input.operation,
      route: null,
      method: null,
      status_code: null,
      outcome: input.outcome || 'success',
      traffic_class: context.actorId && TRAFFIC_CLASSES.has(declaredTraffic) ? declaredTraffic : 'organic',
      request_source: context.actorId && REQUEST_SOURCES.has(declaredSource) ? declaredSource : 'api',
      ...identity({ ...context, sessionId: context.sessionId || headerSession }),
      duration_ms: integer(input.durationMs) || 0,
      request_bytes: null,
      response_bytes: integer(input.responseBytes),
      semantic_node_count: integer(input.semanticNodeCount),
      diagnostic_count: integer(input.diagnosticCount),
      requested_pattern: requested,
      resolved_pattern: resolved,
      fallback: requested ? requested !== resolved : false,
      output_format: input.outputFormat || 'json',
    })
  }

  async function recordMcp(input = {}) {
    if (!enabled) return false
    const principal = input.principal || {}
    const declaredTraffic = bounded(input.trafficClass, 16)
    return write({
      site_id: input.siteId || null,
      surface: 'mcp',
      operation: bounded(input.operation, 80) || 'unknown',
      route: null,
      method: null,
      status_code: null,
      outcome: ['success', 'client_error', 'server_error', 'rejected', 'timeout', 'cancelled'].includes(input.outcome)
        ? input.outcome
        : 'success',
      traffic_class: TRAFFIC_CLASSES.has(declaredTraffic) ? declaredTraffic : 'organic',
      request_source: 'mcp',
      ...identity({ actorId: principal.id, sessionId: input.sessionId }),
      duration_ms: integer(input.durationMs) || 0,
      request_bytes: null,
      response_bytes: null,
      semantic_node_count: null,
      diagnostic_count: null,
      requested_pattern: null,
      resolved_pattern: null,
      fallback: null,
      output_format: null,
      tool_name: bounded(input.toolName, 128),
      resource_kind: bounded(input.resourceKind, 80),
      response_mode: ['json', 'sse', 'none'].includes(input.responseMode) ? input.responseMode : null,
      result_count: integer(input.resultCount),
      active_sessions: integer(input.activeSessions),
    })
  }

  async function cleanup() {
    if (!enabled || !db.query) return 0
    try {
      const rows = await db.query(
        `WITH deleted AS (
           DELETE FROM ck_usage_events
            WHERE created_at < now() - ($1::int * interval '1 day')
            RETURNING 1
         ) SELECT count(*)::int AS deleted FROM deleted`,
        [retentionDays],
      )
      return Number(rows[0]?.deleted || 0)
    } catch (error) {
      logger?.warn?.('usage telemetry retention cleanup failed', { error: String(error.message || error) })
      return 0
    }
  }

  return {
    enabled,
    recordHttp,
    recordComposition,
    recordMcp,
    cleanup,
    quality: () => ({ sampled: false, dropped_events: dropped, retention_days: retentionDays }),
    start() {
      if (!enabled || cleanupTimer) return
      cleanup().catch(() => {})
      cleanupTimer = setInterval(() => cleanup().catch(() => {}), 60 * 60 * 1000)
      cleanupTimer.unref?.()
    },
    stop() {
      if (cleanupTimer) clearInterval(cleanupTimer)
      cleanupTimer = null
    },
  }
}
