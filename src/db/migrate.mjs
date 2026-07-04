import pg from 'pg'
import { EMBEDDED_MIGRATIONS } from './migrations/embedded.mjs'

const { Pool } = pg

// Stable, Contentkit-specific session lock. Every binary uses the same key, so
// two systemd instances can never both decide that a migration is pending.
export const MIGRATION_LOCK_KEY = 204_2026_629

async function ensureMigrationsTable(client) {
  await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
  await client.query('CREATE SCHEMA IF NOT EXISTS "contentkit"')
  await client.query(`
    CREATE TABLE IF NOT EXISTS "contentkit"."__contentkit_migrations" (
      id bigserial PRIMARY KEY,
      hash text NOT NULL,
      tag text UNIQUE,
      created_at bigint
    )
  `)
  await client.query('ALTER TABLE "contentkit"."__contentkit_migrations" ADD COLUMN IF NOT EXISTS tag text')
  await client.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS contentkit_migrations_tag_idx ON "contentkit"."__contentkit_migrations" (tag) WHERE tag IS NOT NULL',
  )
}

async function appliedState(client) {
  const result = await client.query('SELECT hash, tag FROM "contentkit"."__contentkit_migrations"')
  return {
    hashes: new Set(result.rows.map((row) => row.hash)),
    tags: new Set(result.rows.map((row) => row.tag).filter(Boolean)),
  }
}

/**
 * Applies an embedded migration set on a connection that already owns the
 * advisory lock. A tag is the authoritative identity; hash drift updates the
 * journal without re-running SQL, so comment-only edits never re-execute DDL.
 */
export async function applyMigrations(client, migrations = EMBEDDED_MIGRATIONS, logger = console) {
  await ensureMigrationsTable(client)
  const applied = await appliedState(client)
  const report = { applied: 0, skipped: 0, hash_drift_backfilled: 0, total: migrations.length }

  for (const migration of migrations) {
    if (applied.tags.has(migration.tag)) {
      if (applied.hashes.has(migration.hash)) {
        report.skipped++
      } else {
        await client.query('UPDATE "contentkit"."__contentkit_migrations" SET hash = $1 WHERE tag = $2', [
          migration.hash,
          migration.tag,
        ])
        applied.hashes.add(migration.hash)
        report.hash_drift_backfilled++
        logger.warn?.('migration hash drift backfilled', {
          tag: migration.tag,
          hash: migration.hash,
        })
      }
      continue
    }

    // Adopt journal rows created before tag tracking when the SQL hash agrees.
    if (applied.hashes.has(migration.hash)) {
      await client.query('UPDATE "contentkit"."__contentkit_migrations" SET tag = $1 WHERE hash = $2 AND tag IS NULL', [
        migration.tag,
        migration.hash,
      ])
      applied.tags.add(migration.tag)
      report.skipped++
      continue
    }

    const started = Date.now()
    await client.query('BEGIN')
    try {
      for (const statement of migration.statements) await client.query(statement)
      await client.query(
        'INSERT INTO "contentkit"."__contentkit_migrations" (hash, created_at, tag) VALUES ($1, $2, $3)',
        [migration.hash, migration.when, migration.tag],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    }
    applied.hashes.add(migration.hash)
    applied.tags.add(migration.tag)
    report.applied++
    logger.info?.('migration applied', {
      tag: migration.tag,
      statements: migration.statements.length,
      ms: Date.now() - started,
    })
  }
  return report
}

export async function detectMigrationDrift(client, migrations = EMBEDDED_MIGRATIONS) {
  await ensureMigrationsTable(client)
  const result = await client.query(
    'SELECT id, hash, tag, created_at FROM "contentkit"."__contentkit_migrations" ORDER BY id',
  )
  const embeddedHashes = new Set(migrations.map((migration) => migration.hash))
  const dbHashes = new Set(result.rows.map((row) => row.hash))
  return {
    unknown_in_db: result.rows.filter((row) => !embeddedHashes.has(row.hash)),
    missing_in_db: migrations
      .filter((migration) => !dbHashes.has(migration.hash))
      .map(({ idx, tag, hash }) => ({ idx, tag, hash })),
  }
}

export async function runMigrationsWithPool(pool, logger = console, migrations = EMBEDDED_MIGRATIONS) {
  const lockClient = await pool.connect()
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    logger.info?.('applying embedded migrations', { total: migrations.length })
    const report = await applyMigrations(lockClient, migrations, logger)
    const drift = await detectMigrationDrift(lockClient, migrations)
    if (drift.unknown_in_db.length) {
      logger.warn?.('migration lineage drift detected', {
        unknown: drift.unknown_in_db.map((row) => ({ tag: row.tag, hash: row.hash })),
      })
    }
    logger.info?.('embedded migrations complete', report)
    return { ...report, drift }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {})
    lockClient.release()
  }
}

export async function runMigrations(config, logger = console, migrations = EMBEDDED_MIGRATIONS) {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required for embedded migrations')
  const pool = new Pool({ connectionString: config.databaseUrl, max: 4 })
  pool.on('error', (error) => logger.error?.('migration pool error', { error: error.message }))
  try {
    return await runMigrationsWithPool(pool, logger, migrations)
  } finally {
    await pool.end()
  }
}

export function listEmbeddedMigrations() {
  return EMBEDDED_MIGRATIONS
}
