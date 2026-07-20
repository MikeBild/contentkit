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

export function loadConfig() {
  loadEnvironment()
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
  if (process.env.NODE_ENV === 'production') {
    const required = {
      CONTENTKIT_BOOTSTRAP_API_KEY: config.bootstrapApiKey,
      CONTENTKIT_KEY_PEPPER: config.keyPepper,
      CONTENTKIT_PREVIEW_SECRET: config.previewSecret,
      CONTENTKIT_SESSION_SECRET: config.sessionSecret,
      SUPABASE_URL: config.storageUrl,
      SUPABASE_SERVICE_ROLE_KEY: config.storageServiceKey,
      DATABASE_URL: config.databaseUrl,
      CONTENTKIT_TURNSTILE_SECRET: config.turnstileSecret,
    }
    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([name]) => name)
    if (missing.length) throw new Error(`missing production configuration: ${missing.join(', ')}`)
  }
  return Object.freeze(config)
}
