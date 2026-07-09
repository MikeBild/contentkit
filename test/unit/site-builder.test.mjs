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

function project({ slug, title, tags = [], noindex = false }) {
  return {
    id: `rev-${slug}`,
    item_id: `item-${slug}`,
    kind: 'project',
    locale: 'en',
    translation_key: slug,
    markdown: `---\nkind: project\ntitle: ${title}\nlocale: en\nslug: ${slug}\ntranslationKey: ${slug}\nsummary: About ${title}\ntags: [${tags.join(', ')}]\n${noindex ? 'noindex: true\n' : ''}---\n# ${title}\n\nBody text.`,
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
  const result = await build({
    revisions: [post({ slug: 'a', title: 'A', tags: ['Node JS'] }), post({ slug: 'b', title: 'B', tags: ['Node JS'] })],
  })
  assert.ok(result.files.has('en/tags/node-js/index.html'), 'tag page missing')
  const tagPage = result.files.get('en/tags/node-js/index.html').body.toString()
  assert.match(tagPage, /#Node JS/, 'tag heading keeps its original spelling')
  assert.match(tagPage, /href="\/en\/tags\/node-js\/"/, 'card tag links use the same slug as the page URL')
  assert.match(result.files.get('sitemap.xml').body.toString(), /https:\/\/example\.test\/en\/tags\/node-js\//)
})

test('a one-post tag page is built but noindex,follow, unlisted and feedless', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'A', tags: ['Lonely'] })] })
  const page = result.files.get('en/tags/lonely/index.html').body.toString()
  assert.match(page, /<meta name="robots" content="noindex,follow">/, 'thin tag page must not be indexed')
  assert.doesNotMatch(page, /nofollow/, 'nofollow would strangle link equity to the post it lists')
  assert.ok(!result.files.has('en/tags/lonely/feed.xml'), 'nobody subscribes to a one-post tag')
  assert.doesNotMatch(result.files.get('sitemap.xml').body.toString(), /\/en\/tags\/lonely\//)
})

test('a tag with two posts is indexable, sitemapped and carries its own feed', async () => {
  const result = await build({
    revisions: [post({ slug: 'a', title: 'A', tags: ['React'] }), post({ slug: 'b', title: 'B', tags: ['React'] })],
  })
  const page = result.files.get('en/tags/react/index.html').body.toString()
  assert.doesNotMatch(page, /<meta name="robots"/, 'a substantial tag page must stay indexable')
  assert.match(result.files.get('sitemap.xml').body.toString(), /\/en\/tags\/react\//)

  const feed = result.files.get('en/tags/react/feed.xml')
  assert.equal(feed.contentType, 'application/rss+xml; charset=utf-8')
  assert.match(feed.body.toString(), /<atom:link rel="self"[^>]*\/en\/tags\/react\/feed\.xml"/)

  // Exactly one feed link in <head>: two would make readers guess, and they guess wrong.
  const links = page.match(/<link rel="alternate" type="application\/rss\+xml"[^>]*>/g) || []
  assert.equal(links.length, 1)
  assert.match(links[0], /href="\/en\/tags\/react\/feed\.xml"/)
})

test('the tag index exists, counts each tag and carries hreflang alternates', async () => {
  const result = await build({
    revisions: [
      post({ slug: 'a', title: 'A', tags: ['React', 'Node JS'] }),
      post({ slug: 'b', title: 'B', tags: ['React'] }),
    ],
  })
  const page = result.files.get('en/tags/index.html').body.toString()
  assert.match(page, /href="\/en\/tags\/react\/"[^>]*>React<span class="tag-count" data-facet-count>2</)
  assert.match(page, /href="\/en\/tags\/node-js\/"[^>]*>Node JS<span class="tag-count" data-facet-count>1</)
  // Unlike the individual tag pages, /tags/ exists in every locale, so it can
  // legitimately advertise alternates.
  assert.match(
    result.files.get('sitemap.xml').body.toString(),
    /<loc>https:\/\/example\.test\/en\/tags\/<\/loc><xhtml:link rel="alternate" hreflang="en"/,
  )
})

test('individual tag pages carry no hreflang alternates, because tag slugs are locale-specific', async () => {
  const result = await build({
    revisions: [post({ slug: 'a', title: 'A', tags: ['React'] }), post({ slug: 'b', title: 'B', tags: ['React'] })],
  })
  const sitemap = result.files.get('sitemap.xml').body.toString()
  const entry = sitemap.match(/<url><loc>https:\/\/example\.test\/en\/tags\/react\/<\/loc>(.*?)<\/url>/)[1]
  assert.doesNotMatch(entry, /hreflang/, 'alternates would point at slugs that do not exist in other locales')
  assert.match(entry, /<lastmod>/, 'tag pages should still report a lastmod')
})

test('the main feed carries per-tag categories and an atom self link', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'A', tags: ['React', 'Node JS'] })] })
  const feed = result.files.get('en/feed.xml').body.toString()
  assert.match(feed, /<category>React<\/category><category>Node JS<\/category>/)
  assert.match(feed, /<atom:link rel="self"[^>]*href="https:\/\/example\.test\/en\/feed\.xml"/)
  assert.doesNotMatch(feed, /lastBuildDate/, 'lastBuildDate would rehash the release on every build')
})

test('noindex posts render a page but stay out of the sitemap', async () => {
  const result = await build({ revisions: [post({ slug: 'secret', title: 'Secret', noindex: true })] })
  assert.ok(result.files.has('en/blog/secret/index.html'))
  assert.match(result.files.get('en/blog/secret/index.html').body.toString(), /noindex,nofollow/)
  assert.doesNotMatch(result.files.get('sitemap.xml').body.toString(), /\/blog\/secret\//)
})

test('noindex posts stay out of every listing, tag page and the feed', async () => {
  const result = await build({
    revisions: [
      post({ slug: 'public', title: 'Public', tags: ['Shared'] }),
      post({ slug: 'secret', title: 'Secret', tags: ['Shared'], noindex: true }),
    ],
  })
  for (const path of ['en/blog/index.html', 'en/archive/index.html', 'en/tags/shared/index.html', 'en/index.html']) {
    assert.doesNotMatch(result.files.get(path).body.toString(), /\/blog\/secret\//, `noindex post leaked into ${path}`)
  }
  assert.doesNotMatch(result.files.get('en/feed.xml').body.toString(), /\/blog\/secret\//)
  // Its own page still renders — only listings exclude it.
  assert.ok(result.files.has('en/blog/secret/index.html'))
})

test('noindex projects stay out of the home page and the projects listing', async () => {
  const result = await build({
    revisions: [
      project({ slug: 'shown', title: 'Shown' }),
      project({ slug: 'hidden', title: 'Hidden', noindex: true }),
    ],
  })
  for (const path of ['en/index.html', 'en/projects/index.html']) {
    assert.doesNotMatch(result.files.get(path).body.toString(), /\/projects\/hidden\//, `leaked into ${path}`)
    assert.match(result.files.get(path).body.toString(), /\/projects\/shown\//)
  }
})

test('projects render no tag pills, because tag pages are built from posts only', async () => {
  const result = await build({ revisions: [project({ slug: 'p', title: 'P', tags: ['Rust'] })] })
  assert.ok(!result.files.has('en/tags/rust/index.html'), 'project tags must not create tag pages')
  assert.doesNotMatch(
    result.files.get('en/projects/index.html').body.toString(),
    /\/en\/tags\/rust\//,
    'project tag pill would link to a 404',
  )
})

test('tags that slugify identically merge into one page instead of overwriting each other', async () => {
  const result = await build({
    revisions: [post({ slug: 'a', title: 'A', tags: ['Node JS'] }), post({ slug: 'b', title: 'B', tags: ['Node.js'] })],
  })
  const page = result.files.get('en/tags/node-js/index.html').body.toString()
  assert.match(page, /\/blog\/a\//, 'first spelling lost its post')
  assert.match(page, /\/blog\/b\//, 'second spelling lost its post')
  assert.match(page, /#Node JS/, 'display keeps the first-seen spelling')
})

test('a tag that slugifies to the empty string produces no file', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'A', tags: ['"###"'] })] })
  assert.ok(![...result.files.keys()].some((key) => key.includes('tags//')), 'empty tag slug wrote en/tags//index.html')
})

test('the archive nav link is marked as the current page', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'A' })] })
  const html = result.files.get('en/archive/index.html').body.toString()
  assert.match(html, /<a href="\/en\/archive\/" aria-current="page">/)
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
  const hashed = keys.filter((k) => /^assets\/(site|search|forms|mermaid-init|mermaid\.min|archive|consent)-/.test(k))
  for (const key of hashed) {
    assert.equal(result.files.get(key).cacheControl, 'public,max-age=31536000,immutable')
  }
})

test('the blog caps its feed and hands off to the archive, which lists everything', async () => {
  const revisions = Array.from({ length: 15 }, (_, i) =>
    post({ slug: `p${i}`, title: `P${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}` }),
  )
  const result = await build({ revisions })

  const blog = result.files.get('en/blog/index.html').body.toString()
  assert.equal((blog.match(/<article class="card">/g) || []).length, 12, 'blog feed must cap at 12 cards')
  assert.match(blog, /href="\/en\/archive\/"[^>]*>All 15 posts/)

  const archive = result.files.get('en/archive/index.html').body.toString()
  for (let i = 0; i < 15; i += 1) assert.match(archive, new RegExp(`/blog/p${i}/`), `archive dropped p${i}`)
})

test('the archive groups by year and ships archive.js, which the blog does not', async () => {
  const result = await build({
    revisions: [
      post({ slug: 'new', title: 'New', tags: ['React'], date: '2026-06-01' }),
      post({ slug: 'old', title: 'Old', tags: ['React'], date: '2014-03-02' }),
    ],
  })
  const archive = result.files.get('en/archive/index.html').body.toString()
  assert.match(archive, /<script src="\/assets\/archive-[0-9a-f]{10}\.js" defer><\/script>/)
  assert.match(archive, /<section data-year-group="2026">/)
  assert.match(archive, /<section data-year-group="2014">/)
  // Newest year first, and each heading carries its own count.
  assert.ok(archive.indexOf('data-year-group="2026"') < archive.indexOf('data-year-group="2014"'))
  assert.match(archive, /id="y2026">2026<span class="year-count" data-year-count>1</)
  assert.match(archive, /<li data-tags="react" data-search="[^"]*react[^"]*">/, 'filterable attributes missing')
  assert.match(archive, /2 posts, 2014–2026\./)

  assert.doesNotMatch(
    result.files.get('en/blog/index.html').body.toString(),
    /assets\/archive-/,
    'archive.js must not ship on the blog',
  )
})

test('the archive pre-folds data-search with the build locale', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'ÜBER Alpha', tags: ['GaMmA'] })] })
  const archive = result.files.get('en/archive/index.html').body.toString()
  const haystack = archive.match(/data-search="([^"]*)"/)[1]
  assert.equal(haystack, haystack.toLowerCase(), 'data-search must be pre-lowercased for the client fold')
  assert.match(haystack, /über alpha/)
  assert.match(haystack, /gamma/)
})

test('the post-age notice appears past three years and updated_at suppresses it', async () => {
  const now = new Date('2026-07-08T00:00:00Z')
  const aged = await build({ revisions: [post({ slug: 'a', title: 'A', date: '2022-01-01' })], now })
  assert.match(
    aged.files.get('en/blog/a/index.html').body.toString(),
    /<aside class="callout callout-warning post-age" role="note">This post is over 4 years old\./,
  )

  const fresh = await build({ revisions: [post({ slug: 'b', title: 'B', date: '2026-01-01' })], now })
  assert.doesNotMatch(fresh.files.get('en/blog/b/index.html').body.toString(), /post-age/)

  // Same old publication date, but revised last year: no notice, and the header
  // reports the revision instead.
  const revised = post({ slug: 'c', title: 'C', date: '2022-01-01' })
  revised.markdown = revised.markdown.replace('date: 2022-01-01', 'date: 2022-01-01\nupdatedAt: 2025-09-01')
  const updated = await build({ revisions: [revised], now })
  const html = updated.files.get('en/blog/c/index.html').body.toString()
  assert.doesNotMatch(html, /post-age/, 'updated_at is the evergreen suppressor')
  assert.match(html, /Updated: /)
})

test('reading time is rendered for posts and derived from prose, not code', async () => {
  const prose = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ')
  const code = Array.from({ length: 9000 }, (_, i) => `tok${i}`).join(' ')
  const result = await build({
    revisions: [post({ slug: 'a', title: 'A', body: `${prose}\n\n\`\`\`js\n${code}\n\`\`\`` })],
  })
  // ~603 prose words (title + summary included) -> 3 minutes; the fence is ignored.
  assert.match(result.files.get('en/blog/a/index.html').body.toString(), /≈ 3 min read/)
})

test('posts link to their older and newer neighbours, labelled by chronology', async () => {
  const result = await build({
    revisions: [
      post({ slug: 'old', title: 'Old', date: '2026-01-01' }),
      post({ slug: 'mid', title: 'Mid', date: '2026-02-01' }),
      post({ slug: 'new', title: 'New', date: '2026-03-01' }),
    ],
  })
  const mid = result.files.get('en/blog/mid/index.html').body.toString()
  assert.match(mid, /rel="prev" href="\/en\/blog\/old\/"/, 'rel=prev must point at the older post')
  assert.match(mid, /rel="next" href="\/en\/blog\/new\/"/, 'rel=next must point at the newer post')
  assert.match(mid, /Older post/)
  assert.match(mid, /Newer post/)

  // The newest post has no newer neighbour.
  assert.doesNotMatch(result.files.get('en/blog/new/index.html').body.toString(), /rel="next"/)
})

test('related posts prefer rare tag overlap and ignore universal tags', async () => {
  const revisions = [
    post({ slug: 'target', title: 'Target', tags: ['Software', 'Effect TS'] }),
    post({ slug: 'rare', title: 'Rare', tags: ['Software', 'Effect TS'] }),
    post({ slug: 'common1', title: 'Common1', tags: ['Software'] }),
    post({ slug: 'common2', title: 'Common2', tags: ['Software'] }),
    post({ slug: 'common3', title: 'Common3', tags: ['Software'] }),
  ]
  const result = await build({ revisions })
  const page = result.files.get('en/blog/target/index.html').body.toString()
  const related = page.match(/<nav class="related"[\s\S]*?<\/nav>/)[0]
  assert.match(related, /\/en\/blog\/rare\//, 'the rare-tag neighbour must be related')
  assert.doesNotMatch(related, /\/en\/blog\/common1\//, 'a tag on every post carries no signal')

  // A post whose only tag is universal has a zero vector: no related section at all.
  assert.doesNotMatch(result.files.get('en/blog/common1/index.html').body.toString(), /class="related"/)
})

test('builds are reproducible: the same now yields byte-identical html', async () => {
  const now = new Date('2026-07-08T00:00:00Z')
  const revisions = [post({ slug: 'a', title: 'A', tags: ['React'] })]
  const first = await build({ revisions, now })
  const second = await build({ revisions: [post({ slug: 'a', title: 'A', tags: ['React'] })], now })
  for (const path of ['en/index.html', 'en/archive/index.html', 'en/blog/a/index.html']) {
    assert.equal(first.files.get(path).body.toString(), second.files.get(path).body.toString(), `${path} is unstable`)
  }
  assert.match(first.files.get('en/index.html').body.toString(), /© 2026 Example/)
})

test('the site publishes its own llms.txt, per locale and at the root', async () => {
  const result = await build({
    site: { ...site, default_locale: 'en' },
    locales: [{ locale: 'en' }, { locale: 'de' }],
    revisions: [post({ slug: 'a', title: 'Alpha', tags: ['React'] })],
  })
  for (const path of ['llms.txt', 'en/llms.txt', 'de/llms.txt', 'llms-full.txt', 'en/llms-full.txt']) {
    assert.ok(result.files.has(path), `missing ${path}`)
    assert.equal(result.files.get(path).contentType, 'text/plain; charset=utf-8')
  }
  // The root file is the default locale's, verbatim.
  assert.deepEqual(result.files.get('llms.txt').body, result.files.get('en/llms.txt').body)

  const llms = result.files.get('en/llms.txt').body.toString()
  // Spec shape: single H1, then a blockquote summary, then H2 file lists.
  assert.match(llms, /^# Example\n\n> Personal site\n/)
  assert.match(llms, /\n## Blog\n\n- \[Alpha\]\(https:\/\/example\.test\/en\/blog\/a\/\): About Alpha\n/)
  // "Optional" is a spec keyword — consumers may skip these URLs for a shorter
  // context — so it must not be localised, and the other locale belongs under it.
  assert.match(llms, /\n## Optional\n/)
  assert.match(llms, /- \[de\]\(https:\/\/example\.test\/de\/llms\.txt\)/)
  assert.doesNotMatch(result.files.get('de/llms.txt').body.toString(), /## Optional[\s\S]*\/de\/llms\.txt/)
})

test('llms-full.txt carries the authored markdown, minus the duplicated title heading', async () => {
  const result = await build({
    revisions: [post({ slug: 'a', title: 'Alpha', body: 'Body prose.\n\n```js\nconst x = 1\n```' })],
  })
  const full = result.files.get('en/llms-full.txt').body.toString()
  assert.match(full, /^# Example\n\n> Personal site\n/)
  // A horizontal rule opens each document: a body's own `## Section` is otherwise
  // indistinguishable from the next document's title.
  assert.match(full, /\n---\n\n## Alpha\n\nURL: https:\/\/example\.test\/en\/blog\/a\/\n\nBody prose\./)
  assert.match(full, /```js\nconst x = 1\n```/, 'the markdown source must survive verbatim')
  // The post fixture opens with `# Alpha`; only the emitted `## Alpha` remains.
  assert.equal((full.match(/Alpha/g) || []).length, 1)
  // Exactly one H1 in the whole file.
  assert.equal((full.match(/^# /gm) || []).length, 1)
})

test('noindex content stays out of llms.txt and llms-full.txt', async () => {
  const result = await build({
    revisions: [
      post({ slug: 'public', title: 'Public' }),
      post({ slug: 'secret', title: 'Secret', noindex: true, body: 'classified prose' }),
    ],
  })
  for (const path of ['llms.txt', 'en/llms.txt', 'llms-full.txt', 'en/llms-full.txt']) {
    const body = result.files.get(path).body.toString()
    assert.doesNotMatch(body, /Secret|classified prose/, `noindex content leaked into ${path}`)
    assert.match(body, /Public/)
  }
})

test('a post with read-aloud audio renders the player and loads audio assets; others do not', async () => {
  const audio = [
    {
      item_id: 'item-a',
      url: '/media/asset-1/a-vorlesen.mp3',
      content_type: 'audio/mpeg',
      byte_size: 1234,
      duration_secs: 300,
    },
  ]
  const result = await build({
    site: { ...site, settings: { audio: { enabled: true } } },
    revisions: [post({ slug: 'a', title: 'A' }), post({ slug: 'b', title: 'B' })],
    audio,
  })
  const withPlayer = result.files.get('en/blog/a/index.html').body.toString()
  assert.match(withPlayer, /class="audio-player" data-audio="\/media\/asset-1\/a-vorlesen\.mp3"/)
  assert.match(withPlayer, /<audio controls preload="none" src="\/media\/asset-1\/a-vorlesen\.mp3">/)
  assert.match(withPlayer, /Listen to this post \(5 min\)/)
  assert.match(withPlayer, /assets\/audio-[0-9a-f]{10}\.js/, 'audio.js must load on the player page')
  assert.match(withPlayer, /assets\/audio-[0-9a-f]{10}\.css/, 'audio.css must load on the player page')
  const withoutPlayer = result.files.get('en/blog/b/index.html').body.toString()
  assert.doesNotMatch(withoutPlayer, /audio-player|assets\/audio-/, 'a post without audio must not pay for the player')
})

test('podcast.xml lists only posts with audio, with enclosure and itunes tags, and needs the opt-in', async () => {
  const audio = [
    {
      item_id: 'item-a',
      url: '/media/asset-1/a-vorlesen.mp3',
      content_type: 'audio/mpeg',
      byte_size: 1234,
      duration_secs: 300,
    },
  ]
  const revisions = [
    post({ slug: 'a', title: 'A', date: '2026-06-02' }),
    post({ slug: 'b', title: 'B', date: '2026-06-01' }),
  ]
  const enabled = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions, audio })
  const feed = enabled.files.get('en/podcast.xml').body.toString()
  assert.equal(enabled.files.get('en/podcast.xml').contentType, 'application/rss+xml; charset=utf-8')
  assert.match(feed, /xmlns:itunes="http:\/\/www\.itunes\.com\/dtds\/podcast-1\.0\.dtd"/)
  assert.match(
    feed,
    /<enclosure url="https:\/\/example\.test\/media\/asset-1\/a-vorlesen\.mp3" type="audio\/mpeg" length="1234"\/>/,
  )
  assert.match(feed, /<itunes:duration>300<\/itunes:duration>/)
  assert.doesNotMatch(feed, /<item><title>B<\/title>/, 'a post without audio must not be a podcast item')
  assert.doesNotMatch(feed, /lastBuildDate/, 'release bytes must be reproducible')

  const optedOut = await build({ site, revisions, audio })
  assert.ok(!optedOut.files.has('en/podcast.xml'), 'no podcast feed without settings.audio.enabled')
  const noAudio = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions })
  assert.ok(!noAudio.files.has('en/podcast.xml'), 'no podcast feed without a single audio post')
})

test('the player offers a quiet localized MP3 download link', async () => {
  const audio = [
    {
      item_id: 'item-a',
      url: '/media/asset-1/a-vorlesen.mp3',
      content_type: 'audio/mpeg',
      byte_size: 1234,
      duration_secs: 300,
    },
  ]
  const result = await build({
    site: { ...site, settings: { audio: { enabled: true } } },
    revisions: [post({ slug: 'a', title: 'A' })],
    audio,
  })
  assert.match(
    result.files.get('en/blog/a/index.html').body.toString(),
    /<a class="audio-player-download" href="\/media\/asset-1\/a-vorlesen\.mp3" download>Download MP3<\/a>/,
  )
})

test('podcast channel carries optional itunes:image and itunes:category, and language from the locale', async () => {
  const audio = [
    {
      item_id: 'item-a',
      url: '/media/asset-1/a-vorlesen.mp3',
      content_type: 'audio/mpeg',
      byte_size: 1234,
      duration_secs: 300,
    },
  ]
  const revisions = [post({ slug: 'a', title: 'A' })]
  const configured = await build({
    site: {
      ...site,
      settings: {
        audio: {
          enabled: true,
          podcast_image: 'https://example.test/cover-3000.jpg',
          podcast_category: 'Technology',
        },
      },
    },
    revisions,
    audio,
  })
  const feed = configured.files.get('en/podcast.xml').body.toString()
  assert.match(feed, /<itunes:image href="https:\/\/example\.test\/cover-3000\.jpg"\/>/)
  assert.match(feed, /<itunes:category text="Technology"\/>/)
  assert.match(feed, /<language>en<\/language>/)

  const plain = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions, audio })
  assert.doesNotMatch(
    plain.files.get('en/podcast.xml').body.toString(),
    /itunes:image|itunes:category/,
    'unconfigured channel art must not emit empty tags',
  )
})

test('the layout advertises podcast.xml only with the podcast_link opt-in', async () => {
  const audio = [
    {
      item_id: 'item-a',
      url: '/media/asset-1/a-vorlesen.mp3',
      content_type: 'audio/mpeg',
      byte_size: 1234,
      duration_secs: 300,
    },
  ]
  const revisions = [post({ slug: 'a', title: 'A' })]
  const linked = await build({
    site: { ...site, settings: { audio: { enabled: true, podcast_link: true } } },
    revisions,
    audio,
  })
  assert.match(
    linked.files.get('en/index.html').body.toString(),
    /<link rel="alternate" type="application\/rss\+xml" title="Example · Podcast" href="\/en\/podcast\.xml">/,
  )
  const unlinked = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions, audio })
  assert.doesNotMatch(unlinked.files.get('en/index.html').body.toString(), /podcast\.xml/)
})

test('frontmatter audio: false suppresses the player even when an asset exists', async () => {
  const audio = [
    {
      item_id: 'item-a',
      url: '/media/asset-1/a-vorlesen.mp3',
      content_type: 'audio/mpeg',
      byte_size: 1234,
      duration_secs: 300,
    },
  ]
  const optedOut = {
    ...post({ slug: 'a', title: 'A' }),
    markdown: `---\nkind: post\ntitle: A\nlocale: en\nslug: a\ntranslationKey: a\nsummary: About A\ndate: 2026-06-01\naudio: false\n---\nBody text.`,
  }
  const result = await build({
    site: { ...site, settings: { audio: { enabled: true } } },
    revisions: [optedOut],
    audio,
  })
  assert.doesNotMatch(result.files.get('en/blog/a/index.html').body.toString(), /audio-player/)
  assert.ok(!result.files.has('en/podcast.xml'))
})

test('the podcast page is built under the same gate as podcast.xml and listed in the sitemap', async () => {
  const audio = [
    {
      item_id: 'item-a',
      url: '/media/asset-1/a-vorlesen.mp3',
      content_type: 'audio/mpeg',
      byte_size: 1234,
      duration_secs: 300,
    },
  ]
  const revisions = [
    post({ slug: 'a', title: 'A', date: '2026-06-02' }),
    post({ slug: 'b', title: 'B', date: '2026-06-01' }),
  ]
  // No podcast_link: the page is content, only the *advertising* is opt-in.
  const enabled = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions, audio })
  assert.ok(enabled.files.has('en/podcast/index.html'), 'podcast page missing despite a narrated post')
  const page = enabled.files.get('en/podcast/index.html').body.toString()
  assert.match(page, /<link rel="canonical" href="https:\/\/example\.test\/en\/podcast\/">/)
  assert.doesNotMatch(page, /<meta name="robots"/, 'the podcast page must stay indexable')
  assert.match(page, /href="\/en\/podcast\.xml"/, 'the page must offer the RSS subscribe link')
  assert.match(page, /class="audio-player" data-audio="\/media\/asset-1\/a-vorlesen\.mp3"/)
  assert.match(page, /<audio controls preload="none" src="\/media\/asset-1\/a-vorlesen\.mp3">/)
  assert.match(page, /data-audio-ui/, 'the custom control bar must ship in the markup')
  assert.match(page, /assets\/audio-[0-9a-f]{10}\.js/, 'audio.js must load on the podcast page')
  assert.match(page, /assets\/audio-[0-9a-f]{10}\.css/, 'audio.css must load on the podcast page')
  assert.match(page, /<a href="\/en\/blog\/a\/">A<\/a>/, 'episode titles link to the post')
  assert.doesNotMatch(page, /\/en\/blog\/b\//, 'a post without audio is not an episode')
  assert.match(enabled.files.get('sitemap.xml').body.toString(), /<loc>https:\/\/example\.test\/en\/podcast\/<\/loc>/)

  const optedOut = await build({ site, revisions, audio })
  assert.ok(!optedOut.files.has('en/podcast/index.html'), 'no podcast page without settings.audio.enabled')
  const noAudio = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions })
  assert.ok(!noAudio.files.has('en/podcast/index.html'), 'no podcast page without a single audio post')
  assert.doesNotMatch(noAudio.files.get('sitemap.xml').body.toString(), /\/en\/podcast\//)
})

test('the podcast page header uses the channel settings, and the footer links the page with the opt-in', async () => {
  const audio = [
    {
      item_id: 'item-a',
      url: '/media/asset-1/a-vorlesen.mp3',
      content_type: 'audio/mpeg',
      byte_size: 1234,
      duration_secs: 300,
    },
  ]
  const revisions = [post({ slug: 'a', title: 'A' })]
  const configured = await build({
    site: {
      ...site,
      settings: {
        audio: {
          enabled: true,
          podcast_link: true,
          title: 'My Podcast',
          description: 'Narrated posts',
          podcast_image: 'https://example.test/cover-3000.jpg',
        },
      },
    },
    revisions,
    audio,
  })
  const page = configured.files.get('en/podcast/index.html').body.toString()
  assert.match(page, /<h1>My Podcast<\/h1>/)
  assert.match(page, /Narrated posts/)
  assert.match(page, /<img class="podcast-cover" src="https:\/\/example\.test\/cover-3000\.jpg" alt="My Podcast"/)
  assert.match(page, /<title>My Podcast · Example<\/title>/)
  // The footer's Podcast item now targets the page; the head <link> keeps
  // advertising the feed itself.
  const footer = page.slice(page.indexOf('<footer class="site-footer">'))
  assert.match(footer, /<a href="\/en\/podcast\/">Podcast<\/a>/)
  assert.match(page, /<link rel="alternate" type="application\/rss\+xml" title="My Podcast" href="\/en\/podcast\.xml">/)

  // Without the opt-in the page still exists but stays unadvertised.
  const unlinked = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions, audio })
  assert.ok(unlinked.files.has('en/podcast/index.html'))
  const home = unlinked.files.get('en/index.html').body.toString()
  assert.doesNotMatch(home, /\/en\/podcast\//, 'no footer link without podcast_link')
})
