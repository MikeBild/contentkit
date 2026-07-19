import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../src/server.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

// Drives the request listener directly with a fake req/res pair: these tests
// are about the error middleware around handle(), not about routing, so no
// socket is needed and the response object can be shaped per scenario.
function appWithFailingHandler(errors) {
  return createApp(
    {
      publicUrl: 'https://contentkit-api.example',
      version: 'test',
      root,
      trustProxy: false,
      maxBodyBytes: 1024 * 1024,
    },
    {
      logger: {
        info() {},
        warn() {},
        debug() {},
        error(message, fields) {
          errors.push({ message, fields })
        },
      },
      database: { db: {}, async close() {} },
      storage: {},
      repo: {
        async getSiteByHost() {
          throw new Error('upstream not ready')
        },
      },
      releases: {
        inflight() {
          return 0
        },
      },
      auth: {},
      outbox: { start() {}, stop() {} },
    },
  )
}

function fakeResponse({ headersSent = false, statusCode = 200 } = {}) {
  const writes = []
  const res = {
    headersSent,
    statusCode,
    setHeader() {},
    on() {},
    writeHead(status, headers) {
      writes.push({ status, headers })
      res.headersSent = true
      res.statusCode = status
    },
    end(payload) {
      writes.push({ payload: String(payload || '') })
    },
  }
  return { res, writes }
}

async function dispatch(app, res) {
  app.server.emit('request', { method: 'GET', url: '/', headers: { host: 'site.example' } }, res)
  // handle() rejects asynchronously; give the catch a few microtask turns.
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
  app.limiter.stop()
  app.loginLimiter.stop()
}

test('a committed response is never rewritten and keeps its real status in the log', async () => {
  const errors = []
  const app = appWithFailingHandler(errors)
  const { res, writes } = fakeResponse({ headersSent: true, statusCode: 503 })
  await dispatch(app, res)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].message, 'request failed')
  // The client saw the committed 503 — a late failure must not be filed as 500.
  assert.equal(errors[0].fields.status, 503)
  assert.deepEqual(writes, [])
})

test('an uncommitted failure still answers with a JSON 500', async () => {
  const errors = []
  const app = appWithFailingHandler(errors)
  const { res, writes } = fakeResponse()
  await dispatch(app, res)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].fields.status, 500)
  assert.equal(writes[0].status, 500)
  const body = JSON.parse(writes[1].payload)
  assert.equal(body.error, 'internal error')
  assert.equal(body.request_id, errors[0].fields.request_id)
})
