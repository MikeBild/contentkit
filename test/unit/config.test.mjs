import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createAssistant } from '../../src/assistant.mjs'
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

test('upload concurrency and the per-site release cap default sensibly and reject out-of-range values', () => {
  const names = ['CONTENTKIT_UPLOAD_CONCURRENCY', 'CONTENTKIT_RELEASE_MAX_PER_SITE']
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    for (const name of names) delete process.env[name]
    assert.equal(loadConfig().uploadConcurrency, 8)
    assert.equal(loadConfig().releaseMaxPerSite, 24)
    process.env.CONTENTKIT_UPLOAD_CONCURRENCY = '0'
    assert.throws(() => loadConfig(), /CONTENTKIT_UPLOAD_CONCURRENCY/)
    process.env.CONTENTKIT_UPLOAD_CONCURRENCY = '33'
    assert.throws(() => loadConfig(), /CONTENTKIT_UPLOAD_CONCURRENCY/)
    delete process.env.CONTENTKIT_UPLOAD_CONCURRENCY
    process.env.CONTENTKIT_RELEASE_MAX_PER_SITE = '0'
    assert.throws(() => loadConfig(), /CONTENTKIT_RELEASE_MAX_PER_SITE/)
    process.env.CONTENTKIT_RELEASE_MAX_PER_SITE = '501'
    assert.throws(() => loadConfig(), /CONTENTKIT_RELEASE_MAX_PER_SITE/)
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
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

test('MCP defaults are bounded and providers use one canonical protocol list', () => {
  const names = [
    'CONTENTKIT_MCP_ENABLED',
    'CONTENTKIT_MCP_SESSION_TTL_MS',
    'CONTENTKIT_MCP_MAX_SESSIONS',
    'CONTENTKIT_OAUTH_PROVIDERS',
  ]
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    delete process.env.CONTENTKIT_MCP_ENABLED
    delete process.env.CONTENTKIT_MCP_SESSION_TTL_MS
    delete process.env.CONTENTKIT_MCP_MAX_SESSIONS
    delete process.env.CONTENTKIT_OAUTH_PROVIDERS
    const defaults = loadConfig()
    assert.equal(defaults.mcpEnabled, true)
    assert.equal(defaults.mcpSessionTtlMs, 30 * 60 * 1000)
    assert.equal(defaults.mcpMaxSessions, 1000)
    process.env.CONTENTKIT_OAUTH_PROVIDERS = JSON.stringify([
      { protocol: 'api_key', id: 'api-key', label: 'ContentKit API key' },
      {
        protocol: 'oidc',
        id: 'workforce-oidc',
        label: 'Workforce OIDC',
        issuer_url: 'https://id.example.com',
        client_id: 'client',
        client_secret: 'secret',
        scopes: 'openid email profile',
      },
    ])
    const configured = loadConfig()
    assert.deepEqual(
      configured.oauthProviders.map((provider) => provider.protocol),
      ['api_key', 'oidc'],
    )
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('removed provider type records are rejected', () => {
  const saved = process.env.CONTENTKIT_OAUTH_PROVIDERS
  process.env.CONTENTKIT_OAUTH_PROVIDERS = '[{"type":"api_key","id":"api-key","label":"ContentKit API key"}]'
  try {
    assert.throws(() => loadConfig(), /protocol/)
  } finally {
    if (saved === undefined) delete process.env.CONTENTKIT_OAUTH_PROVIDERS
    else process.env.CONTENTKIT_OAUTH_PROVIDERS = saved
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
    'CONTENTKIT_OAUTH_PROVIDERS',
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
    CONTENTKIT_OAUTH_PROVIDERS: '[{"protocol":"api_key","id":"api-key","label":"ContentKit API key"}]',
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

// The assistant is the one feature whose credential is provider-dependent: an
// operator paying for a single key per product must be able to point it at the
// provider they already buy from, without ContentKit growing a second switch.
// The names are the family's, so one operator reads one vocabulary across every
// product; the values stay per-deployment, one environment file each.
const assistantVars = [
  'CONTENTKIT_LLM_PROVIDER',
  'CONTENTKIT_MODEL_ASSISTANT',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
]

// Names no longer honoured. Listed only so the environment can be cleared and
// restored around a test that sets one; nothing in src reads them.
const retiredAssistantVars = [
  'CONTENTKIT_ASSISTANT_PROVIDER',
  'CONTENTKIT_ASSISTANT_MODEL',
  'CONTENTKIT_ANTHROPIC_API_KEY',
  'CONTENTKIT_OPENAI_API_KEY',
  'CONTENTKIT_GOOGLE_API_KEY',
]

function withAssistantEnv(values, run) {
  const managed = [...assistantVars, ...retiredAssistantVars]
  const saved = Object.fromEntries(managed.map((name) => [name, process.env[name]]))
  try {
    for (const name of managed) delete process.env[name]
    for (const [name, value] of Object.entries(values)) process.env[name] = value
    return run()
  } finally {
    for (const name of managed) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
  }
}

test('each supported provider contributes its own credential and its own default model', () => {
  const expected = {
    anthropic: { credential: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-5' },
    openai: { credential: 'OPENAI_API_KEY', model: 'gpt-5.4' },
    google: { credential: 'GOOGLE_GENERATIVE_AI_API_KEY', model: 'gemini-pro-latest' },
  }
  for (const [provider, { credential, model }] of Object.entries(expected)) {
    const config = withAssistantEnv(
      { CONTENTKIT_LLM_PROVIDER: provider, [credential]: `key-for-${provider}` },
      loadConfig,
    )
    assert.equal(config.assistantProvider, provider)
    assert.equal(config.assistantApiKey, `key-for-${provider}`)
    assert.equal(config.assistantModel, model)
  }
})

test('anthropic stays the default provider, so an unchanged deployment is unchanged', () => {
  const config = withAssistantEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }, loadConfig)
  assert.equal(config.assistantProvider, 'anthropic')
  assert.equal(config.assistantApiKey, 'sk-ant-test')
  assert.equal(config.assistantModel, 'claude-sonnet-5')
})

test('no credential for the selected provider leaves the feature absent, not half-configured', () => {
  // Another provider's key must not switch the assistant on: it is the selected
  // provider's credential, and only that one, that decides the feature exists.
  const config = withAssistantEnv({ CONTENTKIT_LLM_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'sk-ant-test' }, loadConfig)
  assert.equal(config.assistantApiKey, '')
  assert.equal(createAssistant(config, { logger: {} }), null)
})

test('a model id belonging to another provider is refused by name, never sent to the vendor', () => {
  // A vendor answers a foreign model id with an opaque 404 that names no
  // variable. The operator has to be told which one of theirs is wrong.
  assert.throws(
    () =>
      withAssistantEnv(
        {
          CONTENTKIT_LLM_PROVIDER: 'openai',
          OPENAI_API_KEY: 'sk-openai-test',
          CONTENTKIT_MODEL_ASSISTANT: 'claude-sonnet-5',
        },
        loadConfig,
      ),
    (error) => {
      assert.match(error.message, /CONTENTKIT_MODEL_ASSISTANT/)
      assert.match(error.message, /does not belong to the openai provider/)
      assert.match(error.message, /gpt-5\.4/, 'the message must say what to set it to')
      assert.match(error.message, /CONTENTKIT_LLM_PROVIDER/, 'the other way out must be named too')
      return true
    },
  )
  // The same id under the provider that serves it is accepted.
  assert.equal(
    withAssistantEnv(
      {
        CONTENTKIT_LLM_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'sk-ant-test',
        CONTENTKIT_MODEL_ASSISTANT: 'claude-sonnet-5',
      },
      loadConfig,
    ).assistantModel,
    'claude-sonnet-5',
  )
})

test('an unsupported provider is rejected naming the whole set of supported ones', () => {
  assert.throws(
    () => withAssistantEnv({ CONTENTKIT_LLM_PROVIDER: 'mistral' }, loadConfig),
    /CONTENTKIT_LLM_PROVIDER must be one of anthropic, openai, google/,
  )
})

test('the retired variable names are not read, not even as a fallback', () => {
  // A hard break: the product-prefixed names are gone, and a fallback read of
  // them is the one way this rename could quietly come undone. A deployment
  // still on the old names must get the feature's clean absence — visible at
  // once — rather than a half-migrated configuration that works until the day
  // someone changes only the new name and nothing happens.
  const config = withAssistantEnv(
    {
      CONTENTKIT_ASSISTANT_PROVIDER: 'openai',
      CONTENTKIT_ASSISTANT_MODEL: 'gpt-5.4',
      CONTENTKIT_ANTHROPIC_API_KEY: 'sk-ant-retired',
      CONTENTKIT_OPENAI_API_KEY: 'sk-openai-retired',
      CONTENTKIT_GOOGLE_API_KEY: 'key-google-retired',
    },
    loadConfig,
  )
  assert.equal(config.assistantProvider, 'anthropic', 'the retired provider name must not select a provider')
  assert.equal(config.assistantApiKey, '', 'a retired credential name must not enable the assistant')
  assert.equal(config.assistantModel, 'claude-sonnet-5', 'the retired model name must not pick the model')
  assert.equal(createAssistant(config, { logger: {} }), null)
})
