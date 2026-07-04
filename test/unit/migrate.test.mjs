import test from 'node:test'
import assert from 'node:assert/strict'
import { MIGRATION_LOCK_KEY, applyMigrations, runMigrationsWithPool } from '../../src/db/migrate.mjs'

class FakeClient {
  rows = []
  statements = []
  transaction = null
  failStatement = null
  released = false

  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, ' ').trim()
    if (text === 'BEGIN') {
      this.transaction = []
      return { rows: [] }
    }
    if (text === 'COMMIT') {
      for (const operation of this.transaction || []) operation()
      this.transaction = null
      return { rows: [] }
    }
    if (text === 'ROLLBACK') {
      this.transaction = null
      return { rows: [] }
    }
    if (text.startsWith('SELECT pg_advisory_')) {
      this.statements.push({ text, params })
      return { rows: [] }
    }
    if (text.startsWith('SELECT hash, tag FROM')) return { rows: this.rows.map((row) => ({ ...row })) }
    if (text.startsWith('SELECT id, hash, tag, created_at FROM')) {
      return { rows: this.rows.map((row, index) => ({ id: index + 1, created_at: 1, ...row })) }
    }
    if (text.startsWith('UPDATE "contentkit"."__contentkit_migrations" SET hash')) {
      const operation = () => {
        const row = this.rows.find((value) => value.tag === params[1])
        if (row) row.hash = params[0]
      }
      return this.run(operation)
    }
    if (text.startsWith('UPDATE "contentkit"."__contentkit_migrations" SET tag')) {
      const operation = () => {
        const row = this.rows.find((value) => value.hash === params[1] && !value.tag)
        if (row) row.tag = params[0]
      }
      return this.run(operation)
    }
    if (text.startsWith('INSERT INTO "contentkit"."__contentkit_migrations"')) {
      return this.run(() => this.rows.push({ hash: params[0], tag: params[2] }))
    }
    if (
      text.includes('__contentkit_migrations') ||
      text.startsWith('CREATE EXTENSION') ||
      text.startsWith('CREATE SCHEMA')
    ) {
      return { rows: [] }
    }
    if (this.failStatement === text) throw new Error('synthetic migration failure')
    this.statements.push(text)
    return { rows: [] }
  }

  release() {
    this.released = true
  }

  run(operation) {
    if (this.transaction) this.transaction.push(operation)
    else operation()
    return { rows: [] }
  }
}

const migration = (overrides = {}) => ({
  idx: 0,
  tag: '0000_test',
  when: 1,
  hash: 'hash-v1',
  statements: ['CREATE TABLE migration_probe (id integer)'],
  ...overrides,
})
const logger = { info() {}, warn() {} }

test('first run applies and second run skips by stable tag', async () => {
  const client = new FakeClient()
  const first = await applyMigrations(client, [migration()], logger)
  const second = await applyMigrations(client, [migration()], logger)
  assert.equal(first.applied, 1)
  assert.equal(second.applied, 0)
  assert.equal(second.skipped, 1)
  assert.equal(client.statements.length, 1)
  assert.equal(client.rows.length, 1)
})

test('tag match with changed SQL hash backfills without re-running', async () => {
  const client = new FakeClient()
  await applyMigrations(client, [migration()], logger)
  const report = await applyMigrations(client, [migration({ hash: 'hash-v2' })], logger)
  assert.equal(report.hash_drift_backfilled, 1)
  assert.equal(client.rows[0].hash, 'hash-v2')
  assert.equal(client.statements.length, 1)
})

test('failed migration rolls back its journal row and remains retryable', async () => {
  const client = new FakeClient()
  client.failStatement = 'CREATE TABLE migration_probe (id integer)'
  await assert.rejects(() => applyMigrations(client, [migration()], logger), /synthetic migration failure/)
  assert.equal(client.rows.length, 0)
  client.failStatement = null
  const report = await applyMigrations(client, [migration()], logger)
  assert.equal(report.applied, 1)
})

test('runner holds and releases the stable session advisory lock', async () => {
  const client = new FakeClient()
  const pool = {
    async connect() {
      return client
    },
  }
  const report = await runMigrationsWithPool(pool, logger, [migration()])
  const lockQueries = client.statements.filter((statement) => typeof statement === 'object')
  assert.deepEqual(lockQueries, [
    { text: 'SELECT pg_advisory_lock($1)', params: [MIGRATION_LOCK_KEY] },
    { text: 'SELECT pg_advisory_unlock($1)', params: [MIGRATION_LOCK_KEY] },
  ])
  assert.equal(report.applied, 1)
  assert.equal(client.released, true)
})

test('two concurrent runners serialize and apply a pending migration once', async () => {
  const sharedRows = []
  const clients = []
  let locked = false
  const waiters = []
  const pool = {
    async connect() {
      const client = new FakeClient()
      client.rows = sharedRows
      const query = client.query.bind(client)
      client.query = async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ').trim()
        if (text === 'SELECT pg_advisory_lock($1)') {
          if (locked) await new Promise((resolve) => waiters.push(resolve))
          locked = true
          client.statements.push({ text, params })
          return { rows: [] }
        }
        if (text === 'SELECT pg_advisory_unlock($1)') {
          client.statements.push({ text, params })
          locked = false
          waiters.shift()?.()
          return { rows: [] }
        }
        return query(sql, params)
      }
      clients.push(client)
      return client
    },
  }

  const reports = await Promise.all([
    runMigrationsWithPool(pool, logger, [migration()]),
    runMigrationsWithPool(pool, logger, [migration()]),
  ])

  assert.equal(reports[0].applied + reports[1].applied, 1)
  assert.equal(reports[0].skipped + reports[1].skipped, 1)
  assert.equal(sharedRows.length, 1)
  assert.equal(
    clients.flatMap((client) => client.statements).filter((value) => value === migration().statements[0]).length,
    1,
  )
})
