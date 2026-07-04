import test from 'node:test'
import assert from 'node:assert/strict'
import { createStorage, StorageError } from '../../src/storage.mjs'

const config = {
  storageUrl: 'https://storage.example',
  storageServiceKey: 'service-key',
  storageBucket: 'contentkit',
}

function respondWith(status, body) {
  return createStorage(
    config,
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  )
}

test('normalizes a self-hosted wrapped 400 not-found to status 404', async () => {
  const { storage } = respondWith(400, { statusCode: '404', error: 'not_found', message: 'Object not found' })
  await assert.rejects(
    () => storage.download('sites/x/releases/y/missing/index.html'),
    (error) => {
      assert.ok(error instanceof StorageError)
      assert.equal(error.status, 404)
      assert.equal(error.message, 'Object not found')
      return true
    },
  )
})

test('keeps a genuine storage 404 status', async () => {
  const { storage } = respondWith(404, { message: 'not found' })
  await assert.rejects(
    () => storage.download('sites/x/releases/y/missing/index.html'),
    (error) => {
      assert.equal(error.status, 404)
      return true
    },
  )
})

test('keeps a genuine 400 without a wrapped statusCode', async () => {
  const { storage } = respondWith(400, { message: 'bad request' })
  await assert.rejects(
    () => storage.download('sites/x/releases/y/bad'),
    (error) => {
      assert.equal(error.status, 400)
      return true
    },
  )
})

test('creates a bucket when self-hosted storage wraps 404 as HTTP 400', async () => {
  const requests = []
  const storage = createStorage(config, async (url, options = {}) => {
    requests.push({ url, options })
    if (requests.length === 1) {
      return new Response(
        JSON.stringify({
          statusCode: '404',
          error: 'Bucket not found',
          message: 'Bucket not found',
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }).storage

  await storage.ensureBucket()

  assert.equal(requests.length, 2)
  assert.equal(requests[0].options.method, undefined)
  assert.equal(requests[1].options.method, 'POST')
  assert.equal(requests[1].url, 'https://storage.example/storage/v1/bucket')
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    id: 'contentkit',
    name: 'contentkit',
    public: false,
  })
})
