import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { layouts } from '../../src/markdown.mjs'
import { openApi } from '../../src/openapi.mjs'
import { VERSION } from '../../src/version.mjs'
import { createApp } from '../../src/server.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const canonicalConfig = {
  publicUrl: 'https://contentkit-api.example.com',
  version: VERSION,
}

test('committed OpenAPI documentation matches generated OpenAPI', async () => {
  const expected = `${JSON.stringify(openApi(canonicalConfig), null, 2)}\n`
  const actual = await readFile(join(root, 'docs', 'openapi.json'), 'utf8')
  assert.equal(actual, expected, 'run npm run docs:gen-openapi after changing the HTTP API')
})

test('llms-full documents every OpenAPI path', async () => {
  const llms = await readFile(join(root, 'docs', 'llms-full.txt'), 'utf8')
  const paths = Object.keys(openApi(canonicalConfig).paths)
  for (const path of paths) {
    assert.match(llms, new RegExp(escapeRegExp(path)), `${path} is missing from docs/llms-full.txt`)
  }
})

test('llms index points to valid local documentation files', async () => {
  const llms = await readFile(join(root, 'docs', 'llms.txt'), 'utf8')
  const links = [...llms.matchAll(/\]\(([^)]+\.md|[^)]+\.txt|[^)]+\.json)\)/g)].map((match) => match[1])
  assert.ok(links.length > 0)
  for (const link of links) {
    await readFile(join(root, link), 'utf8')
  }
})

test('public authoring docs name every runtime layout', async () => {
  const documents = await Promise.all([
    readFile(join(root, 'README.md'), 'utf8'),
    readFile(join(root, 'docs', 'TEMPLATES.md'), 'utf8'),
    readFile(join(root, 'docs', 'llms-full.txt'), 'utf8'),
  ])
  for (const layout of layouts) {
    for (const document of documents) {
      assert.match(document, new RegExp('`' + escapeRegExp(layout) + '`'), `${layout} is missing from authoring docs`)
    }
  }
})

// The API host and every published tenant site share one deployment. These two
// tests pin the split: contentkit's own documentation, spec and telemetry answer
// on the API host and nowhere else.
async function withApp(run) {
  const app = createApp(
    { ...canonicalConfig, root, trustProxy: false, maxBodyBytes: 1024 * 1024 },
    {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      database: { db: {}, async close() {} },
      storage: {},
      // A site host that resolves to no site: the gateway declines and the request
      // falls through to the generic 404, as it would for any unknown host.
      repo: {
        async getSiteByHost() {
          return null
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
  await new Promise((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const { port } = app.server.address()
    // Not fetch(): Host is a forbidden header there, so undici silently replaces it
    // with the connection's authority and every request would look like the API host.
    const request = (path, host) =>
      new Promise((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => (body += chunk))
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
        })
        req.on('error', reject)
        req.end()
      })
    await run(request)
  } finally {
    app.limiter.stop()
    await new Promise((resolve) => app.server.close(resolve))
  }
}

const API_HOST = 'contentkit-api.example.com'
const SITE_HOST = 'www.example.dev'

test('HTTP documentation endpoints serve the committed LLM files on the API host', async () => {
  await withApp(async (request) => {
    const llms = await request('/llms.txt', API_HOST)
    assert.equal(llms.status, 200)
    assert.equal(llms.headers['content-type'], 'text/plain; charset=utf-8')
    assert.equal(llms.body, await readFile(join(root, 'docs', 'llms.txt'), 'utf8'))

    const full = await request('/llms-full.txt', API_HOST)
    assert.equal(full.status, 200)
    assert.equal(full.headers['content-type'], 'text/plain; charset=utf-8')
    assert.equal(full.body, await readFile(join(root, 'docs', 'llms-full.txt'), 'utf8'))

    assert.equal((await request('/openapi.json', API_HOST)).status, 200)
    assert.equal((await request('/metrics', API_HOST)).status, 200)
    assert.equal((await request('/', API_HOST)).status, 200)
  })
})

test('a site host gets none of contentkit’s docs, spec or telemetry', async () => {
  await withApp(async (request) => {
    // No engine documentation, and no 405 advertising that the route exists —
    // these must fall through to the gateway like any other site path. This host
    // resolves to no site, so the gateway declines and the generic 404 answers.
    for (const path of ['/llms.txt', '/llms-full.txt', '/openapi.json', '/metrics', '/']) {
      const response = await request(path, SITE_HOST)
      assert.equal(response.status, 404, `${path} must not answer on a site host`)
      assert.doesNotMatch(response.body, /Contentkit Documentation|contentkit_requests_total|"openapi"/, path)
    }
    // Supervisors and load balancers probe these over the loopback or a pod IP,
    // where the Host header never matches publicUrl. They must stay reachable —
    // 503 here only because this app's stubbed storage never reports ready.
    assert.equal((await request('/health', SITE_HOST)).status, 200)
    assert.notEqual((await request('/ready', SITE_HOST)).status, 404)
  })
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
