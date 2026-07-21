import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsageTelemetry, markUsageContext } from '../../src/usage.mjs'

function response(statusCode = 200, length = '42') {
  return {
    statusCode,
    getHeader(name) {
      return name === 'content-length' ? length : undefined
    },
  }
}

test('usage telemetry stores only bounded dimensions and product-local HMAC identities', async () => {
  const writes = []
  const db = {
    async insert(table, row, options) {
      writes.push({ table, row, options })
    },
  }
  const usage = createUsageTelemetry(
    { usageTelemetryEnabled: true, usageHmacSecret: 'local-product-secret', usageRetentionDays: 90 },
    db,
    { warn() {} },
  )
  const req = {
    method: 'GET',
    headers: {
      'content-length': '12',
      'x-contentkit-traffic-class': 'synthetic',
      'x-contentkit-request-source': 'manual',
      'x-contentkit-session-id': 'raw-session',
      authorization: 'Bearer raw-secret',
      'user-agent': 'not-stored',
    },
  }
  markUsageContext(req, { siteId: 'site-1', actorId: 'api:key-1' })
  await usage.recordHttp(req, response(), {
    route: '/v1/sites/:site/published/:kind/:locale/:slug',
    durationMs: 8,
  })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].table, 'ck_usage_events')
  assert.equal(writes[0].row.traffic_class, 'synthetic')
  assert.equal(writes[0].row.request_source, 'manual')
  assert.match(writes[0].row.actor_hmac, /^[0-9a-f]{64}$/)
  assert.match(writes[0].row.session_hmac, /^[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(writes[0]), /raw-secret|raw-session|user-agent|key-1/)
  assert.equal(writes[0].row.request_bytes, 12)
  assert.equal(writes[0].row.response_bytes, 42)
})

test('anonymous HTTP is never fingerprinted and reporting traffic is internal', async () => {
  const rows = []
  const usage = createUsageTelemetry(
    { usageTelemetryEnabled: true, usageHmacSecret: 'secret' },
    {
      async insert(_table, row) {
        rows.push(row)
      },
    },
    { warn() {} },
  )
  const req = {
    method: 'GET',
    headers: {
      'x-contentkit-traffic-class': 'synthetic',
      'x-contentkit-session-id': 'untrusted-anonymous-session',
    },
  }
  markUsageContext(req, { siteId: 'site-1' })
  await usage.recordHttp(req, response(), { route: '/v1/sites/:site/stats/http', durationMs: 2 })
  assert.equal(rows[0].traffic_class, 'internal')
  assert.equal(rows[0].actor_hmac, null)
  assert.equal(rows[0].session_hmac, null)
})

test('disabled telemetry is a no-op and retention cleanup is parameterized', async () => {
  let inserted = false
  const disabled = createUsageTelemetry(
    { usageTelemetryEnabled: false },
    {
      async insert() {
        inserted = true
      },
    },
    { warn() {} },
  )
  await disabled.recordComposition({ headers: {}, contentkitUsage: { siteId: 'site-1' } }, { operation: 'compile' })
  assert.equal(inserted, false)

  const calls = []
  const enabled = createUsageTelemetry(
    { usageTelemetryEnabled: true, usageHmacSecret: 'secret', usageRetentionDays: 90 },
    {
      async query(sql, values) {
        calls.push({ sql, values })
        return [{ deleted: 3 }]
      },
    },
    { warn() {} },
  )
  assert.equal(await enabled.cleanup(), 3)
  assert.deepEqual(calls[0].values, [90])
  assert.match(calls[0].sql, /DELETE FROM ck_usage_events/)
})

test('MCP telemetry keeps only bounded categories and HMAC identities', async () => {
  const rows = []
  const usage = createUsageTelemetry(
    { usageTelemetryEnabled: true, usageHmacSecret: 'usage-secret', usageRetentionDays: 90 },
    {
      async insert(_table, row) {
        rows.push(row)
      },
    },
    { warn() {} },
  )
  await usage.recordMcp({
    siteId: 'site-1',
    operation: 'tool_call',
    toolName: 'contentkit_read',
    principal: { id: 'raw-operator-id' },
    sessionId: 'raw-session-id',
    outcome: 'success',
    durationMs: 12,
    resultCount: 3,
    responseMode: 'sse',
    prompt: 'must not be stored',
    arguments: { markdown: 'must not be stored' },
  })
  assert.equal(rows[0].surface, 'mcp')
  assert.equal(rows[0].request_source, 'mcp')
  assert.equal(rows[0].tool_name, 'contentkit_read')
  assert.equal(rows[0].result_count, 3)
  assert.equal(rows[0].response_mode, 'sse')
  assert.doesNotMatch(JSON.stringify(rows[0]), /raw-operator|raw-session|must not be stored|markdown/)
})
