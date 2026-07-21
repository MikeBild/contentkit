import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { runMigrations } from '../../src/db/migrate.mjs'
import { createPostgres } from '../../src/postgres.mjs'
import {
  getAudioStats,
  getContentStats,
  getDeckStats,
  getEngagementStats,
  getMcpStats,
  getReaderStats,
  getReleaseStats,
  getWebhookStats,
  resolveStatsWindow,
  resolveUsageStatsWindow,
} from '../../src/stats.mjs'

const databaseUrl = process.env.CONTENTKIT_TEST_DATABASE_URL
const logger = { info() {}, warn() {}, error() {} }

test(
  'all product stats execute against real PostgreSQL and stay site-scoped',
  { skip: databaseUrl ? false : 'CONTENTKIT_TEST_DATABASE_URL is not set', timeout: 30000 },
  async () => {
    await runMigrations({ databaseUrl }, logger)
    const pool = new pg.Pool({ connectionString: databaseUrl })
    const db = createPostgres({ databaseUrl }, { pool }).db
    const suffix = randomUUID().slice(0, 8)
    let siteId
    try {
      siteId = (
        await pool.query(
          'INSERT INTO ck_sites (slug, name, base_url, default_locale) VALUES ($1,$2,$3,$4) RETURNING id',
          [`stats-${suffix}`, 'Stats', `https://stats-${suffix}.test`, 'en'],
        )
      ).rows[0].id
      const itemId = (
        await pool.query(
          "INSERT INTO ck_content_items (site_id,kind,locale,translation_key) VALUES ($1,'post','en',$2) RETURNING id",
          [siteId, `post-${suffix}`],
        )
      ).rows[0].id
      const revisionId = (
        await pool.query(
          "INSERT INTO ck_content_revisions (item_id,status,markdown,source_sha256,slug,title,published_at) VALUES ($1,'published','body',$2,$3,'Post',now()) RETURNING id",
          [itemId, `hash-${suffix}`, `post-${suffix}`],
        )
      ).rows[0].id
      await pool.query('UPDATE ck_content_items SET published_revision_id=$1 WHERE id=$2', [revisionId, itemId])
      await pool.query(
        "INSERT INTO ck_assets (site_id,sha256,filename,storage_path,content_type,byte_size) VALUES ($1,$2,'a.png',$3,'image/png',123)",
        [siteId, `asset-${suffix}`, `sites/${siteId}/assets/${suffix}`],
      )
      const releaseId = (
        await pool.query(
          "INSERT INTO ck_releases (site_id,kind,status,file_count,completed_at,activated_at,created_at) VALUES ($1,'release','active',2,now(),now(),now()-interval '4 seconds') RETURNING id",
          [siteId],
        )
      ).rows[0].id
      await pool.query(
        "INSERT INTO ck_release_entries (release_id,path,storage_path,content_type,byte_size,sha256) VALUES ($1,'index.html',$2,'text/html',321,$3)",
        [releaseId, `sites/${siteId}/releases/${releaseId}/index.html`, `release-${suffix}`],
      )
      const userId = (
        await pool.query(
          "INSERT INTO ck_access_users (site_id,username,password_hash) VALUES ($1,$2,'hash') RETURNING id",
          [siteId, `reader-${suffix}`],
        )
      ).rows[0].id
      await pool.query("INSERT INTO ck_reader_auth_events (site_id,outcome) VALUES ($1,'success'),($1,'failed')", [
        siteId,
      ])
      await pool.query(
        "INSERT INTO ck_deck_build_events (site_id,mode,result,execution,cache_result,slide_count,svg_count,png_count,output_bytes,duration_ms,diagnostic_count) VALUES ($1,'compile','success','async','miss',8,4,4,2048,250,1)",
        [siteId],
      )
      await pool.query(
        "INSERT INTO ck_deck_build_events (site_id,mode,result,execution,cache_result,slide_count,svg_count,png_count,output_bytes,duration_ms,diagnostic_count) VALUES ($1,'compile','success','mcp','hit',2,1,1,512,50,0)",
        [siteId],
      )
      await pool.query(
        "INSERT INTO ck_reader_sessions (site_id,user_id,token_hash,expires_at,absolute_expires_at) VALUES ($1,$2,$3,now()+interval '1 hour',now()+interval '1 day')",
        [siteId, userId, `token-${suffix}`],
      )
      const eventId = randomUUID()
      await pool.query(
        "INSERT INTO ck_outbox_events (id,site_id,type,resource_kind,resource_id,status) VALUES ($1,$2,'contentkit.test','content',$3,'delivered')",
        [eventId, siteId, itemId],
      )
      await pool.query(
        "INSERT INTO ck_webhook_deliveries (site_id,event_id,type,status,delivered_at) VALUES ($1,$2,'contentkit.test','delivered',now())",
        [siteId, eventId],
      )
      await pool.query(
        "INSERT INTO ck_audio_jobs (site_id,item_id,revision_id,speech_sha256,status,chars,duration_secs) VALUES ($1,$2,$3,$4,'done',500,30)",
        [siteId, itemId, revisionId, `speech-${suffix}`],
      )
      await pool.query(
        "INSERT INTO ck_comments (site_id,content_item_id,author_name,body,status,moderated_at) VALUES ($1,$2,'A','B','approved',now())",
        [siteId, itemId],
      )
      await pool.query(
        "INSERT INTO ck_contact_submissions (site_id,name,email,body,status) VALUES ($1,'A','a@example.test','B','read')",
        [siteId],
      )
      await pool.query("INSERT INTO ck_post_feedback (site_id,content_item_id,vote) VALUES ($1,$2,'up')", [
        siteId,
        itemId,
      ])
      await pool.query(
        "INSERT INTO ck_usage_events (site_id,surface,operation,outcome,request_source,tool_name,response_mode,result_count,active_sessions,duration_ms) VALUES ($1,'mcp','tool.call','success','mcp','contentkit_read','json',2,1,20)",
        [siteId],
      )

      const window = resolveStatsWindow({
        bucket: 'hour',
        from: new Date(Date.now() - 3600_000).toISOString(),
        to: new Date(Date.now() + 3600_000).toISOString(),
      })
      const [releases, content, decks, readers, webhooks, audio, engagement] = await Promise.all([
        getReleaseStats(db, siteId, window),
        getContentStats(db, siteId, window),
        getDeckStats(db, siteId, window),
        getReaderStats(db, siteId, window),
        getWebhookStats(db, siteId, window),
        getAudioStats(db, siteId, window),
        getEngagementStats(db, siteId, window),
      ])
      assert.equal(releases.totals.builds_started, 1)
      assert.equal(releases.totals.bytes, 321)
      assert.equal(releases.totals.duration_seconds_max, 4)
      assert.equal(content.totals.items_created, 1)
      assert.equal(content.totals.asset_bytes, 123)
      assert.equal(decks.totals.compiles, 2)
      assert.equal(decks.totals.async_compiles, 1)
      assert.equal(decks.totals.mcp_compiles, 1)
      assert.equal(decks.totals.cache_hits, 1)
      assert.equal(decks.totals.cache_misses, 1)
      assert.equal(decks.totals.slides, 10)
      assert.equal(decks.totals.svg_components, 5)
      assert.equal(decks.totals.output_bytes, 2560)
      assert.equal(decks.totals.diagnostics, 1)
      assert.equal(decks.totals.duration_ms_avg, 150)
      assert.equal(readers.totals.auth_success, 1)
      assert.equal(readers.totals.auth_failed, 1)
      assert.equal(readers.totals.sessions_created, 1)
      assert.equal(webhooks.totals.events_created, 1)
      assert.equal(webhooks.totals.delivered, 1)
      assert.equal(audio.totals.characters, 500)
      assert.equal(audio.totals.duration_seconds, 30)
      assert.equal(engagement.totals.comments_approved, 1)
      assert.equal(engagement.totals.contacts_read, 1)
      assert.equal(engagement.totals.feedback_up, 1)

      const mcp = await getMcpStats(
        db,
        siteId,
        resolveUsageStatsWindow(
          {
            bucket: 'hour',
            from: new Date(Date.now() - 3600_000).toISOString(),
            to: new Date(Date.now() + 3600_000).toISOString(),
          },
          'mcp',
        ),
        {},
      )
      assert.equal(mcp.totals[0].metrics.calls.value, 1)
      assert.equal(mcp.totals[0].metrics.results.value, 2)
      assert.equal(mcp.totals[0].metrics.active_sessions_max.value, 1)
    } finally {
      if (siteId) await pool.query('DELETE FROM ck_sites WHERE id=$1', [siteId]).catch(() => {})
      await pool.end()
    }
  },
)
