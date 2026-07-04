import test from 'node:test'
import assert from 'node:assert/strict'
import { openApi } from '../../src/openapi.mjs'
import { API_ROUTES } from '../../src/routes.mjs'

const config = { publicUrl: 'https://contentkit-api.example.com', version: '9.9.9' }
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

test('the spec carries version, server URL and OpenAPI 3.1', () => {
  const spec = openApi(config)
  assert.equal(spec.openapi, '3.1.0')
  assert.equal(spec.info.version, '9.9.9')
  assert.equal(spec.servers[0].url, 'https://contentkit-api.example.com')
})

test('every operation documents at least one response', () => {
  const spec = openApi(config)
  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const method of Object.keys(operations).filter((key) => HTTP_METHODS.includes(key))) {
      const responses = operations[method].responses || {}
      assert.ok(Object.keys(responses).length > 0, `${method.toUpperCase()} ${path} documents no responses`)
    }
  }
})

test('every documented API path and method is actually routable', () => {
  const spec = openApi(config)
  for (const [path, operations] of Object.entries(spec.paths)) {
    if (!path.startsWith('/v1') && !path.startsWith('/public')) continue
    // A `{param}` path template matches the same requests as the router's `[^/]+`.
    const concrete = path.replace(/\{[^}]+\}/g, 'x')
    const route = API_ROUTES.find((candidate) => candidate.pattern.test(concrete))
    assert.ok(route, `${path} is documented but matches no API route`)
    for (const method of Object.keys(operations).filter((key) => HTTP_METHODS.includes(key))) {
      assert.ok(
        route.methods.includes(method.toUpperCase()),
        `${method.toUpperCase()} ${path} is documented but the router only allows ${route.methods.join(', ')}`,
      )
    }
  }
})

test('every API route is documented in the spec', () => {
  const spec = openApi(config)
  const concretePaths = Object.keys(spec.paths).map((path) => path.replace(/\{[^}]+\}/g, 'x'))
  for (const route of API_ROUTES) {
    assert.ok(
      concretePaths.some((path) => route.pattern.test(path)),
      `route ${route.pattern} has no matching documented path`,
    )
  }
})
