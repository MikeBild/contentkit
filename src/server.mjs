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
import { createMaintenance } from './maintenance.mjs'
import { createMetrics } from './metrics.mjs'
import { sendJson } from './http.mjs'
import { createLimiter } from './security.mjs'
import { createRequestHandler, routeName } from './routes.mjs'
import { runMigrations } from './db/migrate.mjs'

export function createApp(config = loadConfig(), dependencies = {}) {
  const logger = dependencies.logger || createLogger(config)
  const database =
    dependencies.database || (dependencies.db ? { db: dependencies.db, async close() {} } : createPostgres(config))
  const db = database.db
  const storage = dependencies.storage || createStorage(config).storage
  const repo = dependencies.repo || createRepository(config, db, storage)
  const releases = dependencies.releases || createReleaseManager(config, repo, db, storage, logger)
  const auth = dependencies.auth || createAuth(config, db)
  const outbox = dependencies.outbox || createOutboxWorker(config, db, logger)
  const maintenance = dependencies.maintenance || createMaintenance(config, db, storage, logger)
  const limiter = createLimiter()
  const metrics = createMetrics()
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
    metrics,
    state,
  })

  const server = createServer((req, res) => {
    const requestId = randomUUID().slice(0, 12)
    const started = Date.now()
    res.setHeader('x-request-id', requestId)
    res.on('finish', () => {
      const route = routeName((req.url || '').split('?')[0])
      metrics.request(req.method, route, res.statusCode)
      logger.info('request', {
        requestId,
        method: req.method,
        path: route,
        status: res.statusCode,
        ms: Date.now() - started,
      })
    })
    handle(req, res).catch((error) => {
      const status = error.statusCode || (error.status >= 400 && error.status < 600 ? error.status : 500)
      logger.error('request failed', {
        requestId,
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
    limiter,
    releases,
    database,
    handle,
    async ensureStorage() {
      await storage.ensureBucket()
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
    app.limiter.stop()
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
