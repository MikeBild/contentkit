// Site-scoped product analytics over ContentKit's own PostgreSQL tables.
// Responses contain bounded counts/sums only—never Markdown, reader identity,
// API keys, webhook endpoints/payloads, storage paths or row identifiers.

export const STATS_BUCKETS = ['hour', 'day', 'month', 'year']
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const WINDOW_CAP_MS = { hour: 31 * DAY, day: 366 * DAY, month: 5 * 366 * DAY, year: 10 * 366 * DAY }

const invalid = (message) => Object.assign(new Error(message), { statusCode: 422 })

export function resolveStatsWindow(input = {}, now = new Date()) {
  const bucket = String(input.bucket || 'hour')
  if (!STATS_BUCKETS.includes(bucket)) throw invalid(`bucket must be one of ${STATS_BUCKETS.join(', ')}`)
  const tz = String(input.tz || 'UTC')
  if (tz !== 'UTC') throw invalid("tz currently supports only 'UTC'")
  const to = input.to ? new Date(String(input.to)) : now
  const from = input.from ? new Date(String(input.from)) : new Date(to.getTime() - 24 * HOUR)
  if (!Number.isFinite(from.getTime())) throw invalid("'from' must be an RFC 3339 timestamp")
  if (!Number.isFinite(to.getTime())) throw invalid("'to' must be an RFC 3339 timestamp")
  if (to <= from) throw invalid("'to' must be after 'from'")
  if (to.getTime() - from.getTime() > WINDOW_CAP_MS[bucket]) throw invalid(`${bucket} bucket window is too large`)
  return { bucket, tz: 'UTC', from, to }
}

function floorBucket(date, bucket) {
  const value = new Date(date)
  value.setUTCMinutes(0, 0, 0)
  if (bucket !== 'hour') value.setUTCHours(0)
  if (bucket === 'month' || bucket === 'year') value.setUTCDate(1)
  if (bucket === 'year') value.setUTCMonth(0)
  return value
}

function nextBucket(date, bucket) {
  const value = new Date(date)
  if (bucket === 'hour') value.setUTCHours(value.getUTCHours() + 1)
  else if (bucket === 'day') value.setUTCDate(value.getUTCDate() + 1)
  else if (bucket === 'month') value.setUTCMonth(value.getUTCMonth() + 1)
  else value.setUTCFullYear(value.getUTCFullYear() + 1)
  return value
}

function bucketKeys(window) {
  const keys = []
  for (
    let cursor = floorBucket(window.from, window.bucket);
    cursor < window.to;
    cursor = nextBucket(cursor, window.bucket)
  ) {
    keys.push(cursor.toISOString())
  }
  return keys
}

const number = (value) => {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}
const iso = (value) => new Date(value).toISOString()

function zero(metrics) {
  return Object.fromEntries(metrics.map((metric) => [metric, 0]))
}

function response(window, rows, metrics, finalize = (values) => values) {
  const byTs = new Map()
  for (const row of rows) {
    if (!metrics.includes(row.metric)) continue
    const ts = iso(row.ts)
    const values = byTs.get(ts) || zero(metrics)
    values[row.metric] += number(row.value)
    byTs.set(ts, values)
  }
  const buckets = bucketKeys(window).map((ts) => ({ ts, ...finalize(byTs.get(ts) || zero(metrics)) }))
  const totals = zero(metrics)
  for (const bucket of buckets) for (const metric of metrics) totals[metric] += number(bucket[metric])
  return {
    bucket: window.bucket,
    tz: window.tz,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    buckets,
    totals: finalize(totals),
  }
}

async function metricQuery(db, sql, siteId, window) {
  return db.query(sql, [siteId, window.from, window.to, window.bucket])
}

const RELEASE_METRICS = [
  'builds_started',
  'builds_completed',
  'builds_failed',
  'builds_activated',
  'release_builds',
  'preview_builds',
  'files',
  'bytes',
  'duration_seconds_total',
  'duration_seconds_count',
  'duration_seconds_max',
]

export async function getReleaseStats(db, siteId, window) {
  const rows = await metricQuery(
    db,
    `WITH release_bytes AS (
       SELECT e.release_id, coalesce(sum(e.byte_size), 0)::double precision AS bytes
         FROM ck_release_entries e
         JOIN ck_releases r ON r.id = e.release_id
        WHERE r.site_id = $1
        GROUP BY e.release_id
     )
     SELECT date_trunc($4, occurred_at) AS ts, metric,
            CASE WHEN metric = 'duration_seconds_max' THEN max(value)
                 ELSE sum(value) END::double precision AS value
       FROM (
         SELECT r.created_at AS occurred_at, 'builds_started' AS metric, 1::double precision AS value
           FROM ck_releases r WHERE r.site_id = $1
         UNION ALL SELECT r.created_at, CASE WHEN r.kind = 'preview' THEN 'preview_builds' ELSE 'release_builds' END, 1
           FROM ck_releases r WHERE r.site_id = $1
         UNION ALL SELECT r.completed_at,
           CASE WHEN r.status = 'failed' THEN 'builds_failed' ELSE 'builds_completed' END, 1
           FROM ck_releases r WHERE r.site_id = $1 AND r.completed_at IS NOT NULL
         UNION ALL SELECT r.activated_at, 'builds_activated', 1
           FROM ck_releases r WHERE r.site_id = $1 AND r.activated_at IS NOT NULL
         UNION ALL SELECT r.completed_at, 'files', r.file_count::double precision
           FROM ck_releases r WHERE r.site_id = $1 AND r.completed_at IS NOT NULL
         UNION ALL SELECT r.completed_at, 'bytes', coalesce(b.bytes, 0)
           FROM ck_releases r LEFT JOIN release_bytes b ON b.release_id = r.id
          WHERE r.site_id = $1 AND r.completed_at IS NOT NULL
         UNION ALL SELECT r.completed_at, 'duration_seconds_total',
           extract(epoch FROM r.completed_at - r.created_at)
           FROM ck_releases r WHERE r.site_id = $1 AND r.completed_at IS NOT NULL
         UNION ALL SELECT r.completed_at, 'duration_seconds_count', 1
           FROM ck_releases r WHERE r.site_id = $1 AND r.completed_at IS NOT NULL
         UNION ALL SELECT r.completed_at, 'duration_seconds_max',
           extract(epoch FROM r.completed_at - r.created_at)
           FROM ck_releases r WHERE r.site_id = $1 AND r.completed_at IS NOT NULL
       ) events
      WHERE occurred_at >= $2 AND occurred_at < $3
      GROUP BY 1, metric ORDER BY 1, metric`,
    siteId,
    window,
  )
  const result = response(window, rows, RELEASE_METRICS)
  const addAverage = (values) => ({
    ...values,
    duration_seconds_avg: values.duration_seconds_count
      ? values.duration_seconds_total / values.duration_seconds_count
      : 0,
  })
  result.buckets = result.buckets.map(addAverage)
  result.totals = addAverage(result.totals)
  result.totals.duration_seconds_max = Math.max(0, ...result.buckets.map((bucket) => bucket.duration_seconds_max))
  return result
}

const CONTENT_METRICS = ['items_created', 'revisions_created', 'revisions_published', 'assets_created', 'asset_bytes']

export async function getContentStats(db, siteId, window) {
  const rows = await metricQuery(
    db,
    `SELECT date_trunc($4, occurred_at) AS ts, metric, sum(value)::double precision AS value
       FROM (
         SELECT created_at AS occurred_at, 'items_created' AS metric, 1::double precision AS value
           FROM ck_content_items WHERE site_id = $1
         UNION ALL SELECT r.created_at, 'revisions_created', 1
           FROM ck_content_revisions r JOIN ck_content_items i ON i.id = r.item_id WHERE i.site_id = $1
         UNION ALL SELECT r.published_at, 'revisions_published', 1
           FROM ck_content_revisions r JOIN ck_content_items i ON i.id = r.item_id
          WHERE i.site_id = $1 AND r.published_at IS NOT NULL
         UNION ALL SELECT created_at, 'assets_created', 1 FROM ck_assets WHERE site_id = $1
         UNION ALL SELECT created_at, 'asset_bytes', byte_size::double precision FROM ck_assets WHERE site_id = $1
       ) events
      WHERE occurred_at >= $2 AND occurred_at < $3
      GROUP BY 1, metric ORDER BY 1, metric`,
    siteId,
    window,
  )
  return response(window, rows, CONTENT_METRICS)
}

const READER_METRICS = ['auth_success', 'auth_failed', 'auth_rate_limited', 'sessions_created']
export async function getReaderStats(db, siteId, window) {
  const rows = await metricQuery(
    db,
    `SELECT date_trunc($4, occurred_at) AS ts, metric, count(*)::double precision AS value
       FROM (
         SELECT created_at AS occurred_at, 'auth_' || outcome AS metric
           FROM ck_reader_auth_events WHERE site_id = $1
         UNION ALL SELECT created_at, 'sessions_created' FROM ck_reader_sessions WHERE site_id = $1
       ) events
      WHERE occurred_at >= $2 AND occurred_at < $3
      GROUP BY 1, metric ORDER BY 1, metric`,
    siteId,
    window,
  )
  return response(window, rows, READER_METRICS)
}

const WEBHOOK_METRICS = ['events_created', 'deliveries_created', 'delivered', 'failed', 'pending']
export async function getWebhookStats(db, siteId, window) {
  const rows = await metricQuery(
    db,
    `SELECT date_trunc($4, occurred_at) AS ts, metric, count(*)::double precision AS value
       FROM (
         SELECT created_at AS occurred_at, 'events_created' AS metric FROM ck_outbox_events WHERE site_id = $1
         UNION ALL SELECT created_at, 'deliveries_created' FROM ck_webhook_deliveries WHERE site_id = $1
         UNION ALL SELECT coalesce(delivered_at, created_at), status FROM ck_webhook_deliveries WHERE site_id = $1
       ) events
      WHERE occurred_at >= $2 AND occurred_at < $3
      GROUP BY 1, metric ORDER BY 1, metric`,
    siteId,
    window,
  )
  return response(window, rows, WEBHOOK_METRICS)
}

const AUDIO_METRICS = [
  'jobs_created',
  'pending',
  'processing',
  'done',
  'failed',
  'skipped',
  'characters',
  'duration_seconds',
]
export async function getAudioStats(db, siteId, window) {
  const rows = await metricQuery(
    db,
    `SELECT date_trunc($4, occurred_at) AS ts, metric, sum(value)::double precision AS value
       FROM (
         SELECT created_at AS occurred_at, 'jobs_created' AS metric, 1::double precision AS value
           FROM ck_audio_jobs WHERE site_id = $1
         UNION ALL SELECT CASE WHEN status IN ('done','failed','skipped') THEN updated_at ELSE created_at END,
           status, 1 FROM ck_audio_jobs WHERE site_id = $1
         UNION ALL SELECT updated_at, 'characters', coalesce(chars, 0)::double precision
           FROM ck_audio_jobs WHERE site_id = $1 AND status = 'done'
         UNION ALL SELECT updated_at, 'duration_seconds', coalesce(duration_secs, 0)::double precision
           FROM ck_audio_jobs WHERE site_id = $1 AND status = 'done'
       ) events
      WHERE occurred_at >= $2 AND occurred_at < $3
      GROUP BY 1, metric ORDER BY 1, metric`,
    siteId,
    window,
  )
  return response(window, rows, AUDIO_METRICS)
}

const ENGAGEMENT_METRICS = [
  'comments_created',
  'comments_approved',
  'comments_rejected',
  'contacts_created',
  'contacts_read',
  'contacts_closed',
  'feedback_up',
  'feedback_down',
]
export async function getEngagementStats(db, siteId, window) {
  const rows = await metricQuery(
    db,
    `SELECT date_trunc($4, occurred_at) AS ts, metric, count(*)::double precision AS value
       FROM (
         SELECT created_at AS occurred_at, 'comments_created' AS metric FROM ck_comments WHERE site_id = $1
         UNION ALL SELECT moderated_at, 'comments_' || status FROM ck_comments
           WHERE site_id = $1 AND status IN ('approved','rejected') AND moderated_at IS NOT NULL
         UNION ALL SELECT created_at, 'contacts_created' FROM ck_contact_submissions WHERE site_id = $1
         UNION ALL SELECT created_at, 'contacts_' || status FROM ck_contact_submissions
           WHERE site_id = $1 AND status IN ('read','closed')
         UNION ALL SELECT created_at, 'feedback_' || vote FROM ck_post_feedback WHERE site_id = $1
       ) events
      WHERE occurred_at >= $2 AND occurred_at < $3
      GROUP BY 1, metric ORDER BY 1, metric`,
    siteId,
    window,
  )
  return response(window, rows, ENGAGEMENT_METRICS)
}
