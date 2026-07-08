import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalRequestPath, cleanPath, readingTime, slugify } from '../../src/utils.mjs'

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

const words = (count) => Array.from({ length: count }, (_, i) => `wort${i}`).join(' ')

test('reading time rounds to whole minutes with a one-minute floor', () => {
  assert.equal(readingTime(''), 1)
  assert.equal(readingTime('   \n  '), 1)
  assert.equal(readingTime(words(200)), 1)
  assert.equal(readingTime(words(300)), 2)
  assert.equal(readingTime(words(1000)), 5)
})

test('reading time excludes fenced code, including tilde fences and an unterminated one', () => {
  assert.equal(readingTime(`${words(200)}\n\n\`\`\`js\n${words(5000)}\n\`\`\`\n`), 1)
  assert.equal(readingTime(`${words(200)}\n\n~~~python\n${words(5000)}\n~~~\n`), 1)
  assert.equal(readingTime(`${words(200)}\n\n\`\`\`mermaid\n${words(5000)}\n\`\`\`\n`), 1)
  // A fence that runs to end-of-file must not leak its contents into the count.
  assert.equal(readingTime(`${words(200)}\n\n\`\`\`js\n${words(5000)}`), 1)
  // Two fences must not swallow the prose between them.
  assert.equal(readingTime(`\`\`\`\n${words(2000)}\n\`\`\`\n${words(400)}\n\`\`\`\n${words(2000)}\n\`\`\``), 2)
})

test('reading time excludes math, inline code, images and link URLs', () => {
  assert.equal(readingTime(`${words(200)} $${words(2000)}$`), 1)
  assert.equal(readingTime(`${words(200)}\n\n$$\n${words(3000)}\n$$\n`), 1)
  assert.equal(readingTime(`${words(200)} \`${words(2000)}\``), 1)
  assert.equal(readingTime(`${words(200)}\n\n![${words(3000)}](/x.png)`), 1)
  // Link text is read; the URL is not.
  assert.equal(readingTime(`${words(100)} [${words(100)}](https://example.com/a/very/long/path)`), 1)
  assert.equal(readingTime(`${words(200)}\n\n[ref]: https://example.com/${words(500)}`), 1)
})

test('reading time keeps directive content but drops the markers', () => {
  assert.equal(readingTime(`:::tip\n${words(300)}\n:::`), 2)
})

test('reading time counts German compounds as their parts', () => {
  // Software-Architektur -> 2 tokens, größer -> 1, Übermaß -> 1.
  assert.equal(readingTime(Array.from({ length: 100 }, () => 'Software-Architektur größer Übermaß').join(' ')), 2)
})
