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
