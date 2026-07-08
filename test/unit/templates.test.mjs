import test from 'node:test'
import assert from 'node:assert/strict'
import { layout, dictionary } from '../../src/templates.mjs'
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

test('nav merges page navOrder with built-in link weights', () => {
  const pages = [
    { title: 'Profil', url: '/de/profil/', nav_order: 1 },
    { title: 'Impressum', url: '/de/impressum/', nav_order: 99 },
  ]
  const html = render({ pages })
  const nav = html.match(/<div class="nav-links">(.*?)<\/div>/s)[1]
  const order = ['Profil', 'Blog', 'Archiv', 'Projekte', 'Suche', 'Kontakt', 'Impressum']
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
