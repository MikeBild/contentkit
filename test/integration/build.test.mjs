import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite } from '../../src/site-builder.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

test('builds a complete multilingual static release', async () => {
  const revisions = [
    {
      id: 'rev-de',
      item_id: 'item-de',
      kind: 'post',
      locale: 'de',
      translation_key: 'hello',
      markdown: `---\nkind: post\ntitle: Hallo\nlocale: de\nslug: hallo\ntranslationKey: hello\nsummary: Deutsch\ndate: 2026-06-29\n---\n# Hallo\n\nText.`,
    },
    {
      id: 'rev-en',
      item_id: 'item-en',
      kind: 'post',
      locale: 'en',
      translation_key: 'hello',
      markdown: `---\nkind: post\ntitle: Hello\nlocale: en\nslug: hello\ntranslationKey: hello\nsummary: English\ndate: 2026-06-29\n---\n# Hello\n\nText.`,
    },
  ]
  const result = await buildSite({
    root,
    site: {
      id: 'site',
      name: 'Example',
      description: 'Personal site',
      base_url: 'https://example.com',
      default_locale: 'de',
      settings: {},
    },
    locales: [{ locale: 'de' }, { locale: 'en' }],
    revisions,
    comments: [],
  })
  for (const path of [
    'index.html',
    'de/index.html',
    'en/index.html',
    'de/blog/hallo/index.html',
    'en/blog/hello/index.html',
    'de/archive/index.html',
    'de/tags/index.html',
    'en/tags/index.html',
    'de/feed.xml',
    'llms.txt',
    'llms-full.txt',
    'de/llms.txt',
    'en/llms.txt',
    'sitemap.xml',
    'robots.txt',
    'manifest.webmanifest',
  ])
    assert.ok(result.files.has(path), `missing ${path}`)
  // First-party assets are content-hashed (cache-busting under immutable cache):
  // the file is emitted at assets/<name>-<hash>.<ext> and referenced from HTML.
  const assetKeys = [...result.files.keys()]
  assert.ok(
    assetKeys.some((k) => /^assets\/site-[0-9a-f]{10}\.css$/.test(k)),
    'hashed site.css missing',
  )
  assert.ok(
    assetKeys.some((k) => /^assets\/forms-[0-9a-f]{10}\.js$/.test(k)),
    'hashed forms.js missing',
  )
  assert.match(
    result.files.get('de/index.html').body.toString(),
    /<link rel="stylesheet" href="\/assets\/site-[0-9a-f]{10}\.css">/,
    'home does not reference hashed site.css',
  )
  const de = result.files.get('de/blog/hallo/index.html').body.toString()
  assert.match(de, /hreflang="en"/)
  assert.match(de, /hreflang="x-default"/)
  assert.match(de, /BlogPosting/)
  assert.match(de, /property="og:site_name"/)
  assert.match(de, /rel="manifest"/)
  const sitemapXml = result.files.get('sitemap.xml').body.toString()
  assert.match(sitemapXml, /https:\/\/example.com\/en\/blog\/hello\//)
  // Home and listing entries carry hreflang alternates for every locale
  // (previously only content items did).
  assert.match(
    sitemapXml,
    /<url><loc>https:\/\/example\.com\/de\/<\/loc><xhtml:link rel="alternate" hreflang="de" href="https:\/\/example\.com\/de\/"\/><xhtml:link rel="alternate" hreflang="en" href="https:\/\/example\.com\/en\/"\/>/,
  )
  assert.match(
    sitemapXml,
    /<loc>https:\/\/example\.com\/de\/blog\/<\/loc><xhtml:link rel="alternate" hreflang="de" href="https:\/\/example\.com\/de\/blog\/"\/><xhtml:link rel="alternate" hreflang="en" href="https:\/\/example\.com\/en\/blog\/"\/>/,
  )
  // Listing lastmod is derived from the newest contained item.
  assert.match(sitemapXml, /<loc>https:\/\/example\.com\/de\/blog\/<\/loc>(<xhtml:link[^>]*\/>)*<lastmod>/)
  const manifest = JSON.parse(result.files.get('manifest.webmanifest').body.toString())
  assert.equal(manifest.name, 'Example')
})

test('noindex items are rendered but excluded from the sitemap', async () => {
  const result = await buildSite({
    root,
    site: {
      id: 'site',
      name: 'Example',
      description: 'x',
      base_url: 'https://example.com',
      default_locale: 'de',
      settings: {},
    },
    locales: [{ locale: 'de' }],
    revisions: [
      {
        id: 'r1',
        item_id: 'i1',
        kind: 'post',
        locale: 'de',
        translation_key: 'a',
        markdown: '---\nkind: post\ntitle: Sichtbar\nlocale: de\nslug: sichtbar\ntranslationKey: a\n---\n# A',
      },
      {
        id: 'r2',
        item_id: 'i2',
        kind: 'post',
        locale: 'de',
        translation_key: 'b',
        markdown:
          '---\nkind: post\ntitle: Versteckt\nlocale: de\nslug: versteckt\ntranslationKey: b\nnoindex: true\n---\n# B',
      },
    ],
    comments: [],
  })
  assert.ok(result.files.has('de/blog/versteckt/index.html'), 'noindex page is still rendered')
  const sitemapXml = result.files.get('sitemap.xml').body.toString()
  assert.match(sitemapXml, /\/de\/blog\/sichtbar\//)
  assert.doesNotMatch(sitemapXml, /versteckt/)
})

test('the contact page renders a working submit button and form in every locale', async () => {
  const result = await buildSite({
    root,
    site: {
      id: 'site',
      name: 'Example',
      description: 'Personal site',
      base_url: 'https://example.com',
      default_locale: 'de',
      settings: {},
    },
    locales: [{ locale: 'de' }, { locale: 'en' }],
    revisions: [],
    comments: [],
  })
  for (const [path, sendLabel] of [
    ['de/contact/index.html', 'Absenden'],
    ['en/contact/index.html', 'Send'],
  ]) {
    assert.ok(result.files.has(path), `missing ${path}`)
    const html = result.files.get(path).body.toString()
    // The submit button must be present with the localized label.
    assert.match(
      html,
      new RegExp(`<button class="button" type="submit">${sendLabel}</button>`),
      `submit button missing in ${path}`,
    )
    // The button lives inside the contact form, which posts to the public endpoint.
    assert.match(
      html,
      /<form action="\/public\/v1\/contact" method="post" data-contentkit-form/,
      `contact form missing in ${path}`,
    )
    // { forms: true } wires up the progressive-enhancement handler.
    assert.match(html, /<script src="\/assets\/forms-[0-9a-f]{10}\.js" defer><\/script>/, `forms.js missing in ${path}`)
    // A success panel (revealed on submit) and an error alert region are present.
    assert.match(html, /data-form-success[^>]*hidden/, `success panel missing in ${path}`)
    assert.match(html, /class="form-alert" data-form-status role="alert" hidden/, `alert region missing in ${path}`)
    assert.match(html, /data-error="/, `contact form error text missing in ${path}`)
  }
})

test('renders a per-post cover image and site-default OG image', async () => {
  const result = await buildSite({
    root,
    site: {
      id: 'site',
      name: 'Example',
      description: 'Personal site',
      base_url: 'https://example.com',
      default_locale: 'de',
      settings: { og_image: '/media/site/default.png', favicon: '/icon.svg' },
    },
    locales: [{ locale: 'de' }],
    revisions: [
      {
        id: 'r1',
        item_id: 'i1',
        kind: 'post',
        locale: 'de',
        translation_key: 'a',
        markdown:
          '---\nkind: post\ntitle: Mit Cover\nlocale: de\nslug: a\ntranslationKey: a\ncover: /media/p/cover.png\n---\n# A',
      },
      {
        id: 'r2',
        item_id: 'i2',
        kind: 'post',
        locale: 'de',
        translation_key: 'b',
        markdown: '---\nkind: post\ntitle: Ohne Cover\nlocale: de\nslug: b\ntranslationKey: b\n---\n# B',
      },
    ],
    comments: [],
  })
  // Post with a cover uses it; post without falls back to the site default.
  assert.match(
    result.files.get('de/blog/a/index.html').body.toString(),
    /og:image" content="https:\/\/example\.com\/media\/p\/cover\.png"/,
  )
  assert.match(
    result.files.get('de/blog/b/index.html').body.toString(),
    /og:image" content="https:\/\/example\.com\/media\/site\/default\.png"/,
  )
  assert.match(result.files.get('de/index.html').body.toString(), /rel="icon" href="\/icon\.svg"/)
  // The manifest carries the favicon as an SVG icon.
  const manifest = JSON.parse(result.files.get('manifest.webmanifest').body.toString())
  assert.deepEqual(manifest.icons[0], { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' })
})

test('GA4 analytics gates the loader behind consent.js with the sanitized id in the head', async () => {
  const result = await buildSite({
    root,
    site: {
      id: 'site',
      name: 'Example',
      description: 'x',
      base_url: 'https://example.com',
      default_locale: 'de',
      settings: { analytics: { provider: 'ga4', id: 'G-ABC123"><x' } },
    },
    locales: [{ locale: 'de' }],
    revisions: [
      {
        id: 'r1',
        item_id: 'i1',
        kind: 'post',
        locale: 'de',
        translation_key: 'a',
        markdown: '---\nkind: post\ntitle: A\nlocale: de\nslug: a\ntranslationKey: a\n---\n# A',
      },
    ],
    comments: [],
  })
  // No per-site gtag init file anymore; the loader is withheld until opt-in.
  assert.ok(!result.files.has('assets/analytics.js'))
  const head = result.files.get('de/blog/a/index.html').body.toString()
  // Google is not contacted from the head; consent.js carries the sanitized id.
  assert.doesNotMatch(head, /googletagmanager\.com\/gtag\/js/)
  assert.match(head, /<script src="\/assets\/consent-[0-9a-f]{10}\.js" data-ga-id="G-ABC123x" defer><\/script>/)
})

test('Plausible analytics emits no gated consent loader in the head', async () => {
  const result = await buildSite({
    root,
    site: {
      id: 'site',
      name: 'Example',
      description: 'x',
      base_url: 'https://example.com',
      default_locale: 'de',
      settings: { analytics: { provider: 'plausible', domain: 'example.com' } },
    },
    locales: [{ locale: 'de' }],
    revisions: [],
    comments: [],
  })
  assert.ok(!result.files.has('assets/analytics.js'))
  const head = result.files.get('de/index.html').body.toString()
  assert.match(head, /plausible\.io\/js\/script\.js/)
  assert.doesNotMatch(head, /data-ga-id|consent-[0-9a-f]{10}\.js/)
})
