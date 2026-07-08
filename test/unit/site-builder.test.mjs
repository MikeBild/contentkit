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

function post({ slug, title, tags = [], noindex = false, date = '2026-06-01', body = 'Body text.' }) {
  return {
    id: `rev-${slug}`,
    item_id: `item-${slug}`,
    kind: 'post',
    locale: 'en',
    translation_key: slug,
    markdown: `---\nkind: post\ntitle: ${title}\nlocale: en\nslug: ${slug}\ntranslationKey: ${slug}\nsummary: About ${title}\ndate: ${date}\ntags: [${tags.join(', ')}]\n${noindex ? 'noindex: true\n' : ''}---\n# ${title}\n\n${body}`,
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

test('search page is noindex and stays out of the sitemap', async () => {
  const result = await build()
  assert.match(result.files.get('en/search/index.html').body.toString(), /noindex,nofollow/)
  assert.doesNotMatch(result.files.get('sitemap.xml').body.toString(), /\/en\/search\//)
})

test('every page carries the header search form and hashed search.js, and the nav omits search and contact', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'A' })] })
  for (const path of ['en/index.html', 'en/blog/a/index.html', '404.html']) {
    const html = result.files.get(path).body.toString()
    assert.match(
      html,
      /<script src="\/assets\/search-[0-9a-f]{10}\.js" defer><\/script>/,
      `search.js missing in ${path}`,
    )
    assert.match(
      html,
      /<link rel="stylesheet" href="\/assets\/site-[0-9a-f]{10}\.css">/,
      `hashed css missing in ${path}`,
    )
    assert.match(html, /<form class="site-search" role="search" method="get" action="\/en\/search\/"/, path)
    const nav = html.match(/<nav class="nav-links"[^>]*>(.*?)<\/nav>/s)[1]
    assert.doesNotMatch(nav, /\/en\/search\/|\/en\/contact\//, `nav must not link search or contact in ${path}`)
  }
})

test('the search index carries lowercased searchable text per item', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'Alpha Beta', tags: ['GaMmA'] })] })
  const index = JSON.parse(result.files.get('en/search-index.json').body.toString())
  assert.equal(index.length, 1)
  assert.equal(index[0].url, '/en/blog/a/')
  assert.match(index[0].text, /alpha beta/)
  assert.match(index[0].text, /gamma/)
})

test('the search index excludes noindex posts and omits body text by default', async () => {
  const result = await build({
    revisions: [
      post({ slug: 'public', title: 'Public', body: 'private body password phrase' }),
      post({ slug: 'hidden', title: 'Hidden', noindex: true }),
    ],
  })
  const index = JSON.parse(result.files.get('en/search-index.json').body.toString())
  assert.deepEqual(
    index.map((item) => item.url),
    ['/en/blog/public/'],
  )
  assert.doesNotMatch(index[0].text, /private body password phrase/)
})

test('the search index can opt into body text', async () => {
  const result = await build({
    site: { ...site, settings: { search: { index_body: true } } },
    revisions: [post({ slug: 'a', title: 'Alpha', body: 'Unique body phrase' })],
  })
  const index = JSON.parse(result.files.get('en/search-index.json').body.toString())
  assert.match(index[0].text, /unique body phrase/)
})

test('disabled comments omit post form assets from generated post pages', async () => {
  const result = await build({
    site: { ...site, settings: { comments: { enabled: false } } },
    revisions: [post({ slug: 'a', title: 'Alpha' })],
  })
  const page = result.files.get('en/blog/a/index.html').body.toString()
  assert.doesNotMatch(page, /\/assets\/forms-/)
  assert.doesNotMatch(page, /\/comments"/)
})

test('the RSS feed lists posts with absolute links and pubDate', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'A', date: '2026-06-01' })] })
  const feed = result.files.get('en/feed.xml').body.toString()
  assert.match(feed, /<link>https:\/\/example\.test\/en\/blog\/a\/<\/link>/)
  assert.match(feed, /<pubDate>[A-Z][a-z]{2}, 01 Jun 2026/)
})

test('consent.js is emitted as a content-hashed asset and no per-site init file remains', async () => {
  const result = await build({
    site: { ...site, settings: { analytics: { provider: 'ga4', id: 'G-ABC123' } } },
  })
  const keys = [...result.files.keys()]
  assert.ok(
    keys.some((k) => /^assets\/consent-[0-9a-f]{10}\.js$/.test(k)),
    'hashed consent.js missing',
  )
  // The gated loader replaces the old inline-free gtag init file entirely.
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
