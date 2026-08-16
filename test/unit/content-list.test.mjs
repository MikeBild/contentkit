import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../../src/repository.mjs'

// Title, slug and summary live on the revision, never on the item, so an
// unenriched list identifies a document only by its translation_key. That is
// what the Cockpit rendered before this: an always-empty Slug column and a
// Title column full of slugs.
function fixture({ revisions }) {
  const items = [
    {
      id: 'item-1',
      site_id: 'site-1',
      kind: 'post',
      locale: 'de',
      translation_key: 'a-post',
      published_revision_id: 'rev-2',
    },
    {
      id: 'item-2',
      site_id: 'site-1',
      kind: 'page',
      locale: 'de',
      translation_key: 'a-page',
      published_revision_id: null,
    },
    {
      id: 'item-3',
      site_id: 'site-1',
      kind: 'post',
      locale: 'en',
      translation_key: 'no-revisions',
      published_revision_id: null,
    },
  ]
  const queries = []
  const db = {
    async select(table, query) {
      if (table !== 'ck_content_items') return []
      return items.filter(
        (item) =>
          (!query.kind || query.kind === `eq.${item.kind}`) && (!query.locale || query.locale === `eq.${item.locale}`),
      )
    },
    async query(sql, values) {
      queries.push({ sql, values })
      return revisions
    },
  }
  return { repo: createRepository({}, db, {}), queries }
}

const REVISIONS = [
  {
    id: 'rev-3',
    item_id: 'item-1',
    title: 'A published post',
    slug: 'a-published-post',
    summary: 'One sentence.',
    tags: ['contentkit'],
    status: 'draft',
    created_at: '2026-07-20T10:00:00Z',
  },
  {
    id: 'rev-4',
    item_id: 'item-2',
    title: 'A draft page',
    slug: 'a-draft-page',
    summary: null,
    tags: null,
    status: 'draft',
    created_at: '2026-07-19T10:00:00Z',
  },
]

describe('listContent', () => {
  test('merges the newest revision so the list is readable without a second call', async () => {
    const { repo, queries } = fixture({ revisions: REVISIONS })
    const items = await repo.listContent('site-1')

    const post = items.find((item) => item.id === 'item-1')
    assert.equal(post.title, 'A published post')
    assert.equal(post.slug, 'a-published-post')
    assert.equal(post.summary, 'One sentence.')
    assert.deepEqual(post.tags, ['contentkit'])
    assert.equal(post.latest_revision_id, 'rev-3')

    // One extra query for the whole page, not one per item.
    assert.equal(queries.length, 1)
    assert.deepEqual(queries[0].values, [['item-1', 'item-2', 'item-3']])
  })

  test('the newest revision status is not the same question as being live', async () => {
    const { repo } = fixture({ revisions: REVISIONS })
    const items = await repo.listContent('site-1')
    const post = items.find((item) => item.id === 'item-1')

    // Published item whose newest revision is still a draft: unreleased work.
    assert.equal(post.published_revision_id, 'rev-2')
    assert.equal(post.latest_revision_status, 'draft')

    const page = items.find((item) => item.id === 'item-2')
    assert.equal(page.published_revision_id, null)
    assert.equal(page.latest_revision_status, 'draft')
  })

  test('an item with no revisions is returned untouched rather than dropped', async () => {
    const { repo } = fixture({ revisions: REVISIONS })
    const items = await repo.listContent('site-1')
    const orphan = items.find((item) => item.id === 'item-3')
    assert.ok(orphan, 'an item without revisions must still be listed')
    assert.equal(orphan.title, undefined)
    assert.equal(orphan.latest_revision_id, undefined)
    assert.equal(orphan.latest_revision_status, undefined)
  })

  test('an empty page costs no revision query', async () => {
    const { repo, queries } = fixture({ revisions: [] })
    assert.deepEqual(await repo.listContent('site-1', { locale: 'fr' }), [])
    assert.equal(queries.length, 0)
  })

  test('a db without raw query support still lists items', async () => {
    // The fake databases in several unit tests expose only select(); the
    // enrichment must degrade rather than throw.
    const repo = createRepository(
      {},
      {
        async select() {
          return [{ id: 'item-1', site_id: 'site-1' }]
        },
      },
      {},
    )
    assert.deepEqual(await repo.listContent('site-1'), [{ id: 'item-1', site_id: 'site-1' }])
  })
})
