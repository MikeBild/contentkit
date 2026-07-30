import test from 'node:test'
import assert from 'node:assert/strict'
import { openApi } from '../../src/openapi.mjs'
import { API_ROUTES } from '../../src/routes.mjs'
import { MCP_AUTH_OPERATIONS } from '../../src/oauth/openapi.mjs'

const config = { publicUrl: 'https://contentkit-api.example.com', version: '9.9.9' }
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
const AUTH_OPERATIONS = new Set(MCP_AUTH_OPERATIONS)

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

// Generated clients name their methods after `operationId`. Leaving one out
// makes the generator fall back to a path-derived name that silently changes
// whenever the path does, so the whole surface has to stay named.
test('every operation carries a unique operationId', () => {
  const spec = openApi(config)
  const seen = new Map()
  for (const [path, operations] of Object.entries(spec.paths)) {
    for (const method of Object.keys(operations).filter((key) => HTTP_METHODS.includes(key))) {
      const { operationId } = operations[method]
      assert.ok(operationId, `${method.toUpperCase()} ${path} has no operationId`)
      assert.ok(
        !seen.has(operationId),
        `operationId ${operationId} is used by both ${seen.get(operationId)} and ${method.toUpperCase()} ${path}`,
      )
      seen.set(operationId, `${method.toUpperCase()} ${path}`)
    }
  }
})

// A site's locale set decides what a release contains at all, and the writes
// that change it refuse for reasons a client has to act on. A response described
// in prose generates no client type and a missing 409 makes the refusal look like
// a server fault, so both are pinned here rather than left to the generic
// "documents at least one response" rule.
test('the site locale operations name schemas for their bodies and their refusals', () => {
  const spec = openApi(config)
  const list = spec.paths['/v1/sites/{site}/locales']?.get
  const add = spec.paths['/v1/sites/{site}/locales']?.post
  const remove = spec.paths['/v1/sites/{site}/locales/{locale}']?.delete
  assert.equal(list?.operationId, 'siteLocaleList')
  assert.equal(add?.operationId, 'siteLocaleAdd')
  assert.equal(remove?.operationId, 'siteLocaleRemove')
  assert.equal(add.requestBody.content['application/json'].schema.$ref, '#/components/schemas/SiteLocaleInput')
  assert.equal(
    list.responses[200].content['application/json'].schema.$ref,
    '#/components/schemas/SiteLocaleList',
    'the read path must name a schema, or no locale editor can be typed against it',
  )
  assert.equal(
    add.responses[201].content['application/json'].schema.$ref,
    '#/components/schemas/SiteLocale',
    'the 201 must name a schema, not describe the body in prose',
  )
  assert.equal(
    remove.responses[200].content['application/json'].schema.$ref,
    '#/components/schemas/SiteLocaleRemoved',
    'the 200 must name a schema, not describe the body in prose',
  )
  for (const [operation, name] of [
    [add, 'siteLocaleAdd'],
    [remove, 'siteLocaleRemove'],
  ]) {
    assert.ok(operation.responses[409], `${name} must document the 409 refusal`)
    assert.ok(operation.responses[404], `${name} must document the missing site`)
  }
  // Removing default_locale and removing a locale whose content the site
  // publishes are the two refusals; the description has to name both — including
  // the scheduled revision, which sets no published pointer and so used to read
  // as a harmless draft — or a caller takes the 409 for a transient failure.
  assert.match(remove.description, /default_locale/)
  assert.match(remove.description, /published revision/)
  assert.match(remove.description, /scheduled/)
  // The stored rows and what the next release builds are two different sets for a
  // site with no rows at all. A read path that reported only one of them would
  // reproduce the claim this documentation used to make.
  const listed = spec.components.schemas.SiteLocaleList
  assert.deepEqual(listed.required, ['site_id', 'default_locale', 'locales', 'builds', 'max_locales'])
  assert.equal(listed.properties.locales.items.$ref, '#/components/schemas/SiteLocaleRow')
})

// `POST /v1/sites` validates and stores locales, domains and settings, and a body
// documented as an empty object hides all three: the console then creates a site
// and configures it in separate writes, which is the partial-progress state this
// schema exists to remove.
test('siteCreate documents the body it actually accepts', () => {
  const create = openApi(config).paths['/v1/sites'].post
  assert.equal(create.requestBody.content['application/json'].schema.$ref, '#/components/schemas/SiteCreateInput')
  assert.ok(create.description, 'siteCreate must describe what it validates')
  const input = openApi(config).components.schemas.SiteCreateInput
  assert.deepEqual(input.required, ['name', 'base_url', 'default_locale'])
  for (const property of [
    'name',
    'slug',
    'description',
    'base_url',
    'default_locale',
    'locales',
    'domains',
    'settings',
  ])
    assert.ok(input.properties[property], `SiteCreateInput must document ${property}`)
  assert.equal(input.properties.settings.$ref, '#/components/schemas/SiteSettings')
  // The locale shape is validated on this door too, so the description has to say
  // so: it used to accept tags `POST /v1/sites/{site}/locales` rejects.
  assert.match(create.description, /IETF language tag/)
  assert.ok(create.responses[422], 'the validation refusal has to be documented')
})

test('every documented API path and method is actually routable', () => {
  const spec = openApi(config)
  for (const [path, operations] of Object.entries(spec.paths)) {
    if (!path.startsWith('/v1') && !path.startsWith('/public')) continue
    // A `{param}` path template matches the same requests as the router's `[^/]+`.
    const concrete = path.replace(/\{[^}]+\}/g, 'x')
    const methods = Object.keys(operations).filter((key) => HTTP_METHODS.includes(key))
    if (methods.every((method) => AUTH_OPERATIONS.has(`${method} ${path}`))) continue
    const route = API_ROUTES.find((candidate) => candidate.pattern.test(concrete))
    assert.ok(route, `${path} is documented but matches no API route`)
    for (const method of methods) {
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
