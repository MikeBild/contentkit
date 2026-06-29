import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMultipart } from '../../src/http.mjs'

test('parses Markdown and named asset parts', () => {
  const boundary = 'contentkit-test'
  const body = Buffer.from([
    `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="post.md"\r\nContent-Type: text/markdown\r\n\r\n# Post\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="asset:images/hero.png"; filename="hero.png"\r\nContent-Type: image/png\r\n\r\nPNG\r\n`,
    `--${boundary}--\r\n`,
  ].join(''))
  const parts = parseMultipart(body, `multipart/form-data; boundary=${boundary}`)
  assert.equal(parts.length, 2)
  assert.equal(parts[0].name, 'document')
  assert.equal(parts[0].body.toString(), '# Post')
  assert.equal(parts[1].name, 'asset:images/hero.png')
  assert.equal(parts[1].contentType, 'image/png')
})
