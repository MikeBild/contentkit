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

function post({ slug, title, tags = [], noindex = false, date = '2026-06-01', body = 'Body text.', extra = '' }) {
  return {
    id: `rev-${slug}`,
    item_id: `item-${slug}`,
    kind: 'post',
    locale: 'en',
    translation_key: slug,
    markdown: `---\nkind: post\ntitle: ${title}\nlocale: en\nslug: ${slug}\ntranslationKey: ${slug}\nsummary: About ${title}\ndate: ${date}\ntags: [${tags.join(', ')}]\n${noindex ? 'noindex: true\n' : ''}${extra}---\n# ${title}\n\n${body}`,
  }
}

// Frontmatter for the authored reader aids, reused across the tests below.
const TLDR_FAQ = 'tldr:\n  - First takeaway.\n  - Second takeaway.\nfaq:\n  - q: What is Alpha?\n    a: A test post.\n'

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

test('every indexable post gets a Markdown twin, advertised from the page head', async () => {
  const result = await build({
    revisions: [
      post({ slug: 'a', title: 'Alpha', extra: TLDR_FAQ, body: 'Body prose.' }),
      post({ slug: 'secret', title: 'Secret', noindex: true }),
    ],
  })
  const twin = result.files.get('en/blog/a/index.md')
  assert.ok(twin, 'index.md missing')
  assert.equal(twin.contentType, 'text/markdown; charset=utf-8')
  // Same block as llms-full.txt: title heading, canonical URL, TL;DR, body —
  // with the duplicated leading H1 dropped.
  assert.match(
    twin.body.toString(),
    /^# Alpha\n\nURL: https:\/\/example\.test\/en\/blog\/a\/\n\n- First takeaway\.\n- Second takeaway\.\n\nBody prose\.\n$/,
  )
  assert.match(
    result.files.get('en/blog/a/index.html').body.toString(),
    /<link rel="alternate" type="text\/markdown" href="\/en\/blog\/a\/index\.md">/,
  )

  // A draft's HTML page at least carries a robots meta; a bare .md could not.
  assert.ok(!result.files.has('en/blog/secret/index.md'), 'noindex post must not get a Markdown twin')
  assert.doesNotMatch(result.files.get('en/blog/secret/index.html').body.toString(), /text\/markdown/)
})

test('llms-full.txt carries the authored TL;DR bullets', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'Alpha', extra: TLDR_FAQ })] })
  assert.match(
    result.files.get('en/llms-full.txt').body.toString(),
    /## Alpha\n\nURL: https:\/\/example\.test\/en\/blog\/a\/\n\n- First takeaway\./,
  )
})

test('post JSON-LD carries the posting details, breadcrumbs and the authored FAQ', async () => {
  const audio = [
    { item_id: 'item-a', url: '/media/a.mp3', content_type: 'audio/mpeg', byte_size: 1, duration_secs: 300 },
  ]
  const result = await build({
    site: { ...site, settings: { audio: { enabled: true } } },
    revisions: [post({ slug: 'a', title: 'Alpha', tags: ['React'], extra: TLDR_FAQ })],
    audio,
  })
  const html = result.files.get('en/blog/a/index.html').body.toString()
  const structured = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])
  assert.deepEqual(
    structured.map((entry) => entry['@type']),
    ['BlogPosting', 'BreadcrumbList', 'FAQPage'],
  )
  const [posting, breadcrumbs, faq] = structured
  assert.equal(posting.inLanguage, 'en')
  assert.equal(posting.keywords, 'React')
  assert.equal(posting.abstract, 'First takeaway. Second takeaway.')
  assert.equal(posting.mainEntityOfPage, 'https://example.test/en/blog/a/')
  assert.match(posting.timeRequired, /^PT\d+M$/)
  assert.equal(posting.audio.contentUrl, 'https://example.test/media/a.mp3')
  assert.equal(posting.audio.duration, 'PT300S')
  assert.equal(breadcrumbs.itemListElement.length, 3)
  assert.equal(breadcrumbs.itemListElement[1].item, 'https://example.test/en/blog/')
  assert.equal(faq.mainEntity[0].name, 'What is Alpha?')
  assert.equal(faq.mainEntity[0].acceptedAnswer.text, 'A test post.')
})

test('the AI share row offers markdown, copy and deep links, and honours the per-site opt-out', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'Alpha' })] })
  const html = result.files.get('en/blog/a/index.html').body.toString()
  assert.match(html, /<a class="tag ai-action" href="\/en\/blog\/a\/index\.md" type="text\/markdown">Markdown<\/a>/)
  // The copy button ships hidden: without ai-actions.js it could do nothing.
  assert.match(
    html,
    /<button type="button" class="tag ai-action" data-copy-markdown="\/en\/blog\/a\/index\.md" data-copied="Copied" hidden>Copy Markdown<\/button>/,
  )
  const prompt = encodeURIComponent(
    'Read this article and answer my questions about it: https://example.test/en/blog/a/',
  )
  assert.ok(html.includes(`href="https://claude.ai/new?q=${prompt}"`), 'Claude deep link missing')
  assert.ok(html.includes(`href="https://chatgpt.com/?q=${prompt}"`), 'ChatGPT deep link missing')
  assert.match(html, /assets\/ai-actions-[0-9a-f]{10}\.js/, 'ai-actions.js must load on a page with a copy button')
  // Pages without the row must not pay for its script.
  assert.doesNotMatch(result.files.get('en/index.html').body.toString(), /ai-actions-/)

  const optedOut = await build({
    site: { ...site, settings: { ai: { share_buttons: false } } },
    revisions: [post({ slug: 'a', title: 'Alpha' })],
  })
  const quiet = optedOut.files.get('en/blog/a/index.html').body.toString()
  assert.doesNotMatch(quiet, /ai-action|claude\.ai|chatgpt\.com/, 'share_buttons: false must hide the row')
  // The Markdown twin itself stays: it is GEO surface, not UI.
  assert.ok(optedOut.files.has('en/blog/a/index.md'))
})

test('the blog index promotes the RSS feed and ships the clipboard module, opt-out removes both', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'Alpha' })] })
  const blog = result.files.get('en/blog/index.html').body.toString()
  assert.match(blog, /<a class="subscribe-button" href="\/en\/feed\.xml">Subscribe via RSS<\/a>/)
  assert.match(blog, /data-copy-feed="https:\/\/example\.test\/en\/feed\.xml"/)
  assert.match(blog, /assets\/ai-actions-[0-9a-f]{10}\.js/, 'the copy button needs the clipboard module')

  const off = await build({
    site: { ...site, settings: { blog: { subscribe_row: false } } },
    revisions: [post({ slug: 'a', title: 'Alpha' })],
  })
  const quiet = off.files.get('en/blog/index.html').body.toString()
  assert.doesNotMatch(quiet, /subscribe-row|data-copy-feed/, 'subscribe_row: false must remove the row')
  assert.doesNotMatch(quiet, /ai-actions-/, 'a blog index without the row must not pay for the script')
})

test('feedback-enabled sites ship the widget and its script on post pages only', async () => {
  const enabled = await build({
    site: { ...site, settings: { feedback: { enabled: true } } },
    revisions: [post({ slug: 'a', title: 'Alpha' })],
  })
  const page = enabled.files.get('en/blog/a/index.html').body.toString()
  assert.match(page, /Was this post helpful\?/)
  assert.match(page, /assets\/feedback-[0-9a-f]{10}\.js/, 'feedback.js must load with the widget')
  assert.doesNotMatch(
    enabled.files.get('en/index.html').body.toString(),
    /feedback-.*\.js|post-feedback/,
    'non-post pages must not pay for the widget',
  )

  const off = await build({ revisions: [post({ slug: 'a', title: 'Alpha' })] })
  const quiet = off.files.get('en/blog/a/index.html').body.toString()
  assert.doesNotMatch(quiet, /post-feedback|assets\/feedback-/, 'feedback is opt-in')
})

test('the blogcast page ships the clipboard module for its copy-feed-URL button', async () => {
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
  const page = result.files.get('en/blogcast/index.html').body.toString()
  assert.match(page, /assets\/audio-[0-9a-f]{10}\.js/)
  assert.match(page, /assets\/ai-actions-[0-9a-f]{10}\.js/, 'the copy button needs the clipboard module')
  assert.match(page, /data-copy-feed="https:\/\/example\.test\/en\/blogcast\.xml"/)
  assert.match(page, /href="podcast:\/\/example\.test\/en\/blogcast\.xml"/, 'Apple Podcasts deep link missing')
})

test('authored tldr and faq render as details blocks and reach the search index', async () => {
  const result = await build({ revisions: [post({ slug: 'a', title: 'Alpha', extra: TLDR_FAQ })] })
  const html = result.files.get('en/blog/a/index.html').body.toString()
  assert.match(html, /<details class="post-tldr" open><summary>In short<\/summary><ul><li>First takeaway\.<\/li>/)
  assert.match(
    html,
    /<section class="post-faq"><h2>FAQ<\/h2><details class="post-faq-item"><summary>What is Alpha\?<\/summary><p>A test post\.<\/p><\/details><\/section>/,
  )
  const index = JSON.parse(result.files.get('en/search-index.json').body.toString())
  assert.match(index[0].text, /first takeaway/)

  const plain = await build({ revisions: [post({ slug: 'b', title: 'Beta' })] })
  const bare = plain.files.get('en/blog/b/index.html').body.toString()
  assert.doesNotMatch(bare, /post-tldr|post-faq/, 'no empty reader-aid blocks without frontmatter')
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

test('blogcast.xml lists only posts with audio, with enclosure and itunes tags, and needs the opt-in', async () => {
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
  const feed = enabled.files.get('en/blogcast.xml').body.toString()
  assert.equal(enabled.files.get('en/blogcast.xml').contentType, 'application/rss+xml; charset=utf-8')
  assert.match(feed, /xmlns:itunes="http:\/\/www\.itunes\.com\/dtds\/podcast-1\.0\.dtd"/)
  assert.match(
    feed,
    /<enclosure url="https:\/\/example\.test\/media\/asset-1\/a-vorlesen\.mp3" type="audio\/mpeg" length="1234"\/>/,
  )
  assert.match(feed, /<itunes:duration>300<\/itunes:duration>/)
  assert.doesNotMatch(feed, /<item><title>B<\/title>/, 'a post without audio must not be a blogcast item')
  assert.doesNotMatch(feed, /lastBuildDate/, 'release bytes must be reproducible')

  const optedOut = await build({ site, revisions, audio })
  assert.ok(!optedOut.files.has('en/blogcast.xml'), 'no blogcast feed without settings.audio.enabled')
  const noAudio = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions })
  assert.ok(!noAudio.files.has('en/blogcast.xml'), 'no blogcast feed without a single audio post')
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

test('blogcast channel carries optional itunes:image and itunes:category, and language from the locale', async () => {
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
          blogcast_image: 'https://example.test/cover-3000.jpg',
          blogcast_category: 'Technology',
        },
      },
    },
    revisions,
    audio,
  })
  const feed = configured.files.get('en/blogcast.xml').body.toString()
  assert.match(feed, /<itunes:image href="https:\/\/example\.test\/cover-3000\.jpg"\/>/)
  assert.match(feed, /<itunes:category text="Technology"\/>/)
  assert.match(feed, /<language>en<\/language>/)

  const plain = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions, audio })
  assert.doesNotMatch(
    plain.files.get('en/blogcast.xml').body.toString(),
    /itunes:image|itunes:category/,
    'unconfigured channel art must not emit empty tags',
  )
})

test('the layout advertises blogcast.xml only with the blogcast_link opt-in', async () => {
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
    site: { ...site, settings: { audio: { enabled: true, blogcast_link: true } } },
    revisions,
    audio,
  })
  assert.match(
    linked.files.get('en/index.html').body.toString(),
    /<link rel="alternate" type="application\/rss\+xml" title="Example · Blogcast" href="\/en\/blogcast\.xml">/,
  )
  const unlinked = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions, audio })
  assert.doesNotMatch(unlinked.files.get('en/index.html').body.toString(), /blogcast\.xml/)
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
  assert.ok(!result.files.has('en/blogcast.xml'))
})

test('the blogcast page is built under the same gate as blogcast.xml and listed in the sitemap', async () => {
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
  // No blogcast_link: the page is content, only the *advertising* is opt-in.
  const enabled = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions, audio })
  assert.ok(enabled.files.has('en/blogcast/index.html'), 'blogcast page missing despite a narrated post')
  const page = enabled.files.get('en/blogcast/index.html').body.toString()
  assert.match(page, /<link rel="canonical" href="https:\/\/example\.test\/en\/blogcast\/">/)
  assert.doesNotMatch(page, /<meta name="robots"/, 'the blogcast page must stay indexable')
  assert.match(page, /href="\/en\/blogcast\.xml"/, 'the page must offer the RSS subscribe link')
  assert.match(page, /class="audio-player" data-audio="\/media\/asset-1\/a-vorlesen\.mp3"/)
  assert.match(page, /<audio controls preload="none" src="\/media\/asset-1\/a-vorlesen\.mp3">/)
  assert.match(page, /data-audio-ui/, 'the custom control bar must ship in the markup')
  assert.match(page, /assets\/audio-[0-9a-f]{10}\.js/, 'audio.js must load on the blogcast page')
  assert.match(page, /assets\/audio-[0-9a-f]{10}\.css/, 'audio.css must load on the blogcast page')
  assert.match(page, /<a href="\/en\/blog\/a\/">A<\/a>/, 'episode titles link to the post')
  assert.doesNotMatch(page, /\/en\/blog\/b\//, 'a post without audio is not an episode')
  assert.match(enabled.files.get('sitemap.xml').body.toString(), /<loc>https:\/\/example\.test\/en\/blogcast\/<\/loc>/)

  const optedOut = await build({ site, revisions, audio })
  assert.ok(!optedOut.files.has('en/blogcast/index.html'), 'no blogcast page without settings.audio.enabled')
  const noAudio = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions })
  assert.ok(!noAudio.files.has('en/blogcast/index.html'), 'no blogcast page without a single audio post')
  assert.doesNotMatch(noAudio.files.get('sitemap.xml').body.toString(), /\/en\/blogcast\//)
})

test('the blogcast page header uses the channel settings, and the footer links the page with the opt-in', async () => {
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
          blogcast_link: true,
          title: 'My Blogcast',
          description: 'Narrated posts',
          blogcast_image: 'https://example.test/cover-3000.jpg',
        },
      },
    },
    revisions,
    audio,
  })
  const page = configured.files.get('en/blogcast/index.html').body.toString()
  assert.match(page, /<h1>My Blogcast<\/h1>/)
  assert.match(page, /Narrated posts/)
  assert.match(page, /<img class="blogcast-cover" src="https:\/\/example\.test\/cover-3000\.jpg" alt="My Blogcast"/)
  assert.match(page, /<title>My Blogcast · Example<\/title>/)
  // The footer's Blogcast item now targets the page; the head <link> keeps
  // advertising the feed itself.
  const footer = page.slice(page.indexOf('<footer class="site-footer">'))
  assert.match(footer, /<a href="\/en\/blogcast\/">Blogcast<\/a>/)
  assert.match(
    page,
    /<link rel="alternate" type="application\/rss\+xml" title="My Blogcast" href="\/en\/blogcast\.xml">/,
  )

  // Without the opt-in the page still exists but stays unadvertised.
  const unlinked = await build({ site: { ...site, settings: { audio: { enabled: true } } }, revisions, audio })
  assert.ok(unlinked.files.has('en/blogcast/index.html'))
  const home = unlinked.files.get('en/index.html').body.toString()
  assert.doesNotMatch(home, /\/en\/blogcast\//, 'no footer link without blogcast_link')
})

test('authored related references lead the block and tag similarity fills up to three', async () => {
  const result = await build({
    revisions: [
      // `standalone` shares no tag with `target`: similarity alone would never
      // recommend it, so its position proves the authored reference.
      post({ slug: 'target', title: 'Target', tags: ['Shared', 'Rare'], extra: 'related: [standalone]\n' }),
      post({ slug: 'standalone', title: 'Standalone', tags: ['Elsewhere'] }),
      post({ slug: 'similar', title: 'Similar', tags: ['Shared', 'Rare'] }),
    ],
  })
  const page = result.files.get('en/blog/target/index.html').body.toString()
  const related = page.match(/<nav class="related"[\s\S]*?<\/nav>/)[0]
  assert.match(related, /\/en\/blog\/standalone\//, 'the authored reference must be related')
  assert.match(related, /\/en\/blog\/similar\//, 'tag similarity must fill the remaining slots')
  assert.ok(
    related.indexOf('/en/blog/standalone/') < related.indexOf('/en/blog/similar/'),
    'authored references come first, in the author’s order',
  )
})

test('a related reference that resolves to no published post is dropped with a warning, never a failure', async () => {
  const warnings = []
  const result = await build({
    logger: { warn: (message, meta) => warnings.push({ message, meta }) },
    revisions: [
      post({ slug: 'target', title: 'Target', tags: ['Shared'], extra: 'related: [missing-post, hidden]\n' }),
      post({ slug: 'hidden', title: 'Hidden', noindex: true }),
      post({ slug: 'other', title: 'Other', tags: ['Shared'] }),
    ],
  })
  const page = result.files.get('en/blog/target/index.html').body.toString()
  assert.doesNotMatch(page, /missing-post/, 'a broken reference must not render')
  assert.doesNotMatch(page, /\/en\/blog\/hidden\//, 'a noindex post must never be recommended')
  // Both unresolvable references warn: the never-published one and the draft.
  assert.equal(warnings.length, 2)
  assert.equal(warnings[0].message, 'related reference not found')
  assert.deepEqual(
    warnings.map((entry) => entry.meta.related),
    ['missing-post', 'hidden'],
  )
})

test('a stored revision with malformed extra/related builds with a warning, never a failed release', async () => {
  // Pre-WP2 documents could carry these keys in any shape (they were silently
  // dropped then, so the revision is published) — a later release replays them
  // through renderMarkdown and must not fail.
  const warnings = []
  const result = await build({
    logger: { warn: (message, meta) => warnings.push({ message, meta }) },
    revisions: [
      post({ slug: 'legacy', title: 'Legacy', extra: 'extra: yes\nrelated: see-also\n' }),
      post({ slug: 'other', title: 'Other' }),
    ],
  })
  assert.ok(result.files.get('en/blog/legacy/index.html'), 'the document still builds')
  assert.deepEqual(
    warnings.map((entry) => entry.message.split(':')[0]),
    ['frontmatter extra dropped', 'frontmatter related dropped'],
  )
  assert.equal(warnings[0].meta.slug, 'legacy')
})

test('extra fields surface in HTML, the Markdown twin and llms-full.txt only behind show_extra', async () => {
  const revisions = () => [post({ slug: 'a', title: 'Alpha', extra: 'extra:\n  series: effect-ts\n  level: 3\n' })]
  // Default off: the authored fields stay data, invisible on every surface.
  const quiet = await build({ revisions: revisions() })
  assert.doesNotMatch(quiet.files.get('en/blog/a/index.html').body.toString(), /extra-fields|effect-ts/)
  assert.doesNotMatch(quiet.files.get('en/blog/a/index.md').body.toString(), /series/)
  assert.doesNotMatch(quiet.files.get('en/llms-full.txt').body.toString(), /series/)

  const shown = await build({
    site: { ...site, settings: { content: { show_extra: true } } },
    revisions: revisions(),
  })
  assert.match(
    shown.files.get('en/blog/a/index.html').body.toString(),
    /<dl class="extra-fields"><dt>series<\/dt><dd>effect-ts<\/dd><dt>level<\/dt><dd>3<\/dd><\/dl>/,
  )
  assert.match(shown.files.get('en/blog/a/index.md').body.toString(), /- series: effect-ts\n- level: 3\n/)
  assert.match(shown.files.get('en/llms-full.txt').body.toString(), /- series: effect-ts\n- level: 3\n/)
  // Never in JSON-LD, never in the search index — extra is not a typed vocabulary.
  const structured = shown.files
    .get('en/blog/a/index.html')
    .body.toString()
    .match(/application\/ld\+json">(.*?)<\/script>/s)
  if (structured) assert.doesNotMatch(structured[1], /effect-ts/)
  assert.doesNotMatch(shown.files.get('en/search-index.json').body.toString(), /effect-ts/)
})

test('builds with extra and related stay reproducible, and plain posts carry no new markup', async () => {
  const now = new Date('2026-07-08T00:00:00Z')
  const revisions = () => [
    post({ slug: 'a', title: 'A', tags: ['React'], extra: 'related: [b]\nextra:\n  series: s\n' }),
    post({ slug: 'b', title: 'B', tags: ['React'] }),
  ]
  const first = await build({ revisions: revisions(), now })
  const second = await build({ revisions: revisions(), now })
  for (const path of ['en/blog/a/index.html', 'en/blog/a/index.md', 'en/llms-full.txt']) {
    assert.equal(first.files.get(path).body.toString(), second.files.get(path).body.toString(), `${path} is unstable`)
  }
  // A post without the new frontmatter, on a site without the setting, renders
  // exactly as before the feature existed.
  assert.doesNotMatch(first.files.get('en/blog/b/index.html').body.toString(), /extra-fields/)
})

test('a site without theme settings builds byte-identically and carries no theme <style> block', async () => {
  const now = new Date('2026-07-08T00:00:00Z')
  const revisions = () => [post({ slug: 'a', title: 'A' })]
  const first = await build({ revisions: revisions(), now })
  const second = await build({ revisions: revisions(), now })
  const page = first.files.get('en/blog/a/index.html').body.toString()
  assert.equal(page, second.files.get('en/blog/a/index.html').body.toString(), 'build bytes must stay stable')
  assert.doesNotMatch(page, /:root\{--/, 'no theme block without settings.theme or settings.accent')

  // With tokens set, the generated block reaches every rendered page.
  const themed = await build({
    site: { ...site, settings: { theme: { tokens: { primary: '#dc2626' }, custom_css: '.x{color:red}' } } },
    revisions: revisions(),
  })
  const themedPage = themed.files.get('en/blog/a/index.html').body.toString()
  assert.match(themedPage, /<style>:root\{--primary:0 72% 51%\}<\/style>/)
  assert.match(themedPage, /<style>\.x\{color:red\}<\/style>/)
})

test('product docs build a versioned hierarchy and keep protected content out of public discovery', async () => {
  const docsSite = {
    ...site,
    settings: {
      presentation: {
        preset: 'product-docs',
        docs: {
          versions: [
            { id: 'v2', label: '2.x', status: 'current' },
            { id: 'v1', label: '1.x', status: 'archived' },
          ],
        },
      },
    },
  }
  const page = ({ id, slug, key, parent = '', access = '', cover = '' }) => ({
    id,
    item_id: `item-${id}`,
    kind: 'page',
    locale: 'en',
    translation_key: `${key}-v2`,
    markdown: `---\nkind: page\nlayout: docs\ntitle: ${key}\nlocale: en\nslug: ${slug}\ntranslationKey: ${key}-v2\ndocKey: ${key}\ndocsVersion: v2\n${parent ? `parent: ${parent}\n` : ''}${access ? `access: [${access}]\n` : ''}${cover ? `cover: ${cover}\n` : ''}---\n# ${key}\n\n## Details\n\nSecret phrase ${key}.`,
  })
  const result = await build({
    site: docsSite,
    accessGroups: [{ slug: 'customers' }],
    revisions: [
      page({ id: 'start', slug: 'start', key: 'start' }),
      page({
        id: 'install',
        slug: 'install',
        key: 'install',
        parent: 'start',
        access: 'customers',
        cover: '/media/00000000-0000-0000-0000-000000000001/cover.png',
      }),
    ],
  })
  assert.ok(result.files.has('en/docs/index.html'))
  assert.ok(result.files.has('en/docs/v2/index.html'))
  assert.ok(result.files.has('en/docs/v2/start/install/index.html'))
  assert.match(result.files.get('en/docs/v2/start/install/index.html').body.toString(), /docs-sidebar/)
  const sitemap = result.files.get('sitemap.xml').body.toString()
  const search = result.files.get('en/search-index.json').body.toString()
  const llms = result.files.get('en/llms-full.txt').body.toString()
  assert.doesNotMatch(sitemap, /\/start\/install/)
  assert.doesNotMatch(search, /secret phrase install/i)
  assert.doesNotMatch(llms, /secret phrase install/i)
  assert.ok(
    result.accessEntries.some((entry) => entry.path === '/en/docs/v2/start/install/' && entry.match === 'exact'),
  )
  assert.ok(
    result.accessEntries.some(
      (entry) => entry.path === '/en/docs/v2/start/install/index.html' && entry.match === 'exact',
    ),
  )
  assert.ok(
    result.accessEntries.some((entry) => entry.path === '/media/00000000-0000-0000-0000-000000000001/cover.png'),
  )
  assert.equal(result.accessCatalog[0].title, 'install')
})

test('a prefix access rule removes its whole documentation area from public discovery', async () => {
  const docsSite = {
    ...site,
    settings: {
      presentation: {
        preset: 'product-docs',
        docs: { versions: [{ id: 'v2', label: '2.x', status: 'current' }] },
      },
    },
  }
  const result = await build({
    site: docsSite,
    accessGroups: [{ slug: 'team' }],
    accessRules: [{ match: 'prefix', path: '/en/docs/', group_slugs: ['team'], user_ids: [] }],
    revisions: [
      {
        id: 'docs-private',
        item_id: 'item-docs-private',
        kind: 'page',
        locale: 'en',
        translation_key: 'private-v2',
        markdown:
          '---\nkind: page\nlayout: docs\ntitle: Internal manual\nlocale: en\nslug: internal\ntranslationKey: private-v2\ndocKey: internal\ndocsVersion: v2\n---\n# Internal manual\n\nPrivate operations.',
      },
    ],
  })
  const sitemap = result.files.get('sitemap.xml').body.toString()
  assert.doesNotMatch(sitemap, /\/en\/docs/)
  assert.doesNotMatch(result.files.get('en/search-index.json').body.toString(), /Internal manual/)
  assert.doesNotMatch(result.files.get('en/llms-full.txt').body.toString(), /Private operations/)
  assert.ok(result.accessEntries.some((entry) => entry.match === 'prefix' && entry.path === '/en/docs/'))
})

test('a fully private product home renders only same-grant reports and links the newest semantic period', async () => {
  const report = (hour, publishedAt, date = '') => ({
    id: `report-${hour}`,
    item_id: `item-report-${hour}`,
    kind: 'page',
    locale: 'en',
    translation_key: `report-${hour}`,
    // node-postgres returns timestamptz columns as Date instances while
    // authored frontmatter dates are normalized strings.
    published_at: new Date(publishedAt),
    markdown: `---\nkind: page\nlayout: report\ntitle: Report ${hour}:00 UTC\nlocale: en\nslug: report-${hour}\ntranslationKey: report-${hour}\nsummary: Closed hour ${hour}.\n${date ? `date: ${date}\n` : ''}noindex: true\naudio: false\n---\n\n## Facts\n\nReport ${hour}.`,
  })
  const result = await build({
    site: { ...site, settings: { presentation: { preset: 'product' } } },
    accessGroups: [{ slug: 'cockpit' }, { slug: 'other-team' }],
    accessRules: [{ match: 'prefix', path: '/', group_slugs: ['cockpit'], user_ids: [] }],
    revisions: [
      report('08', '2026-07-18T09:00:00Z'),
      report('09', '2026-07-18T10:23:00Z', '2026-07-18T10:00:00Z'),
      report('yearly', '2026-07-18T10:27:00Z', '2026-01-01T00:00:00Z'),
      {
        id: 'other-team-page',
        item_id: 'item-other-team-page',
        kind: 'page',
        locale: 'en',
        translation_key: 'other-team-page',
        markdown:
          '---\nkind: page\nlayout: landing\ntitle: Other team secret\nlocale: en\nslug: other-team\ntranslationKey: other-team-page\naccess: [other-team]\n---\n\nPrivate to another grant.',
      },
    ],
  })
  const home = result.files.get('en/index.html').body.toString()
  assert.match(home, /href="\/en\/report-09\/"[^>]*>Latest report<\/a>/)
  assert.ok(home.indexOf('Report 09:00 UTC') < home.indexOf('Report 08:00 UTC'))
  assert.doesNotMatch(home, /Other team secret/)
  assert.doesNotMatch(result.files.get('en/search-index.json').body.toString(), /Report 0[89]|Other team secret/)
  const reportPage = result.files.get('en/report-09/index.html').body.toString()
  assert.match(reportPage, /href="\/en\/report-09\/" aria-current="page">Latest report<\/a>/)
  assert.doesNotMatch(reportPage, /Other team secret/)
})

test('a protected post also protects its raw Markdown twin', async () => {
  const result = await build({
    accessGroups: [{ slug: 'customers' }],
    revisions: [post({ slug: 'private-post', title: 'Private post', extra: 'access: [customers]\n' })],
  })
  assert.ok(result.files.has('en/blog/private-post/index.md'))
  assert.ok(
    result.accessEntries.some((entry) => entry.match === 'exact' && entry.path === '/en/blog/private-post/index.md'),
  )
  assert.doesNotMatch(result.files.get('en/llms-full.txt').body.toString(), /Private post/)
})

test('wiki, knowledge, landing and changelog layouts receive controlled routes', async () => {
  const revisions = [
    ['wiki', 'wiki-one'],
    ['knowledge', 'help-one'],
    ['landing', 'product-one'],
    ['changelog', 'release-one'],
  ].map(([layoutName, slug]) => ({
    id: `r-${slug}`,
    item_id: `i-${slug}`,
    kind: 'page',
    locale: 'en',
    translation_key: slug,
    markdown: `---\nkind: page\nlayout: ${layoutName}\ntitle: ${slug}\nlocale: en\nslug: ${slug}\ntranslationKey: ${slug}\n---\n# ${slug}`,
  }))
  const result = await build({ revisions })
  for (const path of [
    'en/wiki/wiki-one/index.html',
    'en/help/help-one/index.html',
    'en/product-one/index.html',
    'en/changelog/release-one/index.html',
  ])
    assert.ok(result.files.has(path), path)
})

test('report pages emit static themed SVG assets while preserving authored Markdown', async () => {
  const markdown = `---
kind: page
layout: report
title: Quarterly report
summary: Auditable business snapshot
locale: en
slug: quarterly-report
translationKey: quarterly-report
---
# Quarterly report

:::chart{type="line" title="Revenue trend" description="Revenue for January and February" unit="EUR" span="4"}
| Month | Revenue |
|---|---:|
| Jan | 42 |
| Feb | 51 |
:::`
  const result = await build({
    site: {
      ...site,
      settings: { theme: { tokens: { chart_1: { light: '#2563eb', dark: '#93c5fd' } } } },
    },
    revisions: [
      {
        id: 'report-revision',
        item_id: 'report-item',
        kind: 'page',
        locale: 'en',
        translation_key: 'quarterly-report',
        markdown,
      },
    ],
  })
  const page = result.files.get('en/quarterly-report/index.html').body.toString()
  const svgFiles = [...result.files.keys()].filter((path) =>
    /^assets\/report-chart-(?:light|dark)-[0-9a-f]{10}\.svg$/.test(path),
  )
  assert.equal(svgFiles.length, 2)
  for (const path of svgFiles) {
    assert.equal(result.files.get(path).contentType, 'image/svg+xml')
    assert.match(result.files.get(path).body.toString(), /^<svg role="img"/)
  }
  assert.match(page, /class="report-page"/)
  assert.match(page, /<picture class="report-chart-picture">/)
  assert.match(page, /prefers-color-scheme: dark/)
  assert.match(page, /<details class="report-chart-data">/)
  assert.doesNotMatch(page, /echarts|report-chart[^"']*\.js/i)

  const twin = result.files.get('en/quarterly-report/index.md').body.toString()
  assert.match(twin, /:::chart\{type="line"/)
  assert.match(twin, /\| Jan \| 42 \|/)
  assert.match(result.files.get('en/llms-full.txt').body.toString(), /:::chart\{type="line"/)
})
