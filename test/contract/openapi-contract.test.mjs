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

test('preview contract separates one-time invitation access from the memorable URL', () => {
  const operation = spec.paths['/v1/sites/{site}/previews'].post
  const request = operation.requestBody.content['application/json'].schema
  const response = operation.responses[201].content['application/json'].schema
  assert.ok(request.required.includes('slug'))
  assert.equal(request.properties.slug.maxLength, 80)
  assert.ok(response.required.includes('invitation_url'))
  assert.ok(response.required.includes('preview_url'))
  assert.equal(response.properties.url, undefined)
  assert.ok(spec.paths['/preview-invitations/{token}'].get.responses[303])
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

test('the OpenAPI authoring contract documents semantic compositions, charts and theme tokens', () => {
  const serialized = JSON.stringify(spec)
  for (const term of [
    '`composition`',
    '`infographic`',
    '`report`',
    '`reportCadence`',
    '`reportSeries`',
    '`report_series`',
    '`hourly`',
    '`daily`',
    '`yearly`',
    '`group`',
    '`process`',
    '`chart`',
    '`bar`',
    '`line`',
    '`area`',
    '`donut`',
    '`chart_1`',
  ]) {
    assert.match(serialized, new RegExp(term), term)
  }
  assert.match(serialized, /standalone light\/dark SVG and PNG/)
  const pattern = spec.components.schemas.PatternDescriptor
  assert.ok(pattern.required.includes('rendering_strategy'))
  assert.ok(pattern.required.includes('narrative'))
  assert.ok(pattern.required.includes('input_contract'))
  assert.ok(pattern.required.includes('spec_examples'))
  assert.deepEqual(pattern.properties.rendering_strategy.properties.primary_output.enum, ['html', 'svg'])
  assert.equal(pattern.properties.rendering_strategy.properties.html_fidelity.const, 'layout-equivalent')
  assert.equal(pattern.properties.rendering_strategy.properties.png_role.const, 'derived-static-export')
  assert.ok(pattern.properties.content_budget.required.includes('max_title_characters'))
  assert.ok(pattern.properties.content_budget.required.includes('max_series'))
  assert.ok(spec.components.schemas.PublishingGuide)
  assert.ok(spec.components.schemas.ReportSeriesSetting)
  assert.equal(spec.components.schemas.PublishedEntry.properties.report_series.type[1], 'null')
  assert.equal(
    spec.paths['/v1/sites/{site}/published'].get.responses[200].content['application/json'].schema.$ref,
    '#/components/schemas/PublishedList',
  )
  assert.ok(spec.paths['/v1/publishing-guides'])
  assert.ok(spec.paths['/v1/publishing-guides/{guide}'])
})

test('semantic deck, async job and statistics paths are documented and routable', () => {
  for (const path of [
    '/v1/deck-themes',
    '/v1/deck-templates',
    '/v1/sites/{site}/decks/plan',
    '/v1/sites/{site}/decks/validate',
    '/v1/sites/{site}/decks/compile',
    '/v1/sites/{site}/deck-jobs/{job}',
    '/v1/sites/{site}/deck-jobs/{job}/result',
    '/v1/sites/{site}/stats/decks',
  ]) {
    const item = spec.paths[path]
    assert.ok(item, path)
    const sample = path.replaceAll(/\{[^}]+\}/g, 'value')
    for (const method of Object.keys(item)) {
      const route = API_ROUTES.find((candidate) => candidate.pattern.test(sample))
      assert.ok(route, `${method.toUpperCase()} ${path}`)
      assert.ok(route.methods.includes(method.toUpperCase()), `${method.toUpperCase()} ${path}`)
    }
  }
  assert.match(spec.paths['/v1/sites/{site}/decks/compile'].post.description, /deck:render/)
  assert.ok(spec.paths['/v1/sites/{site}/decks/compile'].post.responses[202])
})
