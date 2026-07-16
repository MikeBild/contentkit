import test from 'node:test'
import assert from 'node:assert/strict'
import { openApi } from '../../src/openapi.mjs'
import { API_ROUTES } from '../../src/routes.mjs'

const spec = openApi({ publicUrl: 'https://contentkit-api.example', version: 'contract' })

test('access-management and reader-session paths are part of the OpenAPI contract', () => {
  for (const path of [
    '/_contentkit/login',
    '/_contentkit/logout',
    '/_contentkit/session',
    '/_contentkit/navigation.json',
    '/_contentkit/search-index.json',
    '/v1/sites/{site}/access/users',
    '/v1/sites/{site}/access/users/{user}',
    '/v1/sites/{site}/access/users/{user}/revoke-sessions',
    '/v1/sites/{site}/access/groups',
    '/v1/sites/{site}/access/groups/{group}',
    '/v1/sites/{site}/access/groups/{group}/members',
    '/v1/sites/{site}/access/rules',
    '/v1/sites/{site}/access/rules/{rule}',
  ])
    assert.ok(spec.paths[path], path)
})

test('public access schemas never expose password hashes or session tokens', () => {
  const serialized = JSON.stringify(spec.components.schemas)
  assert.doesNotMatch(serialized, /password_hash|token_hash/)
  assert.deepEqual(spec.components.schemas.AccessRule.properties.match.enum, ['exact', 'prefix'])
})

test('every documented access operation has a routable method', () => {
  const normalize = (path) => path.replaceAll(/\{[^}]+\}/g, '[^/]+').replaceAll('.', '\\.')
  for (const [path, item] of Object.entries(spec.paths).filter(
    ([path]) => path.includes('_contentkit') || path.includes('/access/'),
  )) {
    for (const method of Object.keys(item)) {
      const route = API_ROUTES.find((candidate) => candidate.pattern.test(path.replaceAll(/\{[^}]+\}/g, 'value')))
      assert.ok(route, `${method.toUpperCase()} ${path} is not routable (${normalize(path)})`)
      assert.ok(
        route.methods.includes(method.toUpperCase()),
        `${method.toUpperCase()} ${path} is missing from the route method map`,
      )
    }
  }
})
