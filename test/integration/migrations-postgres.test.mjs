import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { runMigrations } from '../../src/db/migrate.mjs'
import { EMBEDDED_MIGRATIONS } from '../../src/db/migrations/embedded.mjs'

const databaseUrl = process.env.CONTENTKIT_TEST_DATABASE_URL
const logger = { info() {}, warn() {}, error() {} }

async function waitForDatabase(url) {
  let lastError
  for (let attempt = 0; attempt < 20; attempt++) {
    const client = new pg.Client({ connectionString: url })
    try {
      await client.connect()
      await client.query('SELECT 1')
      await new Promise((resolve) => setTimeout(resolve, 250))
      await client.query('SELECT 1')
      await client.end()
      return
    } catch (error) {
      lastError = error
      await client.end().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

test(
  'real PostgreSQL migrations are idempotent and concurrency-safe',
  {
    skip: databaseUrl ? false : 'CONTENTKIT_TEST_DATABASE_URL is not set',
    timeout: 30000,
  },
  async () => {
    await waitForDatabase(databaseUrl)
    const config = { databaseUrl }
    // Idempotence is a convergence property, not a count. Asserting how many
    // migrations the first run applies only holds on a virgin database, which
    // makes the test pass exactly once per container — so instead: whatever
    // state the database starts in, one run accounts for every embedded
    // migration and leaves none missing, and the next run applies nothing and
    // skips the complete set.
    const first = await runMigrations(config, logger)
    assert.equal(first.total, EMBEDDED_MIGRATIONS.length)
    assert.equal(
      first.applied + first.skipped + first.hash_drift_backfilled,
      EMBEDDED_MIGRATIONS.length,
      'every embedded migration is either applied or already present',
    )
    assert.deepEqual(first.drift.missing_in_db, [], 'no embedded migration is left unapplied')
    const second = await runMigrations(config, logger)
    assert.equal(second.applied, 0)
    assert.equal(second.skipped, EMBEDDED_MIGRATIONS.length)

    // The tag is the journal's identity, so a fixed probe would already be
    // journalled on a re-run and both racers would skip it — the race would
    // silently stop being tested. A fresh probe per run keeps it real.
    const suffix = randomUUID().slice(0, 8)
    const probeTable = `ck_migration_concurrency_probe_${suffix}`
    const synthetic = {
      idx: 9999,
      tag: `9999_concurrency_probe_${suffix}`,
      when: 1,
      hash: `contentkit-concurrency-probe-${suffix}`,
      statements: [`CREATE TABLE public.${probeTable} (id integer PRIMARY KEY)`],
    }
    const reports = await Promise.all([
      runMigrations(config, logger, [synthetic]),
      runMigrations(config, logger, [synthetic]),
    ])
    assert.equal(reports[0].applied + reports[1].applied, 1)

    const pool = new pg.Pool({ connectionString: databaseUrl })
    let siteId
    try {
      const journal = await pool.query(
        'SELECT count(*)::int AS count FROM contentkit.__contentkit_migrations WHERE tag = $1',
        [synthetic.tag],
      )
      assert.equal(journal.rows[0].count, 1)
      siteId = (
        await pool.query(
          "INSERT INTO ck_sites (slug,name,base_url,default_locale) VALUES ($1,'Deck',$2,'en') RETURNING id",
          [`deck-migration-${suffix}`, `https://deck-${suffix}.test`],
        )
      ).rows[0].id
      await pool.query(
        "INSERT INTO ck_content_items (site_id,kind,locale,translation_key) VALUES ($1,'deck','en','deck')",
        [siteId],
      )
      await pool.query(
        "INSERT INTO ck_deck_build_events (site_id,mode,result,execution) VALUES ($1,'compile','success','async')",
        [siteId],
      )
    } finally {
      // Everything this test wrote goes away again: the site cascades to its
      // items and events, and the probe leaves neither table nor journal row.
      if (siteId) await pool.query('DELETE FROM ck_sites WHERE id=$1', [siteId]).catch(() => {})
      await pool.query(`DROP TABLE IF EXISTS public.${probeTable}`).catch(() => {})
      await pool.query('DELETE FROM contentkit.__contentkit_migrations WHERE tag = $1', [synthetic.tag]).catch(() => {})
      await pool.end()
    }
  },
)

test(
  'retire archives scheduled revisions and bumps publish_epoch (0003 behavior)',
  {
    skip: databaseUrl ? false : 'CONTENTKIT_TEST_DATABASE_URL is not set',
    timeout: 30000,
  },
  async () => {
    await waitForDatabase(databaseUrl)
    await runMigrations({ databaseUrl }, logger)
    const pool = new pg.Pool({ connectionString: databaseUrl })
    let site
    try {
      // Minimal fixture: a site, one release, one item with a published + a
      // scheduled revision. The slug is unique per run — ck_sites.slug is
      // unique, so a fixed one would collide with the previous run's leftovers.
      const suffix = randomUUID().slice(0, 8)
      site = (
        await pool.query(
          "insert into ck_sites (slug, name, base_url, default_locale) values ($1,'E',$2,'de') returning id, publish_epoch",
          [`epoch-test-${suffix}`, `https://epoch-${suffix}.test`],
        )
      ).rows[0]
      const rel = (
        await pool.query("insert into ck_releases (site_id, kind, status) values ($1,'release','ready') returning id", [
          site.id,
        ])
      ).rows[0]
      const item = (
        await pool.query(
          "insert into ck_content_items (site_id, kind, locale, translation_key) values ($1,'post','de','t') returning id",
          [site.id],
        )
      ).rows[0]
      const pub = (
        await pool.query(
          "insert into ck_content_revisions (item_id, status, markdown, source_sha256, slug, title) values ($1,'published','a','h1','s','T') returning id",
          [item.id],
        )
      ).rows[0]
      const sched = (
        await pool.query(
          "insert into ck_content_revisions (item_id, status, markdown, source_sha256, slug, title, scheduled_at) values ($1,'scheduled','b','h2','s','T', now()) returning id",
          [item.id],
        )
      ).rows[0]
      await pool.query('update ck_content_items set published_revision_id = $1 where id = $2', [pub.id, item.id])

      await pool.query('select ck_activate_release($1, $2, $3, $4)', [rel.id, [], [item.id], site.publish_epoch])

      const pubStatus = (await pool.query('select status from ck_content_revisions where id = $1', [pub.id])).rows[0]
        .status
      const schedStatus = (await pool.query('select status from ck_content_revisions where id = $1', [sched.id]))
        .rows[0].status
      const itemRow = (await pool.query('select published_revision_id from ck_content_items where id = $1', [item.id]))
        .rows[0]
      const epoch = (await pool.query('select publish_epoch from ck_sites where id = $1', [site.id])).rows[0]
        .publish_epoch

      assert.equal(pubStatus, 'archived', 'published revision archived')
      assert.equal(schedStatus, 'archived', 'scheduled revision cancelled — cannot be resurrected by publish-due')
      assert.equal(itemRow.published_revision_id, null, 'published pointer cleared')
      assert.equal(Number(epoch), Number(site.publish_epoch) + 1, 'publish_epoch bumped')

      // A stale epoch is rejected (optimistic concurrency).
      await assert.rejects(
        pool.query('select ck_activate_release($1, $2, $3, $4)', [rel.id, [], [], site.publish_epoch]),
        /stale snapshot/,
      )
    } finally {
      // The site cascades to its release, item and revisions.
      if (site) await pool.query('DELETE FROM ck_sites WHERE id=$1', [site.id]).catch(() => {})
      await pool.end()
    }
  },
)

test(
  'exact preview registration and derived activation share one concurrency boundary',
  {
    skip: databaseUrl ? false : 'CONTENTKIT_TEST_DATABASE_URL is not set',
    timeout: 30000,
  },
  async () => {
    await waitForDatabase(databaseUrl)
    await runMigrations({ databaseUrl }, logger)
    const pool = new pg.Pool({ connectionString: databaseUrl })
    let site
    try {
      const suffix = randomUUID().slice(0, 8)
      site = (
        await pool.query(
          "insert into ck_sites (slug, name, base_url, default_locale) values ($1,'Review lock',$2,'de') returning id, publish_epoch",
          [`review-lock-${suffix}`, `https://review-lock-${suffix}.test`],
        )
      ).rows[0]

      // A normal authored release is allowed to win. Registration of a preview
      // built against the old epoch must then fail instead of creating an
      // immediately stale invitation.
      const stalePreview = (
        await pool.query(
          "insert into ck_releases (site_id, kind, status, base_publish_epoch) values ($1,'preview','preview',$2) returning id",
          [site.id, site.publish_epoch],
        )
      ).rows[0]
      const authored = (
        await pool.query(
          "insert into ck_releases (site_id, kind, status, reason, base_publish_epoch) values ($1,'release','ready','authored',$2) returning id",
          [site.id, site.publish_epoch],
        )
      ).rows[0]
      await pool.query('select ck_activate_release($1, $2, $3, $4)', [authored.id, [], [], site.publish_epoch])
      await assert.rejects(
        pool.query("select ck_register_preview_access($1,$2,$3,now()+interval '1 hour',$4)", [
          stalePreview.id,
          `stale-${suffix}`,
          `stale-hash-${suffix}`,
          site.publish_epoch,
        ]),
        /stale snapshot/,
      )

      const currentEpoch = Number(
        (await pool.query('select publish_epoch from ck_sites where id=$1', [site.id])).rows[0].publish_epoch,
      )
      const protectedPreview = (
        await pool.query(
          "insert into ck_releases (site_id, kind, status, base_publish_epoch) values ($1,'preview','preview',$2) returning id",
          [site.id, currentEpoch],
        )
      ).rows[0]
      await pool.query("select ck_register_preview_access($1,$2,$3,now()+interval '1 hour',$4)", [
        protectedPreview.id,
        `protected-${suffix}`,
        `protected-hash-${suffix}`,
        currentEpoch,
      ])
      const derived = (
        await pool.query(
          "insert into ck_releases (site_id, kind, status, reason, base_publish_epoch) values ($1,'release','ready','audio auto-rebuild',$2) returning id",
          [site.id, currentEpoch],
        )
      ).rows[0]

      await assert.rejects(
        pool.query('select ck_activate_release($1, $2, $3, $4)', [derived.id, [], [], currentEpoch]),
        /derived release deferred: exact preview review is active/,
      )
      const unchangedEpoch = Number(
        (await pool.query('select publish_epoch from ck_sites where id=$1', [site.id])).rows[0].publish_epoch,
      )
      assert.equal(unchangedEpoch, currentEpoch, 'a deferred derived release must not move the site pointer')

      await pool.query('update ck_preview_access set revoked_at=now() where release_id=$1', [protectedPreview.id])
      await pool.query('select ck_activate_release($1, $2, $3, $4)', [derived.id, [], [], currentEpoch])
      const advancedEpoch = Number(
        (await pool.query('select publish_epoch from ck_sites where id=$1', [site.id])).rows[0].publish_epoch,
      )
      assert.equal(advancedEpoch, currentEpoch + 1, 'the derived release proceeds after review closure')
    } finally {
      if (site) await pool.query('DELETE FROM ck_sites WHERE id=$1', [site.id]).catch(() => {})
      await pool.end()
    }
  },
)
