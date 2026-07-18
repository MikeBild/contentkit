import test from 'node:test'
import assert from 'node:assert/strict'
import { createPostgres } from '../../src/postgres.mjs'

class FakePool {
  calls = []
  rows = []

  async query(text, values) {
    this.calls.push({ text, values })
    return { rows: this.rows }
  }
}

test('direct PostgreSQL adapter parameterizes filters, ordering and limits', async () => {
  const pool = new FakePool()
  const postgres = createPostgres({ databaseUrl: 'postgresql://unused' }, { pool })
  await postgres.db.select('ck_content_revisions', {
    status: 'eq.scheduled',
    scheduled_at: 'lte.2026-06-29T10:00:00.000Z',
    order: 'created_at.asc',
    limit: '10',
  })
  assert.deepEqual(pool.calls[0], {
    text: 'SELECT * FROM "public"."ck_content_revisions" WHERE "status" = $1 AND "scheduled_at" <= $2 ORDER BY "created_at" ASC LIMIT $3',
    values: ['scheduled', '2026-06-29T10:00:00.000Z', 10],
  })
})

test('direct PostgreSQL adapter builds parameterized bulk inserts', async () => {
  const pool = new FakePool()
  const postgres = createPostgres({ databaseUrl: 'postgresql://unused' }, { pool })
  await postgres.db.insert('ck_site_locales', [
    { site_id: 'site', locale: 'de' },
    { site_id: 'site', locale: 'en' },
  ])
  assert.equal(
    pool.calls[0].text,
    'INSERT INTO "public"."ck_site_locales" ("site_id", "locale") VALUES ($1, $2), ($3, $4) RETURNING *',
  )
  assert.deepEqual(pool.calls[0].values, ['site', 'de', 'site', 'en'])
})

test('direct PostgreSQL adapter rejects unknown tables and unfiltered writes', async () => {
  const pool = new FakePool()
  const postgres = createPostgres({ databaseUrl: 'postgresql://unused' }, { pool })
  await assert.rejects(() => postgres.db.select('users'), /unknown Contentkit table/)
  await assert.rejects(() => postgres.db.update('ck_sites', {}, { name: 'unsafe' }), /unfiltered/)
  await assert.rejects(() => postgres.db.remove('ck_sites', {}), /unfiltered/)
})

test('raw aggregate queries preserve parameter values and reject unknown ContentKit tables', async () => {
  const pool = new FakePool()
  pool.rows = [{ total: 2 }]
  const postgres = createPostgres({ databaseUrl: 'postgresql://unused' }, { pool })
  assert.deepEqual(
    await postgres.db.query('SELECT count(*)::int AS total FROM ck_reader_auth_events WHERE site_id = $1', ['site-1']),
    [{ total: 2 }],
  )
  assert.deepEqual(pool.calls[0].values, ['site-1'])
  await assert.rejects(() => postgres.db.query('SELECT * FROM ck_unregistered_reporting'), /unknown Contentkit table/)
})

test('rpc runs only whitelisted functions and returns their declared shape', async () => {
  const pool = new FakePool()
  const postgres = createPostgres({ databaseUrl: 'postgresql://unused' }, { pool })

  // ck_activate_release keeps its fixed statement, defaults and null return.
  assert.equal(await postgres.db.rpc('ck_activate_release', { p_release_id: 'rel-1' }), null)
  assert.deepEqual(pool.calls[0], {
    text: 'SELECT public.ck_activate_release($1, $2, $3, $4)',
    values: ['rel-1', [], [], null],
  })

  // ck_search_published forwards all five parameters and returns the rows.
  pool.rows = [{ item_id: 'item-1', rank: 0.5, headline: '<mark>Hallo</mark>' }]
  const rows = await postgres.db.rpc('ck_search_published', {
    p_site_id: 'site-1',
    p_query: 'hallo',
    p_locale: 'de',
    p_kind: 'post',
    p_limit: 20,
  })
  assert.deepEqual(rows, [{ item_id: 'item-1', rank: 0.5, headline: '<mark>Hallo</mark>' }])
  assert.deepEqual(pool.calls[1], {
    text: 'SELECT * FROM public.ck_search_published($1, $2, $3, $4, $5)',
    values: ['site-1', 'hallo', 'de', 'post', 20],
  })

  // Absent optional filters are passed as SQL nulls, not undefined.
  await postgres.db.rpc('ck_search_published', { p_site_id: 'site-1', p_query: 'hallo', p_limit: 20 })
  assert.deepEqual(pool.calls[2].values, ['site-1', 'hallo', null, null, 20])

  await assert.rejects(() => postgres.db.rpc('pg_sleep'), /unknown Contentkit function: pg_sleep/)
})
