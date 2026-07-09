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
  for (const name of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CONTENTKIT_BOOTSTRAP_API_KEY'])
    delete env[name]
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

test('the audio rebuild debounce defaults to 60s and rejects values outside 1s–1h', () => {
  const saved = process.env.CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS
  try {
    delete process.env.CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS
    assert.equal(loadConfig().audioRebuildDebounceMs, 60000)
    process.env.CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS = '500'
    assert.throws(() => loadConfig(), /CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS/)
    process.env.CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS = '3600001'
    assert.throws(() => loadConfig(), /CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS/)
  } finally {
    if (saved === undefined) delete process.env.CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS
    else process.env.CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS = saved
  }
})

test('production fails closed when secrets are absent', () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const names = [
    'CONTENTKIT_BOOTSTRAP_API_KEY',
    'CONTENTKIT_KEY_PEPPER',
    'CONTENTKIT_PREVIEW_SECRET',
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CONTENTKIT_WEBHOOK_URL',
    'CONTENTKIT_WEBHOOK_SECRET',
    'CONTENTKIT_TURNSTILE_SECRET',
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
