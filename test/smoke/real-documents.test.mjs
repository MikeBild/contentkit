import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite } from '../../src/site-builder.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

test('real documentation, wiki, knowledge, landing, and changelog examples build together', async () => {
  const sources = [
    ['docs/getting-started.en.md', 'getting-started-v2'],
    ['docs/installation.en.md', 'installation-v2'],
    ['docs/customer-runbook.en.md', 'customer-runbook-v2'],
    ['wiki/release-process.en.md', 'release-process'],
    ['knowledge/rollback.en.md', 'rollback'],
    ['changelog/2-0-0.en.md', 'release-2-0-0'],
    ['landing/product.en.md', 'product'],
  ]
  const revisions = await Promise.all(
    sources.map(async ([path, id]) => ({
      id: `revision-${id}`,
      item_id: `item-${id}`,
      kind: 'page',
      locale: 'en',
      translation_key: id,
      markdown: await readFile(join(root, 'examples', path), 'utf8'),
    })),
  )
  const result = await buildSite({
    root,
    site: {
      id: 'smoke-site',
      name: 'Atlas',
      description: 'Real product knowledge',
      base_url: 'https://atlas.example',
      default_locale: 'en',
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
    },
    locales: [{ locale: 'en' }],
    revisions,
    comments: [],
    accessGroups: [{ slug: 'customers' }],
  })
  for (const path of [
    'en/docs/v2/getting-started/index.html',
    'en/docs/v2/getting-started/installation/index.html',
    'en/docs/v2/getting-started/customer-runbook/index.html',
    'en/wiki/release-process/index.html',
    'en/help/rollback/index.html',
    'en/changelog/2-0-0/index.html',
    'en/atlas/index.html',
  ])
    assert.ok(result.files.has(path), path)
  assert.doesNotMatch(result.files.get('sitemap.xml').body.toString(), /customer-runbook/)
  assert.doesNotMatch(result.files.get('en/search-index.json').body.toString(), /Customer runbook/)
  assert.equal(result.accessCatalog.length, 1)
})
