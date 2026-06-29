import test from 'node:test'
import assert from 'node:assert/strict'
import { createStorage } from '../../src/storage.mjs'

const config = {
  storageUrl: 'https://storage.example',
  storageServiceKey: 'service-key',
  storageBucket: 'contentkit',
}

test('creates a bucket when self-hosted storage wraps 404 as HTTP 400', async () => {
  const requests = []
  const storage = createStorage(config, async (url, options = {}) => {
    requests.push({ url, options })
    if (requests.length === 1) {
      return new Response(JSON.stringify({
        statusCode: '404',
        error: 'Bucket not found',
        message: 'Bucket not found',
      }), { status: 400, headers: { 'content-type': 'application/json' } })
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
