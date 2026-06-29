import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { runMigrations } from '../../src/db/migrate.mjs'

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

test('real PostgreSQL migrations are idempotent and concurrency-safe', {
  skip: databaseUrl ? false : 'CONTENTKIT_TEST_DATABASE_URL is not set',
  timeout: 30000,
}, async () => {
  await waitForDatabase(databaseUrl)
  const config = { databaseUrl }
  const first = await runMigrations(config, logger)
  const second = await runMigrations(config, logger)
  assert.equal(first.applied, 1)
  assert.equal(second.applied, 0)
  assert.equal(second.skipped, 1)

  const synthetic = {
    idx: 9999,
    tag: '9999_concurrency_probe',
    when: 1,
    hash: 'contentkit-concurrency-probe-v1',
    statements: ['CREATE TABLE public.ck_migration_concurrency_probe (id integer PRIMARY KEY)'],
  }
  const reports = await Promise.all([
    runMigrations(config, logger, [synthetic]),
    runMigrations(config, logger, [synthetic]),
  ])
  assert.equal(reports[0].applied + reports[1].applied, 1)

  const pool = new pg.Pool({ connectionString: databaseUrl })
  try {
    const journal = await pool.query(
      'SELECT count(*)::int AS count FROM contentkit.__contentkit_migrations WHERE tag = $1',
      [synthetic.tag],
    )
    assert.equal(journal.rows[0].count, 1)
  } finally {
    await pool.end()
  }
})
