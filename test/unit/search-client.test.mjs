import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../../assets/search.js', import.meta.url), 'utf8')

test('preview search uses only the immutable preview index', () => {
  assert.match(source, /const previewPath = \/\^\\\/\(\?:previews\|p\)/)
  assert.match(source, /previewPath\s*\? Promise\.resolve\(\[\]\)\s*: fetch\(`\/_contentkit\/search-index\.json/)
})
