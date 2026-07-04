import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite } from '../../src/site-builder.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const site = {
  id: 'site-1',
  name: 'Example',
  description: 'Personal site',
  base_url: 'https://example.test',
  default_locale: 'en',
  settings: {},
}

function post({ slug, title, tags = [], noindex = false, date = '2026-06-01' }) {
  return {
    id: `rev-${slug}`,
    item_id: `item-${slug}`,
    kind: 'post',
    locale: 'en',
    translation_key: slug,
    markdown: `---\nkind: post\ntitle: ${title}\nlocale: en\nslug: ${slug}\ntranslationKey: ${slug}\nsummary: About ${title}\ndate: ${date}\ntags: [${tags.join(', ')}]\n${noindex ? 'noindex: true\n' : ''}---\n# ${title}\n\nBody text.`,
  }
}

async function build(overrides = {}) {
  return buildSite({
    root,
    site,
    locales: [{ locale: 'en' }],
    revisions: [],
    comments: [],
    ...overrides,
  })
}

test('tag pages are generated per slugified tag and listed in the sitemap', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'A', tags: ['Node JS'] })] })
  assert.ok(result.files.has('en/tags/node-js/index.html'), 'tag page missing')
  const tagPage = result.files.get('en/tags/node-js/index.html').body.toString()
  assert.match(tagPage, /#Node JS/, 'tag heading keeps its original spelling')
  assert.match(tagPage, /href="\/en\/tags\/node-js\/"/, 'card tag links use the same slug as the page URL')
  assert.match(result.files.get('sitemap.xml').body.toString(), /https:\/\/example\.test\/en\/tags\/node-js\//)
})

test('noindex posts render a page but stay out of the sitemap', async () => {
  const result = await build({ revisions: [post({ slug: 'secret', title: 'Secret', noindex: true })] })
  assert.ok(result.files.has('en/blog/secret/index.html'))
  assert.match(result.files.get('en/blog/secret/index.html').body.toString(), /noindex,nofollow/)
  assert.doesNotMatch(result.files.get('sitemap.xml').body.toString(), /\/blog\/secret\//)
})

test('the search index carries lowercased searchable text per item', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'Alpha Beta', tags: ['GaMmA'] })] })
  const index = JSON.parse(result.files.get('en/search-index.json').body.toString())
  assert.equal(index.length, 1)
  assert.equal(index[0].url, '/en/blog/a/')
  assert.match(index[0].text, /alpha beta/)
  assert.match(index[0].text, /gamma/)
})

test('the RSS feed lists posts with absolute links and pubDate', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'A', date: '2026-06-01' })] })
  const feed = result.files.get('en/feed.xml').body.toString()
  assert.match(feed, /<link>https:\/\/example\.test\/en\/blog\/a\/<\/link>/)
  assert.match(feed, /<pubDate>[A-Z][a-z]{2}, 01 Jun 2026/)
})

test('ga4 analytics emits a self-hosted init with a sanitized measurement id', async () => {
  const result = await build({
    site: { ...site, settings: { analytics: { provider: 'ga4', id: 'G-ABC123"<script>' } } },
  })
  const analytics = result.files.get('assets/analytics.js')
  assert.ok(analytics, 'assets/analytics.js missing')
  assert.match(analytics.body.toString(), /gtag\('config','G-ABC123script'\)/)
  assert.doesNotMatch(analytics.body.toString(), /[<>"]/)
})

test('no analytics file is emitted without a ga4 configuration', async () => {
  const result = await build()
  assert.ok(!result.files.has('assets/analytics.js'))
})

test('first-party assets are content-hashed while katex fonts keep stable URLs', async () => {
  const result = await build()
  const keys = [...result.files.keys()]
  assert.ok(
    keys.some((k) => /^assets\/site-[0-9a-f]{10}\.css$/.test(k)),
    'hashed site.css missing',
  )
  assert.ok(
    keys.some((k) => /^assets\/katex\/[^/]+\.woff2$/.test(k)),
    'katex fonts missing',
  )
  const hashed = keys.filter((k) => /^assets\/(site|search|forms|mermaid-init|mermaid\.min)-/.test(k))
  for (const key of hashed) {
    assert.equal(result.files.get(key).cacheControl, 'public,max-age=31536000,immutable')
  }
})
