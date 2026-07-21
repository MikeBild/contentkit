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

test('usage telemetry is opt-in, keeps 90 days and requires its own HMAC secret', () => {
  const names = [
    'CONTENTKIT_USAGE_TELEMETRY_ENABLED',
    'CONTENTKIT_USAGE_HMAC_SECRET',
    'CONTENTKIT_USAGE_RETENTION_DAYS',
  ]
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    delete process.env.CONTENTKIT_USAGE_TELEMETRY_ENABLED
    delete process.env.CONTENTKIT_USAGE_HMAC_SECRET
    delete process.env.CONTENTKIT_USAGE_RETENTION_DAYS
    assert.equal(loadConfig().usageTelemetryEnabled, false)
    assert.equal(loadConfig().usageRetentionDays, 90)
    process.env.CONTENTKIT_USAGE_TELEMETRY_ENABLED = 'true'
    assert.throws(() => loadConfig(), /USAGE_HMAC_SECRET is required/)
    process.env.CONTENTKIT_USAGE_HMAC_SECRET = 'product-local-secret'
    assert.equal(loadConfig().usageTelemetryEnabled, true)
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('MCP defaults are bounded and OIDC login requires configured HTTPS providers', () => {
  const names = [
    'CONTENTKIT_MCP_ENABLED',
    'CONTENTKIT_MCP_SESSION_TTL_MS',
    'CONTENTKIT_MCP_MAX_SESSIONS',
    'CONTENTKIT_OAUTH_LOGIN_PROVIDER',
    'CONTENTKIT_OAUTH_OIDC_PROVIDERS',
  ]
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    delete process.env.CONTENTKIT_MCP_ENABLED
    delete process.env.CONTENTKIT_MCP_SESSION_TTL_MS
    delete process.env.CONTENTKIT_MCP_MAX_SESSIONS
    delete process.env.CONTENTKIT_OAUTH_LOGIN_PROVIDER
    delete process.env.CONTENTKIT_OAUTH_OIDC_PROVIDERS
    const defaults = loadConfig()
    assert.equal(defaults.mcpEnabled, true)
    assert.equal(defaults.mcpSessionTtlMs, 30 * 60 * 1000)
    assert.equal(defaults.mcpMaxSessions, 1000)
    process.env.CONTENTKIT_OAUTH_LOGIN_PROVIDER = 'oidc'
    assert.throws(() => loadConfig(), /requires CONTENTKIT_OAUTH_OIDC_PROVIDERS/)
    process.env.CONTENTKIT_OAUTH_OIDC_PROVIDERS = JSON.stringify([
      {
        id: 'company',
        label: 'Company',
        issuer: 'https://id.example.com',
        client_id: 'client',
        client_secret: 'secret',
        scopes: 'openid email profile',
      },
    ])
    assert.equal(loadConfig().oauthOidcProviders[0].id, 'company')
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('production fails closed when secrets are absent', () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const names = [
    'CONTENTKIT_BOOTSTRAP_API_KEY',
    'CONTENTKIT_KEY_PEPPER',
    'CONTENTKIT_PREVIEW_SECRET',
    'CONTENTKIT_SESSION_SECRET',
    'CONTENTKIT_OAUTH_SECRET',
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
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

test('production supports managed webhooks without a legacy global endpoint', () => {
  const script = `
    import { loadConfig } from './src/config.mjs'
    const config = loadConfig()
    process.stdout.write(JSON.stringify({ webhookUrl: config.webhookUrl, webhookSecret: config.webhookSecret }))
  `
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    CONTENTKIT_BOOTSTRAP_API_KEY: 'bootstrap',
    CONTENTKIT_KEY_PEPPER: 'pepper',
    CONTENTKIT_PREVIEW_SECRET: 'preview',
    CONTENTKIT_SESSION_SECRET: 'session',
    CONTENTKIT_OAUTH_SECRET: 'oauth',
    DATABASE_URL: 'postgresql://contentkit:secret@127.0.0.1/contentkit',
    SUPABASE_URL: 'https://storage.example.com',
    SUPABASE_SERVICE_ROLE_KEY: 'storage-role',
    CONTENTKIT_TURNSTILE_SECRET: 'turnstile',
  }
  delete env.CONTENTKIT_WEBHOOK_URL
  delete env.CONTENTKIT_WEBHOOK_SECRET
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../..', import.meta.url),
    env,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { webhookUrl: '', webhookSecret: '' })
})

test('legacy global webhook URL and secret must be configured as a pair', () => {
  const savedUrl = process.env.CONTENTKIT_WEBHOOK_URL
  const savedSecret = process.env.CONTENTKIT_WEBHOOK_SECRET
  try {
    process.env.CONTENTKIT_WEBHOOK_URL = 'https://hooks.example.com/contentkit'
    process.env.CONTENTKIT_WEBHOOK_SECRET = ''
    assert.throws(() => loadConfig(), /must be configured together/)
    process.env.CONTENTKIT_WEBHOOK_URL = ''
    process.env.CONTENTKIT_WEBHOOK_SECRET = 'whsec_test'
    assert.throws(() => loadConfig(), /must be configured together/)
  } finally {
    if (savedUrl === undefined) delete process.env.CONTENTKIT_WEBHOOK_URL
    else process.env.CONTENTKIT_WEBHOOK_URL = savedUrl
    if (savedSecret === undefined) delete process.env.CONTENTKIT_WEBHOOK_SECRET
    else process.env.CONTENTKIT_WEBHOOK_SECRET = savedSecret
  }
})
