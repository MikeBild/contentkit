import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION } from './version.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function readDotEnv(path) {
  const values = {}
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/)
      if (!match) continue
      let value = match[2]
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      values[match[1]] = value
    }
  } catch {}
  return values
}

function loadEnvironment() {
  const external = new Set(Object.keys(process.env))
  const overrides = readDotEnv(join(root, '.env'))
  const production = (process.env.NODE_ENV ?? overrides.NODE_ENV) === 'production'
  if (!production) {
    for (const [name, value] of Object.entries(readDotEnv(join(root, '.env.defaults')))) {
      if (process.env[name] === undefined) process.env[name] = value
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!external.has(name)) process.env[name] = value
  }
}

function integer(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name]
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

function bool(name, fallback = false) {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())
}

function csv(name, fallback = []) {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return [...fallback]
  return [
    ...new Set(
      raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
}

function oauthProviders(name) {
  const raw = process.env[name]
  if (!raw?.trim()) return [Object.freeze({ protocol: 'api_key', id: 'api-key', label: 'ContentKit API key' })]
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error(`${name} must be a non-empty JSON array`)
  const ids = new Set()
  let apiKeyConfigured = false
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${name}[${index}] must be an object`)
    }
    const protocol = String(entry.protocol || '').trim()
    const id = String(entry.id || '').trim()
    const label = String(entry.label || '').trim()
    if (!['api_key', 'oidc'].includes(protocol)) {
      throw new Error(`${name}[${index}].protocol must be api_key or oidc`)
    }
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) || ids.has(id)) {
      throw new Error(`${name}[${index}].id must be a unique lowercase slug`)
    }
    if (!label || label.length > 120) throw new Error(`${name}[${index}] requires a label`)
    ids.add(id)
    if (protocol === 'api_key') {
      if (apiKeyConfigured) throw new Error(`${name} may contain only one api_key provider`)
      apiKeyConfigured = true
      return Object.freeze({ protocol, id, label })
    }

    const issuer = String(entry.issuer_url || '')
      .trim()
      .replace(/\/$/, '')
    const clientId = String(entry.client_id || '').trim()
    const clientSecret = String(entry.client_secret || '').trim()
    const scopes = String(entry.scopes || 'openid profile email').trim()
    if (!clientId) throw new Error(`${name}[${index}] OIDC provider requires client_id`)
    let issuerUrl
    try {
      issuerUrl = new URL(issuer)
    } catch {
      throw new Error(`${name}[${index}].issuer_url must be an HTTPS URL`)
    }
    if (issuerUrl.protocol !== 'https:') throw new Error(`${name}[${index}].issuer_url must use HTTPS`)
    if (!scopes.split(/\s+/).includes('openid')) throw new Error(`${name}[${index}].scopes must include openid`)
    return Object.freeze({ protocol, id, label, issuer, clientId, clientSecret, scopes })
  })
}

export function loadConfig() {
  loadEnvironment()
  const configuredOauthProviders = oauthProviders('CONTENTKIT_OAUTH_PROVIDERS')
  const config = {
    root,
    host: process.env.HOST || '127.0.0.1',
    port: integer('PORT', 4050, { min: 1, max: 65535 }),
    publicUrl: (process.env.CONTENTKIT_PUBLIC_URL || 'http://127.0.0.1:4050').replace(/\/$/, ''),
    bootstrapApiKey: process.env.CONTENTKIT_BOOTSTRAP_API_KEY || '',
    keyPepper: process.env.CONTENTKIT_KEY_PEPPER || '',
    previewSecret: process.env.CONTENTKIT_PREVIEW_SECRET || '',
    sessionSecret:
      process.env.CONTENTKIT_SESSION_SECRET ||
      (process.env.NODE_ENV === 'production' ? '' : process.env.CONTENTKIT_PREVIEW_SECRET || ''),
    mcpEnabled: bool('CONTENTKIT_MCP_ENABLED', true),
    mcpSessionTtlMs: integer('CONTENTKIT_MCP_SESSION_TTL_MS', 30 * 60 * 1000, {
      min: 60 * 1000,
      max: 24 * 60 * 60 * 1000,
    }),
    mcpMaxSessions: integer('CONTENTKIT_MCP_MAX_SESSIONS', 1000, { min: 1, max: 10000 }),
    mcpElicitationTimeoutMs: integer('CONTENTKIT_MCP_ELICITATION_TIMEOUT_MS', 5 * 60 * 1000, {
      min: 10 * 1000,
      max: 15 * 60 * 1000,
    }),
    oauthSecret: process.env.CONTENTKIT_OAUTH_SECRET || '',
    oauthProviders: configuredOauthProviders,
    oauthAllowedScopes: csv('CONTENTKIT_OAUTH_ALLOWED_SCOPES', ['mcp:read', 'mcp:authoring', 'mcp:admin']),
    oauthDynamicRegistrationEnabled: bool('CONTENTKIT_OAUTH_DCR_ENABLED', true),
    oauthAuthorizationCodeTtlMs: integer('CONTENTKIT_OAUTH_CODE_TTL_MS', 10 * 60 * 1000, {
      min: 60 * 1000,
      max: 60 * 60 * 1000,
    }),
    oauthAccessTokenTtlMs: integer('CONTENTKIT_OAUTH_ACCESS_TOKEN_TTL_MS', 60 * 60 * 1000, {
      min: 5 * 60 * 1000,
      max: 24 * 60 * 60 * 1000,
    }),
    oauthRefreshTokenTtlMs: integer('CONTENTKIT_OAUTH_REFRESH_TOKEN_TTL_MS', 30 * 24 * 60 * 60 * 1000, {
      min: 24 * 60 * 60 * 1000,
      max: 365 * 24 * 60 * 60 * 1000,
    }),
    storageUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    storageServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    databaseUrl: process.env.DATABASE_URL || '',
    storageBucket: process.env.CONTENTKIT_STORAGE_BUCKET || 'contentkit',
    webhookUrl: process.env.CONTENTKIT_WEBHOOK_URL || '',
    webhookSecret: process.env.CONTENTKIT_WEBHOOK_SECRET || '',
    turnstileSecret: process.env.CONTENTKIT_TURNSTILE_SECRET || '',
    trustProxy: bool('CONTENTKIT_TRUST_PROXY', false),
    maxBodyBytes: integer('CONTENTKIT_MAX_BODY_BYTES', 25 * 1024 * 1024, { min: 1024, max: 250 * 1024 * 1024 }),
    buildConcurrency: integer('CONTENTKIT_BUILD_CONCURRENCY', 1, { min: 1, max: 8 }),
    deckBuildConcurrency: integer('CONTENTKIT_DECK_BUILD_CONCURRENCY', 1, { min: 1, max: 4 }),
    deckBuildQueueMax: integer('CONTENTKIT_DECK_BUILD_QUEUE_MAX', 8, { min: 0, max: 64 }),
    deckBuildTimeoutMs: integer('CONTENTKIT_DECK_BUILD_TIMEOUT_MS', 120000, { min: 5000, max: 600000 }),
    deckQueueTimeoutMs: integer('CONTENTKIT_DECK_QUEUE_TIMEOUT_MS', 120000, { min: 1000, max: 600000 }),
    deckCacheMax: integer('CONTENTKIT_DECK_CACHE_MAX', 32, { min: 0, max: 512 }),
    deckJobsMax: integer('CONTENTKIT_DECK_JOBS_MAX', 8, { min: 1, max: 64 }),
    deckJobTtlMs: integer('CONTENTKIT_DECK_JOB_TTL_MS', 10 * 60 * 1000, { min: 60000, max: 86400000 }),
    deckWorkDir: process.env.CONTENTKIT_DECK_WORK_DIR || join(root, '.deck-work'),
    deckSlidevCli:
      process.env.CONTENTKIT_SLIDEV_CLI || join(root, 'node_modules', '@slidev', 'cli', 'bin', 'slidev.mjs'),
    webhookPollMs: integer('CONTENTKIT_WEBHOOK_POLL_MS', 5000, { min: 1000, max: 300000 }),
    webhookTimeoutMs: integer('CONTENTKIT_WEBHOOK_TIMEOUT_MS', 10000, { min: 1000, max: 60000 }),
    webhookMaxAttempts: integer('CONTENTKIT_WEBHOOK_MAX_ATTEMPTS', 10, { min: 1, max: 20 }),
    webhookCircuitThreshold: integer('CONTENTKIT_WEBHOOK_CIRCUIT_THRESHOLD', 5, { min: 1, max: 100 }),
    webhookAllowPrivateTargets: bool('CONTENTKIT_WEBHOOK_ALLOW_PRIVATE', process.env.NODE_ENV !== 'production'),
    turnstileDevBypass: bool('CONTENTKIT_TURNSTILE_DEV_BYPASS', false),
    releaseHistoryKeep: integer('CONTENTKIT_RELEASE_HISTORY_KEEP', 5, { min: 1, max: 100 }),
    releaseRetentionMs: integer('CONTENTKIT_RELEASE_RETENTION_MS', 7 * 86400 * 1000, {
      min: 0,
      max: 365 * 86400 * 1000,
    }),
    buildingReapMs: integer('CONTENTKIT_BUILDING_REAP_MS', 3600 * 1000, { min: 60 * 1000, max: 86400 * 1000 }),
    productStatsRetentionDays: integer('CONTENTKIT_PRODUCT_STATS_RETENTION_DAYS', 400, { min: 31, max: 3650 }),
    usageTelemetryEnabled: bool('CONTENTKIT_USAGE_TELEMETRY_ENABLED', false),
    usageHmacSecret: process.env.CONTENTKIT_USAGE_HMAC_SECRET || '',
    usageRetentionDays: integer('CONTENTKIT_USAGE_RETENTION_DAYS', 90, { min: 31, max: 365 }),
    // Read-aloud audio (TTS). The worker only starts when explicitly enabled;
    // per-site opt-in lives in ck_sites.settings.audio (enabled/provider/voice/
    // monthly_char_budget). ffmpeg is a host runtime dependency for MP3 output.
    audioEnabled: bool('CONTENTKIT_AUDIO_ENABLED', false),
    audioPollMs: integer('CONTENTKIT_AUDIO_POLL_MS', 15000, { min: 1000, max: 300000 }),
    audioMaxAttempts: integer('CONTENTKIT_AUDIO_MAX_ATTEMPTS', 5, { min: 1, max: 20 }),
    // Debounce for the automatic rebuild after new audio finishes: per site,
    // a burst of completed jobs (e.g. a backfill) results in one release.
    audioRebuildDebounceMs: integer('CONTENTKIT_AUDIO_REBUILD_DEBOUNCE_MS', 60000, { min: 1000, max: 3600000 }),
    ffmpegPath: process.env.CONTENTKIT_FFMPEG || 'ffmpeg',
    ttsGoogleApiKey: process.env.CONTENTKIT_TTS_GOOGLE_API_KEY || '',
    ttsGoogleToken: process.env.CONTENTKIT_TTS_GOOGLE_TOKEN || '',
    ttsGoogleQuotaProject: process.env.CONTENTKIT_TTS_GOOGLE_QUOTA_PROJECT || '',
    logLevel: process.env.LOG_LEVEL || 'info',
    deploymentEnvironment:
      process.env.CONTENTKIT_DEPLOYMENT_ENVIRONMENT ||
      (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
    version: VERSION,
  }
  if (Boolean(config.webhookUrl) !== Boolean(config.webhookSecret)) {
    throw new Error('CONTENTKIT_WEBHOOK_URL and CONTENTKIT_WEBHOOK_SECRET must be configured together')
  }
  if (config.usageTelemetryEnabled && !config.usageHmacSecret) {
    throw new Error('CONTENTKIT_USAGE_HMAC_SECRET is required when usage telemetry is enabled')
  }
  const supportedOauthScopes = new Set(['mcp:read', 'mcp:authoring', 'mcp:admin'])
  if (
    !config.oauthAllowedScopes.includes('mcp:read') ||
    config.oauthAllowedScopes.some((scope) => !supportedOauthScopes.has(scope))
  ) {
    throw new Error('CONTENTKIT_OAUTH_ALLOWED_SCOPES must contain mcp:read and only supported MCP OAuth scopes')
  }
  if (process.env.NODE_ENV === 'production') {
    const required = {
      CONTENTKIT_BOOTSTRAP_API_KEY: config.bootstrapApiKey,
      CONTENTKIT_KEY_PEPPER: config.keyPepper,
      CONTENTKIT_PREVIEW_SECRET: config.previewSecret,
      CONTENTKIT_SESSION_SECRET: config.sessionSecret,
      CONTENTKIT_OAUTH_SECRET: config.oauthSecret,
      SUPABASE_URL: config.storageUrl,
      SUPABASE_SERVICE_ROLE_KEY: config.storageServiceKey,
      DATABASE_URL: config.databaseUrl,
      CONTENTKIT_TURNSTILE_SECRET: config.turnstileSecret,
      CONTENTKIT_OAUTH_PROVIDERS: process.env.CONTENTKIT_OAUTH_PROVIDERS || '',
    }
    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([name]) => name)
    if (missing.length) throw new Error(`missing production configuration: ${missing.join(', ')}`)
  }
  return Object.freeze(config)
}
