import test from 'node:test'
import assert from 'node:assert/strict'
import { audioPlayer, blogcastPage, contentBody, dictionary, layout, searchBody } from '../../src/templates.mjs'
import { contentCsp } from '../../src/security.mjs'

function render(ctxOverrides = {}, options = {}) {
  const site = {
    name: 'Example',
    base_url: 'https://example.test',
    default_locale: 'de',
    settings: {},
    ...(ctxOverrides.site || {}),
  }
  const ctx = {
    locale: 'de',
    t: dictionary('de'),
    pages: [],
    posts: [],
    projects: [],
    title: 'A Post',
    description: 'Desc',
    canonical: 'https://example.test/de/blog/a/',
    currentPath: '/de/blog/a/',
    ...ctxOverrides,
    site,
  }
  return layout(ctx, '<main>body</main>', options)
}

test('every page gets an OG image from the site default, absolutized, with a large twitter card', () => {
  const html = render({
    site: {
      name: 'Example',
      base_url: 'https://example.test',
      default_locale: 'de',
      settings: { og_image: '/media/x/default.png' },
    },
  })
  assert.match(html, /<meta property="og:image" content="https:\/\/example\.test\/media\/x\/default\.png">/)
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/)
  assert.match(html, /<meta property="og:site_name" content="Example">/)
  assert.match(html, /<meta property="og:locale" content="de">/)
})

test("a page's own cover overrides the site default OG image", () => {
  const html = render({ image: '/media/y/cover.jpg', imageAlt: 'Cover alt' })
  assert.match(html, /og:image" content="https:\/\/example\.test\/media\/y\/cover\.jpg"/)
  assert.match(html, /<meta property="og:image:alt" content="Cover alt">/)
})

test('favicons, mask-icon and web manifest are emitted', () => {
  const html = render({
    site: {
      name: 'Example',
      base_url: 'https://example.test',
      default_locale: 'de',
      settings: { favicon: '/icon.svg', apple_touch_icon: '/apple.png', mask_icon: '/mask.svg', accent: '#2563eb' },
    },
  })
  assert.match(html, /<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml">/)
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple\.png">/)
  assert.match(html, /<link rel="mask-icon" href="\/mask\.svg" color="#2563eb">/)
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/)
})

test('a hex accent is converted to an HSL triple before it reaches --primary', () => {
  const html = render({
    site: { name: 'Example', base_url: 'https://example.test', default_locale: 'de', settings: { accent: '#2563eb' } },
  })
  assert.match(html, /<style>:root\{--primary:221 83% 53%\}<\/style>/)
})

test('an accent that is already an HSL triple passes through unchanged', () => {
  const html = render({
    site: {
      name: 'Example',
      base_url: 'https://example.test',
      default_locale: 'de',
      settings: { accent: '222.2 47.4% 11.2%' },
    },
  })
  assert.match(html, /<style>:root\{--primary:222\.2 47\.4% 11\.2%\}<\/style>/)
})

test('noindex frontmatter emits a robots meta', () => {
  assert.match(render({ noindex: true }), /<meta name="robots" content="noindex,nofollow">/)
  assert.doesNotMatch(render({ noindex: false }), /name="robots"/)
})

test('article pages emit article:published_time and per-tag meta', () => {
  const html = render({
    type: 'article',
    publishedTime: '2026-01-01T00:00:00Z',
    modifiedTime: '2026-02-01T00:00:00Z',
    articleTags: ['rxjs', 'cdk'],
  })
  assert.match(html, /<meta property="article:published_time" content="2026-01-01T00:00:00Z">/)
  assert.match(html, /<meta property="article:modified_time" content="2026-02-01T00:00:00Z">/)
  assert.match(html, /<meta property="article:tag" content="rxjs">/)
  assert.match(html, /<meta property="article:tag" content="cdk">/)
})

test('x-default hreflang points at the default-locale translation', () => {
  const translations = [
    { locale: 'de', canonical: 'https://example.test/de/blog/a/' },
    { locale: 'en', canonical: 'https://example.test/en/blog/a/' },
  ]
  const html = render({ translations })
  assert.match(html, /<link rel="alternate" hreflang="x-default" href="https:\/\/example\.test\/de\/blog\/a\/">/)
  assert.match(html, /<meta property="og:locale:alternate" content="en">/)
})

test('twitter handle is normalized to @handle', () => {
  const html = render({
    site: {
      name: 'Example',
      base_url: 'https://example.test',
      default_locale: 'de',
      settings: { twitter_handle: 'example' },
    },
  })
  assert.match(html, /<meta name="twitter:site" content="@example">/)
})

test('plausible analytics injects a single external script (no inline)', () => {
  const html = render({
    site: {
      name: 'Example',
      base_url: 'https://example.test',
      default_locale: 'de',
      settings: { analytics: { provider: 'plausible', domain: 'example.test' } },
    },
  })
  assert.match(
    html,
    /<script defer data-domain="example\.test" src="https:\/\/plausible\.io\/js\/script\.js"><\/script>/,
  )
})

test('ga4 analytics ships the consent gate, not the gtag loader', () => {
  const html = render({
    site: {
      name: 'Example',
      base_url: 'https://example.test',
      default_locale: 'de',
      settings: { analytics: { provider: 'ga4', id: 'G-ABC123' } },
    },
  })
  // The head must not load Google directly — consent.js withholds it until opt-in.
  assert.doesNotMatch(html, /googletagmanager\.com\/gtag\/js/)
  assert.match(html, /<script src="\/assets\/consent\.js" data-ga-id="G-ABC123" defer><\/script>/)
  // GA4 also exposes the footer revoke control.
  assert.match(html, /data-consent-settings/)
})

test('non-ga4 sites render no consent gate or revoke control', () => {
  const html = render({
    site: { name: 'Example', base_url: 'https://example.test', default_locale: 'de', settings: {} },
  })
  assert.doesNotMatch(html, /consent\.js|data-consent-settings/)
})

test('post comments render a submission form by default', () => {
  const html = contentBody(
    {
      kind: 'post',
      item_id: 'post-1',
      title: 'A',
      summary: 'S',
      html: '<p>Body</p>',
      published_at: '2026-01-01T00:00:00Z',
    },
    {
      site: { id: 'site-1', settings: {} },
      t: dictionary('de'),
      locale: 'de',
    },
    [],
  )
  assert.match(html, /<form action="\/public\/v1\/posts\/post-1\/comments"/)
  assert.match(html, /name="email" type="email"/)
})

test('post comments can omit the submission form while keeping approved comments', () => {
  const html = contentBody(
    {
      kind: 'post',
      item_id: 'post-1',
      title: 'A',
      summary: 'S',
      html: '<p>Body</p>',
      published_at: '2026-01-01T00:00:00Z',
    },
    {
      site: { id: 'site-1', settings: { comments: { enabled: false } } },
      t: dictionary('de'),
      locale: 'de',
    },
    [{ author_name: 'Ada', body: 'Approved' }],
  )
  assert.match(html, /Approved/)
  assert.doesNotMatch(html, /<form action="\/public\/v1\/posts\/post-1\/comments"/)
  assert.doesNotMatch(html, /Kommentar schreiben/)
})

test('search pages can be rendered with noindex robots metadata', () => {
  const html = render({ noindex: true })
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/)
  // The search page carries no input of its own — the header combobox is the only
  // one — and no second live region beside the header's role="status".
  const body = searchBody({ locale: 'de', t: dictionary('de') })
  assert.match(body, /data-search-results/)
  assert.doesNotMatch(body, /data-search-input|aria-live/)
})

test('the header ships a search combobox and search.js on every page', () => {
  const html = render()
  assert.match(html, /<script src="\/assets\/search\.js" defer><\/script>/)
  assert.match(html, /<form class="site-search" role="search" method="get" action="\/de\/search\/" data-site-search>/)
  for (const attribute of [
    /name="q"/,
    /type="search"/,
    /role="combobox"/,
    /aria-autocomplete="list"/,
    /aria-expanded="false"/,
    /aria-controls="site-search-listbox"/,
    /data-index="\/de\/search-index\.json"/,
    /data-empty-text="Keine Ergebnisse\."/,
    /data-count-many="\{n\} Ergebnisse"/,
    /id="site-search-listbox" role="listbox"/,
    /role="status" aria-live="polite" data-search-status/,
  ])
    assert.match(html, attribute)
  // Search is not navigation: the form must sit beside the nav landmark, not inside it.
  const nav = html.match(/<nav class="nav-links"[^>]*>(.*?)<\/nav>/s)[1]
  assert.doesNotMatch(nav, /data-site-search|<input/)
})

test('the header nav merges page navOrder with built-in weights and omits search', () => {
  const pages = [{ title: 'Profil', url: '/de/profil/', nav_order: 1 }]
  const html = render({ pages })
  const nav = html.match(/<nav class="nav-links"[^>]*>(.*?)<\/nav>/s)[1]
  const order = ['Profil', 'Blog', 'Archiv', 'Projekte']
  const positions = order.map((label) => nav.indexOf(`>${label}</a>`))
  assert.ok(
    positions.every((p) => p >= 0),
    `nav is missing a link: ${nav}`,
  )
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
    `nav order wrong: ${nav}`,
  )
  assert.equal(nav.indexOf('>Suche</a>'), -1, 'search is the header combobox, not a nav link')
})

test('contact and legal pages live only in the footer, never in the header nav', () => {
  const html = render({
    pages: [
      { title: 'Profil', url: '/de/profil/', nav_order: 1 },
      { title: 'Datenschutzerklärung', url: '/de/datenschutz/', nav_order: 70 },
      { title: 'Impressum', url: '/de/impressum/', nav_order: 99 },
    ],
  })
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
  const footer = html.slice(html.indexOf('<footer class="site-footer">'))
  // Match `>Label</a>` rather than the bare label: `Kontakt` is also the footer
  // column's <h2> text and its aria-label.
  for (const label of ['Kontakt', 'Datenschutzerklärung', 'Impressum']) {
    assert.equal(header.indexOf(`>${label}</a>`), -1, `${label} must not be linked from the header`)
    assert.ok(footer.includes(`>${label}</a>`), `${label} must be linked from the footer`)
  }
  // navOrder <= 60 still leads the header nav, and stays out of the legal column.
  assert.match(header, />Profil<\/a>/)
  const contactCol = footer.match(/<h2>Kontakt<\/h2><ul>(.*?)<\/ul>/s)[1]
  assert.doesNotMatch(contactCol, /Profil/)
})

test('footer renders brand, navigation, contact/legal and social columns', () => {
  const html = render({
    site: {
      name: 'Example',
      description: 'Personal site',
      base_url: 'https://example.test',
      default_locale: 'de',
      settings: { socials: { GitHub: 'https://github.com/x', LinkedIn: 'https://www.linkedin.com/in/x' } },
    },
    pages: [
      { title: 'Profil', url: '/de/profil/', nav_order: 1 },
      { title: 'Impressum', url: '/de/impressum/', nav_order: 99 },
    ],
  })
  const footer = html.match(/<footer class="site-footer">(.*?)<\/footer>/s)[1]
  assert.match(footer, /class="footer-grid"/)
  assert.doesNotMatch(footer, /data-site-search/)
  assert.match(footer, /<p>Personal site<\/p>/)
  assert.match(footer, /<h2>Navigation<\/h2>/)
  assert.match(footer, /href="\/de\/blog\/">Blog<\/a>/)
  // Contact column: contact link plus legal pages (navOrder > 60), but not Profil.
  const contactCol = footer.match(/<h2>Kontakt<\/h2><ul>(.*?)<\/ul>/s)[1]
  assert.match(contactCol, /href="\/de\/contact\/">Kontakt<\/a>/)
  assert.match(contactCol, /href="\/de\/impressum\/">Impressum<\/a>/)
  assert.doesNotMatch(contactCol, /Profil/)
  // Social column: settings.socials with rel="me" plus the RSS feed.
  assert.match(footer, /<a href="https:\/\/github\.com\/x" rel="me">GitHub<\/a>/)
  assert.match(footer, /<a href="https:\/\/www\.linkedin\.com\/in\/x" rel="me">LinkedIn<\/a>/)
  assert.match(footer, /href="\/de\/feed\.xml">RSS<\/a>/)
  assert.match(footer, /© \d{4} Example/)
})

test('contentCsp widens script/connect only for the configured provider', () => {
  assert.doesNotMatch(contentCsp(null), /plausible|googletagmanager/)
  const plausible = contentCsp({ provider: 'plausible', domain: 'x.test' })
  assert.match(plausible, /script-src[^;]*https:\/\/plausible\.io/)
  assert.match(plausible, /connect-src[^;]*https:\/\/plausible\.io/)
  const ga = contentCsp({ provider: 'ga4', id: 'G-X' })
  assert.match(ga, /script-src[^;]*https:\/\/www\.googletagmanager\.com/)
  assert.match(ga, /connect-src[^;]*https:\/\/www\.google-analytics\.com/)
})

test('contentBody survives a bare item: no tags, no relations, no injected clock', () => {
  // Locks the null-safety that lets the older direct-call tests above pass an
  // item straight from a fixture rather than a fully-derived build item.
  const html = contentBody(
    { kind: 'post', item_id: 'p', title: 'A', summary: 'S', html: '<p>B</p>' },
    { site: { id: 's', settings: {} }, t: dictionary('de'), locale: 'de' },
    [],
  )
  assert.doesNotMatch(html, /class="related"|class="post-nav"|post-age/)
  assert.doesNotMatch(html, /undefined|NaN/)
})

test('pages render neither reading time nor an age notice, however old', () => {
  const html = contentBody(
    {
      kind: 'page',
      item_id: 'pg',
      title: 'Impressum',
      summary: 'S',
      html: '<p>B</p>',
      published_at: '2010-01-01T00:00:00Z',
      reading_minutes: 7,
    },
    { site: { id: 's', settings: {} }, t: dictionary('de'), locale: 'de', now: new Date('2026-07-08T00:00:00Z') },
    [],
  )
  assert.doesNotMatch(html, /Lesezeit|post-age/)
})

test('ctx.robots overrides the noindex default without nofollow', () => {
  const html = render({ robots: 'noindex,follow' })
  assert.match(html, /<meta name="robots" content="noindex,follow">/)
  assert.doesNotMatch(html, /nofollow/)
})

test('ctx.feedUrl replaces the site feed link rather than adding a second one', () => {
  const html = render({ feedUrl: '/de/tags/react/feed.xml', feedTitle: 'Example · React' })
  const links = html.match(/<link rel="alternate" type="application\/rss\+xml"[^>]*>/g)
  assert.equal(links.length, 1)
  assert.match(links[0], /href="\/de\/tags\/react\/feed\.xml"/)
  assert.match(links[0], /title="Example · React"/)
})

test('the opted-in blogcast also gets a visible footer link', () => {
  const siteWith = (audio) => ({
    name: 'Example',
    base_url: 'https://example.test',
    default_locale: 'de',
    settings: { audio },
  })
  const on = render({ site: siteWith({ enabled: true, blogcast_link: true }), blogcast: true })
  const footer = on.slice(on.indexOf('<footer class="site-footer">'))
  assert.match(footer, />Blogcast<\/a>/)
  // The footer targets the human-facing page; the raw feed stays the head
  // <link rel="alternate">'s job.
  assert.match(footer, /<a href="\/de\/blogcast\/">Blogcast<\/a>/)
  assert.doesNotMatch(footer, /blogcast\.xml/)
  const off = render({ site: siteWith({ enabled: true, blogcast_link: true }) })
  assert.doesNotMatch(off.slice(off.indexOf('<footer class="site-footer">')), />Blogcast<\/a>/)
})

test('the blogcast feed link needs both enabled audio and the blogcast_link opt-in', () => {
  const siteWith = (audio) => ({
    name: 'Example',
    base_url: 'https://example.test',
    default_locale: 'de',
    settings: { audio },
  })
  // Opt-in without enabled audio: the feed file would not exist in the release.
  assert.doesNotMatch(render({ site: siteWith({ blogcast_link: true }) }), /blogcast\.xml/)
  // Enabled audio without the opt-in: advertising the feed is the operator's call.
  assert.doesNotMatch(render({ site: siteWith({ enabled: true }) }), /blogcast\.xml/)
  // Opt-in and audio, but no narrated post yet: nothing to advertise.
  assert.doesNotMatch(render({ site: siteWith({ enabled: true, blogcast_link: true }) }), /blogcast\.xml/)
  assert.match(
    render({ site: siteWith({ enabled: true, blogcast_link: true, title: 'Mein Blogcast' }), blogcast: true }),
    /<link rel="alternate" type="application\/rss\+xml" title="Mein Blogcast" href="\/de\/blogcast\.xml">/,
  )
})

test('the deprecated podcast_* settings still work as fallbacks for the blogcast_* keys', () => {
  const siteWith = (audio) => ({
    name: 'Example',
    base_url: 'https://example.test',
    default_locale: 'de',
    settings: { audio },
  })
  // podcast_link opts the advertising in when blogcast_link is absent…
  const legacy = render({ site: siteWith({ enabled: true, podcast_link: true }), blogcast: true })
  assert.match(legacy, /<a href="\/de\/blogcast\/">Blogcast<\/a>/)
  assert.match(
    legacy,
    /<link rel="alternate" type="application\/rss\+xml" title="Example · Blogcast" href="\/de\/blogcast\.xml">/,
  )
  // …but an explicit blogcast_link wins over the deprecated key.
  const overridden = render({
    site: siteWith({ enabled: true, blogcast_link: false, podcast_link: true }),
    blogcast: true,
  })
  assert.doesNotMatch(overridden, /blogcast\.xml|>Blogcast<\/a>/)
  // podcast_image still provides the page cover when blogcast_image is absent.
  const page = blogcastPage(
    {
      site: { id: 's', name: 'Example', settings: { audio: { enabled: true, podcast_image: '/media/old-cover.jpg' } } },
      t: dictionary('de'),
      locale: 'de',
    },
    [audioPost()],
  )
  assert.match(page, /<img class="blogcast-cover" src="\/media\/old-cover\.jpg"/)
})

test('rendered dates depend on neither the build machine timezone nor its locale', () => {
  // Two independent sources of build-machine nondeterminism. Without an explicit
  // zone, 2026-01-01T00:00:00Z prints as 31.12.2025 in America/New_York. Without an
  // explicit locale it prints as 1/1/2026 on an en-US runner and 1.1.2026 on a de-DE
  // laptop — identical content, different bytes, different release hash.
  const item = {
    kind: 'post',
    item_id: 'p',
    locale: 'de',
    title: 'A',
    summary: 'S',
    html: '<p>B</p>',
    published_at: '2026-01-01T00:00:00Z',
  }
  const ctx = { site: { id: 's', settings: {} }, t: dictionary('de'), locale: 'de' }
  assert.match(contentBody(item, ctx, []), /Veröffentlicht: 1\.1\.2026/)

  // An item without its own locale takes the rendering context's, never the operating
  // system's. `toLocaleDateString(undefined)` would silently do the latter.
  const { locale, ...localeless } = item
  assert.equal(locale, 'de')
  assert.match(contentBody(localeless, ctx, []), /Veröffentlicht: 1\.1\.2026/)
  assert.match(contentBody(localeless, { ...ctx, t: dictionary('en'), locale: 'en' }, []), /Published: 1\/1\/2026/)
})

test('formatting a date without any locale is a hard error, not a system-locale guess', () => {
  const item = { kind: 'post', item_id: 'p', title: 'A', summary: 'S', html: '', published_at: '2026-01-01T00:00:00Z' }
  assert.throws(
    () => contentBody(item, { site: { id: 's', settings: {} }, t: dictionary('de') }, []),
    /formatDate requires an explicit locale/,
  )
})

const audioPost = (overrides = {}) => ({
  kind: 'post',
  item_id: 'item-a',
  locale: 'de',
  title: 'Folge A',
  summary: 'Worum es geht',
  url: '/de/blog/a/',
  published_at: '2026-06-02T00:00:00Z',
  audio: { url: '/media/asset-1/a.mp3', content_type: 'audio/mpeg', byte_size: 1234, duration_secs: 1177 },
  ...overrides,
})

test('the shared player ships a native fallback plus the hidden custom control bar', () => {
  const ctx = { site: { id: 's', settings: {} }, t: dictionary('de'), locale: 'de' }
  const html = audioPlayer(audioPost(), ctx)
  // No-JS fallback: real native controls, no preloaded bytes.
  assert.match(html, /<audio controls preload="none" src="\/media\/asset-1\/a\.mp3"><\/audio>/)
  // The custom bar ships complete but hidden — audio.js swaps it in.
  assert.match(html, /<div class="audio-ui" data-audio-ui hidden>/)
  assert.match(html, /data-audio-play data-label-play="Abspielen" data-label-pause="Pause" aria-label="Abspielen"/)
  assert.match(html, /data-audio-skip="-15" aria-label="15 Sekunden zurück"/)
  assert.match(html, /data-audio-skip="15" aria-label="15 Sekunden vor"/)
  assert.match(html, /<input class="audio-ui-seek" type="range" min="0" max="1177" step="1" value="0" data-audio-seek/)
  assert.match(html, /data-audio-time>0:00 \/ 19:37</, 'the readout starts at the build-time duration')
  assert.match(html, /<svg /, 'icons are inline SVG')
  assert.doesNotMatch(html, /onclick|innerHTML/, 'CSP-safe markup: no inline handlers')
  // The tempo group and download link survive unchanged.
  assert.match(html, /data-audio-rate="1.25" aria-pressed="false">1,25×/)
  assert.match(html, /<a class="audio-player-download" href="\/media\/asset-1\/a\.mp3" download>MP3 herunterladen<\/a>/)
  // The article page keeps its label; the blogcast page opts out of it.
  assert.match(html, /Diesen Beitrag anhören \(20 Min\.\)/)
  assert.doesNotMatch(audioPlayer(audioPost(), ctx, { label: false }), /audio-player-label/)
})

test('the blogcast page lists episodes as cards with player markup and a subscribe link', () => {
  const ctx = {
    site: {
      id: 's',
      name: 'Example',
      settings: {
        audio: {
          enabled: true,
          title: 'Mein Blogcast',
          description: 'Vorgelesene Beiträge',
          blogcast_image: 'https://example.test/cover.jpg',
        },
      },
    },
    t: dictionary('de'),
    locale: 'de',
  }
  const html = blogcastPage(ctx, [
    audioPost(),
    audioPost({ item_id: 'item-b', title: 'Folge B', url: '/de/blog/b/', published_at: '2026-06-01T00:00:00Z' }),
  ])
  assert.match(html, /<h1>Mein Blogcast<\/h1>/)
  assert.match(html, /Vorgelesene Beiträge/)
  assert.match(
    html,
    /<img class="blogcast-cover" src="https:\/\/example\.test\/cover\.jpg" alt="Mein Blogcast" width="180" height="180">/,
  )
  assert.match(html, /<a class="blogcast-subscribe" href="\/de\/blogcast\.xml">Per RSS abonnieren<\/a>/)
  // Episodes: title links to the post, formatted date, duration chip, summary,
  // and the same shared player markup audio.js drives on article pages.
  assert.match(html, /<h2 class="blogcast-episode-title"><a href="\/de\/blog\/a\/">Folge A<\/a><\/h2>/)
  assert.match(html, /<time datetime="2026-06-02T00:00:00Z">2\.6\.2026<\/time>/)
  assert.match(html, /<span class="blogcast-episode-duration">20 Min\.<\/span>/)
  assert.match(html, /Worum es geht/)
  assert.equal(html.match(/class="audio-player" data-audio="/g).length, 2, 'one player per episode')
  assert.match(html, /data-audio-ui/)
  assert.doesNotMatch(html, /audio-player-label/, 'episode cards carry the title already — no player label')

  // Fallbacks: without channel settings the site's own name/description serve,
  // and without a cover no broken <img> is emitted.
  const plain = blogcastPage(
    {
      site: { id: 's', name: 'Example', description: 'Personal site', settings: { audio: { enabled: true } } },
      t: dictionary('en'),
      locale: 'en',
    },
    [audioPost({ locale: 'en' })],
  )
  assert.match(plain, /<h1>Example<\/h1>/)
  assert.match(plain, /Personal site/)
  assert.match(plain, /Subscribe via RSS/)
  assert.doesNotMatch(plain, /blogcast-cover/)
})
