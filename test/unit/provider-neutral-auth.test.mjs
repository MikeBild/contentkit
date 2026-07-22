import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

function productionSources(path) {
  return readdirSync(path).flatMap((name) => {
    const target = join(path, name)
    if (statSync(target).isDirectory()) return productionSources(target)
    return /\.(mjs|js)$/.test(name) && !name.includes('.test.') ? [target] : []
  })
}

test('runtime auth remains provider-neutral with only generic browser routes', () => {
  const files = [...productionSources('src/oauth'), 'src/config.mjs', 'src/routes.mjs']
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  const concreteProvider = new RegExp(['fire' + 'base'].join('|'), 'i')
  assert.doesNotMatch(source, concreteProvider)
  assert.doesNotMatch(source, /login\/(?:api-key|oidc)/i)
  assert.doesNotMatch(source, new RegExp(['token', 'bridge'].join('_'), 'i'))
  assert.doesNotMatch(source, /values\.get\(['"]id_token['"]\)/)
  assert.match(source, /\/v1\/identity\/login\/start/)
  assert.match(source, /\/v1\/identity\/login\/callback/)
  assert.match(source, /\/v1\/identity\/logout/)
})

test('browser-auth implementation and documentation stay provider-neutral', () => {
  const concreteProvider = new RegExp(['fire' + 'base', 'supa' + 'base'].join('|'), 'i')
  const source = [...productionSources('src/oauth'), 'MCP.md'].map((file) => readFileSync(file, 'utf8')).join('\n')
  assert.doesNotMatch(source, concreteProvider)
})
