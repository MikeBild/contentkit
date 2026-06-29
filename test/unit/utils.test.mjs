import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRequestPath, cleanPath, slugify } from '../../src/utils.mjs'

test('maps clean URLs to release objects', () => {
  assert.equal(canonicalRequestPath('/'), 'index.html')
  assert.equal(canonicalRequestPath('/de/blog/post/'), 'de/blog/post/index.html')
  assert.equal(canonicalRequestPath('/sitemap.xml'), 'sitemap.xml')
})

test('rejects traversal after URL decoding', () => {
  assert.throws(() => cleanPath('/assets/%2e%2e/secret'), /invalid path/)
})

test('creates stable ASCII slugs', () => {
  assert.equal(slugify('Über mich & APIs'), 'uber-mich-apis')
})
