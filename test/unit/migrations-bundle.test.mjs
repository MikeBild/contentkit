import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listEmbeddedMigrations } from '../../src/db/migrate.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const migrationsDir = join(root, 'src', 'db', 'migrations')

test('embedded migration count matches the on-disk journal', async () => {
  const journal = JSON.parse(await readFile(join(migrationsDir, 'meta', '_journal.json'), 'utf8'))
  assert.equal(listEmbeddedMigrations().length, journal.entries.length)
})

test('every embedded SQL body has the on-disk SHA-256', async () => {
  for (const migration of listEmbeddedMigrations()) {
    const raw = await readFile(join(migrationsDir, `${migration.tag}.sql`), 'utf8')
    assert.equal(migration.hash, createHash('sha256').update(raw).digest('hex'))
    assert.ok(migration.statements.length >= 1)
  }
})

test('embedded migrations have monotonic indexes and unique stable tags', () => {
  const migrations = listEmbeddedMigrations()
  assert.equal(new Set(migrations.map((migration) => migration.tag)).size, migrations.length)
  for (let index = 1; index < migrations.length; index++) {
    assert.ok(migrations[index].idx > migrations[index - 1].idx)
  }
})
