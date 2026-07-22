import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { loadConfig } from './config.mjs'
import { createLogger } from './logger.mjs'
import { createStorage } from './storage.mjs'
import { createPostgres } from './postgres.mjs'
import { createRepository } from './repository.mjs'
import { createReleaseManager } from './releases.mjs'
import { createAuth } from './auth.mjs'
import { createOutboxWorker } from './webhooks.mjs'
import { createAudioWorker } from './audio.mjs'
import { createMaintenance } from './maintenance.mjs'
import { createMetrics } from './metrics.mjs'
import { createDeckRenderer } from './deck-renderer.mjs'
import { createDeckJobStore } from './deck-jobs.mjs'
import { sendJson } from './http.mjs'
import { createLimiter } from './security.mjs'
import { createRequestHandler, routeName } from './routes.mjs'
import { runMigrations } from './db/migrate.mjs'
import { createTraceContext } from './trace-context.mjs'
import { createUsageTelemetry } from './usage.mjs'
import { createAudit } from './audit.mjs'
import { createOAuthMount } from './oauth/server.mjs'
import { createMcpMount } from './mcp/server.mjs'
import { createSecretHandoffs } from './secret-handoffs.mjs'
import { nodeWebHandler } from './web-bridge.mjs'
import { isApiHost } from './routes.mjs'

export function createApp(config = loadConfig(), dependencies = {}) {
  const logger = dependencies.logger || createLogger(config)
  const database =
    dependencies.database || (dependencies.db ? { db: dependencies.db, async close() {} } : createPostgres(config))
  const db = database.db
  const storage = dependencies.storage || createStorage(config).storage
  const repo = dependencies.repo || createRepository(config, db, storage)
  const metrics = createMetrics()
  const usage = dependencies.usage || createUsageTelemetry(config, db, logger)
  const mcpUsage = {
    ...usage,
    async recordMcp(input) {
      metrics.mcpOperation(input)
      return usage.recordMcp(input)
    },
  }
  const deckRenderer =
    dependencies.deckRenderer ||
    createDeckRenderer(config, logger, {
      cache: (result) => metrics.deckCache(result),
      build: (event) => metrics.deckBuild(event),
    })
  const deckJobs = dependencies.deckJobs || createDeckJobStore({ max: config.deckJobsMax, ttlMs: config.deckJobTtlMs })
  const audio = dependencies.audio || createAudioWorker(config, db, repo, storage, logger)
  // Publishing enqueues read-aloud jobs fire-and-forget; the hook can never
  // fail a release (see build() in releases.mjs).
  const releases =
    dependencies.releases ||
    createReleaseManager(config, repo, db, storage, logger, {
      onPublished: (published) => audio.enqueueAudioJobs(published),
      deckRenderer,
    })
  // Worker ↔ releases is mutual: publishing enqueues audio jobs (hook above),
  // finished audio schedules a debounced rebuild release. The worker exists
  // first, so its publish reference is bound late — no import or constructor
  // cycle. No loop either: auto-rebuilds carry empty revision_ids, and the
  // onPublished hook only fires for releases with revisions.
  audio.setPublisher?.((input) => releases.publish(input))
  const auth = dependencies.auth || createAuth(config, db)
  const audit = dependencies.audit || createAudit(db, logger)
  const secretHandoffs = dependencies.secretHandoffs || createSecretHandoffs(config, logger)
  const oauth = dependencies.oauth || createOAuthMount(config, { db, auth, audit, logger })
  const mcp =
    dependencies.mcp ||
    createMcpMount(config, {
      config,
      db,
      repo,
      releases,
      auth,
      audit,
      logger,
      usage: mcpUsage,
      deckRenderer,
      deckJobs,
      secretHandoffs,
    })
  const outbox = dependencies.outbox || createOutboxWorker(config, db, logger)
  const maintenance = dependencies.maintenance || createMaintenance(config, db, storage, logger)
  const limiter = createLimiter()
  const loginLimiter = dependencies.loginLimiter || createLimiter(15 * 60 * 1000, 5)
  const state = { draining: false, storageReady: false }

  const handle = createRequestHandler({
    config,
    logger,
    db,
    storage,
    repo,
    releases,
    auth,
    maintenance,
    limiter,
    loginLimiter,
    metrics,
    state,
    audio,
    deckRenderer,
    deckJobs,
    usage,
    audit,
    mcp,
  })

  const mcpHandler = nodeWebHandler(mcp, { maxBodyBytes: config.maxBodyBytes, publicUrl: config.publicUrl })
  const oauthHandler = nodeWebHandler(oauth, { maxBodyBytes: config.maxBodyBytes, publicUrl: config.publicUrl })
  const handoffHandler = nodeWebHandler(secretHandoffs, {
    maxBodyBytes: config.maxBodyBytes,
    publicUrl: config.publicUrl,
  })

  const server = createServer((req, res) => {
    const requestId = randomUUID().slice(0, 12)
    const trace = createTraceContext(req.headers.traceparent)
    const started = Date.now()
    res.setHeader('x-request-id', requestId)
    res.setHeader('traceparent', trace.traceparent)
    res.on('finish', () => {
      const route = routeName((req.url || '').split('?')[0])
      const durationMs = Date.now() - started
      metrics.request(req.method, route, res.statusCode)
      usage.recordHttp(req, res, { route, durationMs }).catch(() => {})
      logger.info('request', {
        request_id: requestId,
        trace_id: trace.traceId,
        span_id: trace.spanId,
        parent_span_id: trace.parentSpanId,
        method: req.method,
        path: route,
        status: res.statusCode,
        ms: durationMs,
      })
    })
    const path = (req.url || '').split('?')[0]
    const onApiHost = isApiHost(req, config)
    const oauthPath =
      path === '/.well-known/oauth-protected-resource' ||
      path === '/.well-known/oauth-protected-resource/mcp' ||
      path === '/.well-known/oauth-authorization-server' ||
      path === '/v1/identity/providers' ||
      path === '/v1/identity/sessions' ||
      path === '/v1/identity/logout' ||
      /^\/v1\/(?:oauth|identity\/login)\//.test(path)
    const handoffPath = /^\/oauth\/secret\//.test(path)
    const dispatched =
      config.mcpEnabled && onApiHost && path === '/mcp'
        ? mcpHandler(req, res)
        : config.mcpEnabled && onApiHost && oauthPath
          ? oauthHandler(req, res)
          : config.mcpEnabled && onApiHost && handoffPath
            ? handoffHandler(req, res)
            : handle(req, res)
    dispatched.catch((error) => {
      // A committed response cannot be rewritten, and the client already got
      // its real status (e.g. the gateway's 503) — report that instead of
      // filing the late write attempt (ERR_HTTP_HEADERS_SENT) as a fresh 500.
      const status = res.headersSent
        ? res.statusCode
        : error.statusCode || (error.status >= 400 && error.status < 600 ? error.status : 500)
      logger.error('request failed', {
        request_id: requestId,
        trace_id: trace.traceId,
        span_id: trace.spanId,
        parent_span_id: trace.parentSpanId,
        status,
        error: String(error.message || error),
        details: error.details,
      })
      if (!res.headersSent)
        sendJson(res, status, { error: status === 500 ? 'internal error' : error.message, request_id: requestId })
    })
  })

  return {
    server,
    state,
    outbox,
    audio,
    limiter,
    loginLimiter,
    releases,
    deckRenderer,
    deckJobs,
    usage,
    audit,
    oauth,
    mcp,
    secretHandoffs,
    database,
    handle,
    async ensureStorage() {
      await Promise.all([storage.ensureBucket(), deckRenderer.sweep?.()])
      state.storageReady = true
    },
  }
}

export async function start(config = loadConfig()) {
  const logger = createLogger(config)
  let migrationReport
  try {
    migrationReport = await runMigrations(config, logger)
  } catch (error) {
    logger.error('embedded migrations failed; aborting boot', {
      error: String(error.message || error),
      stack: error.stack,
    })
    throw error
  }
  const app = createApp(config, { logger })
  try {
    await app.ensureStorage()
    logger.info('storage ready', { bucket: config.storageBucket })
  } catch (error) {
    logger.error('storage initialization failed; aborting boot', { error: String(error.message || error) })
    await app.database.close().catch(() => {})
    throw error
  }
  try {
    await new Promise((resolve, reject) => {
      app.server.once('error', reject)
      app.server.listen(config.port, config.host, resolve)
    })
  } catch (error) {
    await app.database.close().catch(() => {})
    throw error
  }
  app.outbox.start()
  app.usage.start()
  if (config.mcpEnabled) app.oauth.start()
  // Deployment-level switch: the poller only runs where ffmpeg and TTS
  // credentials exist. Which sites get audio is decided per site at enqueue
  // time via settings.audio.enabled.
  if (config.audioEnabled) app.audio.start()
  logger.info('contentkit listening', {
    url: `http://${config.host}:${config.port}`,
    version: config.version,
    migrations: migrationReport,
  })
  let stopping = false
  async function shutdown(signal) {
    if (stopping) return
    stopping = true
    app.state.draining = true
    app.outbox.stop()
    app.audio.stop()
    app.deckJobs.stop()
    app.usage.stop()
    app.oauth.stop()
    app.mcp.stop()
    await app.secretHandoffs.stop()
    app.limiter.stop()
    app.loginLimiter.stop()
    app.server.close(async () => {
      await app.database.close().catch(() => {})
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 30000).unref()
    logger.info('draining', { signal })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  return app
}
