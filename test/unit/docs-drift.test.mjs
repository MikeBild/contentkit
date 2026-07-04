import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

test('HTTP documentation endpoints serve the committed LLM files', async () => {
  const config = {
    ...canonicalConfig,
    root,
    trustProxy: false,
    maxBodyBytes: 1024 * 1024,
  }
  const app = createApp(config, {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    database: { db: {}, async close() {} },
    storage: {},
    repo: {},
    releases: {
      inflight() {
        return 0
      },
    },
    auth: {},
    outbox: { start() {}, stop() {} },
  })
  await new Promise((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const { port } = app.server.address()
    const llms = await fetch(`http://127.0.0.1:${port}/llms.txt`)
    assert.equal(llms.status, 200)
    assert.equal(llms.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.equal(await llms.text(), await readFile(join(root, 'docs', 'llms.txt'), 'utf8'))

    const full = await fetch(`http://127.0.0.1:${port}/llms-full.txt`)
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('content-type'), 'text/plain; charset=utf-8')
    assert.equal(await full.text(), await readFile(join(root, 'docs', 'llms-full.txt'), 'utf8'))
  } finally {
    app.limiter.stop()
    await new Promise((resolve) => app.server.close(resolve))
  }
})

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
