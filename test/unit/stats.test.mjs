import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getAudioStats,
  getContentStats,
  getEngagementStats,
  getHttpStats,
  getReaderStats,
  getReleaseStats,
  getWebhookStats,
  resolveStatsWindow,
  resolveUsageStatsWindow,
} from '../../src/stats.mjs'

const now = new Date('2026-07-18T12:34:56.000Z')

test('stats windows default to a bounded 24h UTC range and reject invalid input', () => {
  const window = resolveStatsWindow({}, now)
  assert.equal(window.bucket, 'hour')
  assert.equal(window.tz, 'UTC')
  assert.equal(window.from.toISOString(), '2026-07-17T12:34:56.000Z')
  assert.equal(window.to.toISOString(), now.toISOString())
  assert.throws(() => resolveStatsWindow({ bucket: 'minute' }, now), /bucket must be one of/)
  assert.throws(() => resolveStatsWindow({ tz: 'Europe/Berlin' }, now), /only 'UTC'/)
  assert.throws(
    () => resolveStatsWindow({ from: '2026-01-01T00:00:00Z', to: '2026-07-01T00:00:00Z' }, now),
    /window is too large/,
  )
})

test('usage stats validate traffic/grouping and preserve exact window uniques and ratio evidence', async () => {
  const window = resolveUsageStatsWindow(
    {
      from: '2026-07-18T10:15:00Z',
      to: '2026-07-18T12:00:00Z',
      bucket: 'hour',
      traffic_class: 'synthetic',
      group_by: 'route,method',
    },
    'http',
    now,
  )
  assert.deepEqual(window.groupBy, ['route', 'method'])
  assert.throws(() => resolveUsageStatsWindow({ group_by: 'route,method,outcome' }, 'http', now), /at most two/)
  assert.throws(() => resolveUsageStatsWindow({ group_by: 'requested_pattern' }, 'http', now), /not supported/)
  assert.throws(() => resolveUsageStatsWindow({ traffic_class: 'bot' }, 'http', now), /traffic_class/)

  const calls = []
  const db = {
    async query(sql, values) {
      calls.push({ sql, values })
      if (/date_trunc\(\$4::text, created_at\) AS ts/.test(sql)) {
        return [
          {
            ts: new Date('2026-07-18T10:00:00Z'),
            dimension_1: '/v1/sites/:site/published',
            dimension_2: 'GET',
            calls: 5,
            success: 4,
            client_errors: 1,
            server_errors: 0,
            rejected: 0,
            unique_actors: 2,
            unique_sessions: 3,
            duration_ms_total: 50,
            duration_ms_avg: 10,
            duration_ms_p50: 8,
            duration_ms_p95: 20,
            request_size_count: 0,
            response_size_count: 5,
            request_bytes: 0,
            response_bytes: 500,
          },
        ]
      }
      return [
        {
          dimension_1: '/v1/sites/:site/published',
          dimension_2: 'GET',
          calls: 8,
          success: 7,
          client_errors: 1,
          unique_actors: 3,
          unique_sessions: 4,
          duration_ms_total: 80,
          duration_ms_avg: 10,
          duration_ms_p50: 8,
          duration_ms_p95: 21,
          request_size_count: 0,
          response_size_count: 8,
          response_bytes: 800,
        },
      ]
    },
  }
  const result = await getHttpStats(db, 'site-1', window, { dropped_events: 0, retention_days: 90 })
  assert.equal(result.schema_version, 'contentkit.usage-stats.v1')
  assert.equal(result.buckets[0].metrics.success_ratio.numerator, 4)
  assert.equal(result.buckets[0].metrics.success_ratio.denominator, 5)
  assert.equal(result.buckets[0].metrics.request_bytes.value_state, 'missing')
  assert.equal(result.totals[0].metrics.unique_actors.value, 3)
  assert.equal(result.quality.unique_count_method, 'exact_window')
  assert.equal(result.quality.content_captured, false)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].values, ['site-1', window.from, window.to, 'hour', 'http', 'synthetic'])
  assert.deepEqual(calls[1].values, ['site-1', window.from, window.to, 'http', 'synthetic'])
  for (const call of calls) {
    assert.match(call.sql, /site_id = \$1/)
    assert.match(call.sql, /count\(DISTINCT actor_hmac\)/)
    assert.doesNotMatch(call.sql, /markdown|query_string|ip_address|user_agent/)
  }
})

test('every stats reader returns dense aggregates and uses only site-scoped, parameterized SQL', async () => {
  const calls = []
  const db = {
    async query(sql, values) {
      calls.push({ sql, values })
      return [
        { ts: new Date('2026-07-18T10:00:00Z'), metric: 'builds_started', value: '2' },
        { ts: new Date('2026-07-18T10:00:00Z'), metric: 'duration_seconds_total', value: '12' },
        { ts: new Date('2026-07-18T10:00:00Z'), metric: 'duration_seconds_count', value: '2' },
        { ts: new Date('2026-07-18T10:00:00Z'), metric: 'duration_seconds_max', value: '8' },
        { ts: new Date('2026-07-18T11:00:00Z'), metric: 'duration_seconds_max', value: '3' },
        { ts: new Date('2026-07-18T10:00:00Z'), metric: 'items_created', value: '3' },
        { ts: new Date('2026-07-18T10:00:00Z'), metric: 'auth_success', value: '4' },
        { ts: new Date('2026-07-18T10:00:00Z'), metric: 'delivered', value: '5' },
        { ts: new Date('2026-07-18T10:00:00Z'), metric: 'characters', value: '600' },
        { ts: new Date('2026-07-18T10:00:00Z'), metric: 'feedback_up', value: '7' },
      ]
    },
  }
  const window = resolveStatsWindow({ from: '2026-07-18T10:15:00Z', to: '2026-07-18T12:00:00Z', bucket: 'hour' }, now)
  const readers = [getReleaseStats, getContentStats, getReaderStats, getWebhookStats, getAudioStats, getEngagementStats]
  const results = []
  for (const read of readers) results.push(await read(db, 'site-1', window))

  for (const result of results) {
    assert.equal(result.buckets.length, 2)
    assert.equal(result.buckets[0].ts, '2026-07-18T10:00:00.000Z')
    assert.equal(result.buckets[1].ts, '2026-07-18T11:00:00.000Z')
    assert.doesNotMatch(JSON.stringify(result), /site-1|username|email|payload|storage_path/)
  }
  assert.equal(results[0].buckets[0].duration_seconds_avg, 6)
  assert.equal(results[0].totals.duration_seconds_max, 8)
  assert.equal(results[1].totals.items_created, 3)
  assert.equal(results[2].totals.auth_success, 4)
  assert.equal(results[3].totals.delivered, 5)
  assert.equal(results[4].totals.characters, 600)
  assert.equal(results[5].totals.feedback_up, 7)

  assert.equal(calls.length, 6)
  for (const call of calls) {
    assert.deepEqual(call.values, ['site-1', window.from, window.to, 'hour'])
    assert.match(call.sql, /site_id = \$1/)
    assert.match(call.sql, /occurred_at >= \$2 AND occurred_at < \$3/)
    assert.doesNotMatch(call.sql, /author_name|author_email|password_hash|token_hash|payload\b|last_error/)
  }
})
