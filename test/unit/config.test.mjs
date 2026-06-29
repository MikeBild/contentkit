import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { loadConfig } from '../../src/config.mjs'

test('development starts with complete committed defaults and no .env', () => {
  const script = `
    import { loadConfig } from './src/config.mjs'
    const config = loadConfig()
    process.stdout.write(JSON.stringify({
      databaseUrl: config.databaseUrl,
      storageUrl: config.storageUrl,
      bootstrapApiKey: config.bootstrapApiKey,
    }))
  `
  const env = { ...process.env, NODE_ENV: 'development' }
  for (const name of [
    'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'CONTENTKIT_BOOTSTRAP_API_KEY',
  ]) delete env[name]
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../..', import.meta.url),
    env,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), {
    databaseUrl: 'postgresql://postgres:contentkit-local@127.0.0.1:55432/contentkit',
    storageUrl: 'http://127.0.0.1:55433',
    bootstrapApiKey: 'contentkit-local-admin',
  })
})

test('production fails closed when secrets are absent', () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const names = [
    'CONTENTKIT_BOOTSTRAP_API_KEY', 'CONTENTKIT_KEY_PEPPER', 'CONTENTKIT_PREVIEW_SECRET',
    'DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CONTENTKIT_SUBKIT_WEBHOOK_URL',
    'CONTENTKIT_SUBKIT_WEBHOOK_SECRET', 'CONTENTKIT_TURNSTILE_SECRET',
  ]
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  for (const name of names) delete process.env[name]
  try {
    assert.throws(() => loadConfig(), /missing production configuration/)
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})
