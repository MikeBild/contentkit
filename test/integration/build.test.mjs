import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite } from '../../src/site-builder.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

test('builds a complete multilingual static release', async () => {
  const revisions = [
    {
      id: 'rev-de', item_id: 'item-de', kind: 'post', locale: 'de', translation_key: 'hello',
      markdown: `---\nkind: post\ntitle: Hallo\nlocale: de\nslug: hallo\ntranslationKey: hello\nsummary: Deutsch\ndate: 2026-06-29\n---\n# Hallo\n\nText.`,
    },
    {
      id: 'rev-en', item_id: 'item-en', kind: 'post', locale: 'en', translation_key: 'hello',
      markdown: `---\nkind: post\ntitle: Hello\nlocale: en\nslug: hello\ntranslationKey: hello\nsummary: English\ndate: 2026-06-29\n---\n# Hello\n\nText.`,
    },
  ]
  const result = await buildSite({
    root,
    site: {
      id: 'site', name: 'Example', description: 'Personal site',
      base_url: 'https://example.com', default_locale: 'de', settings: {},
    },
    locales: [{ locale: 'de' }, { locale: 'en' }],
    revisions,
    comments: [],
  })
  for (const path of [
    'index.html', 'de/index.html', 'en/index.html', 'de/blog/hallo/index.html',
    'en/blog/hello/index.html', 'de/archive/index.html', 'de/feed.xml',
    'sitemap.xml', 'robots.txt', 'assets/site.css',
  ]) assert.ok(result.files.has(path), `missing ${path}`)
  const de = result.files.get('de/blog/hallo/index.html').body.toString()
  assert.match(de, /hreflang="en"/)
  assert.match(de, /BlogPosting/)
  assert.match(result.files.get('sitemap.xml').body.toString(), /https:\/\/example.com\/en\/blog\/hello\//)
})
