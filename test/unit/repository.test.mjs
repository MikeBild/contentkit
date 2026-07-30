import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepository } from '../../src/repository.mjs'

function fakeDb({ domains, sites }) {
  return {
    async select(table, query) {
      if (table === 'ck_site_domains') {
        const rows = domains.filter((domain) => domain.verified_at)
        if (query.hostname?.startsWith('eq.')) {
          return rows
            .filter((domain) => domain.hostname === query.hostname.slice(3))
            .slice(0, Number(query.limit || rows.length))
        }
        return rows.slice(0, Number(query.limit || rows.length))
      }
      if (table === 'ck_sites') {
        if (query.id?.startsWith('eq.')) {
          return sites.filter((site) => site.id === query.id.slice(3)).slice(0, Number(query.limit || sites.length))
        }
        if (query.slug?.startsWith('eq.')) {
          return sites.filter((site) => site.slug === query.slug.slice(3)).slice(0, Number(query.limit || sites.length))
        }
      }
      return []
    },
  }
}

function repoFor(domains) {
  return createRepository(
    {},
    fakeDb({
      domains,
      sites: [
        { id: 'wildcard-site', slug: 'wildcard', name: 'Wildcard' },
        { id: 'exact-site', slug: 'exact', name: 'Exact' },
        { id: 'nested-site', slug: 'nested', name: 'Nested' },
      ],
    }),
    {},
  )
}

test('resolves exact host domains before wildcard domains', async () => {
  const repo = repoFor([
    { site_id: 'wildcard-site', hostname: '*.example.dev', verified_at: '2026-06-29T10:00:00Z' },
    { site_id: 'exact-site', hostname: 'www.example.dev', verified_at: '2026-06-29T10:00:00Z' },
  ])

  assert.equal((await repo.getSiteByHost('www.example.dev')).id, 'exact-site')
  assert.equal((await repo.getSiteByHost('WWW.EXAMPLE.DEV:443')).id, 'exact-site')
})

test('resolves subdomains through the most specific verified wildcard domain', async () => {
  const repo = repoFor([
    { site_id: 'wildcard-site', hostname: '*.example.dev', verified_at: '2026-06-29T10:00:00Z' },
    { site_id: 'nested-site', hostname: '*.demo.example.dev', verified_at: '2026-06-29T10:00:00Z' },
  ])

  assert.equal((await repo.getSiteByHost('alpha.example.dev')).id, 'wildcard-site')
  assert.equal((await repo.getSiteByHost('alpha.demo.example.dev')).id, 'nested-site')
})

test('does not resolve root hosts or unverified wildcard domains', async () => {
  const repo = repoFor([
    { site_id: 'wildcard-site', hostname: '*.example.dev', verified_at: '2026-06-29T10:00:00Z' },
    { site_id: 'exact-site', hostname: '*.unverified.dev', verified_at: null },
  ])

  assert.equal(await repo.getSiteByHost('example.dev'), null)
  assert.equal(await repo.getSiteByHost('www.unverified.dev'), null)
})

test('preview invitations exchange once into a separately hashed session', async () => {
  const invite = {
    id: 'preview-access-1',
    release_id: 'release-1',
    slug: 'article-review',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }
  let consumed = false
  const db = {
    async tx(fn) {
      return fn(this)
    },
    async select(table, query) {
      assert.equal(table, 'ck_preview_access')
      if (query.invite_token_hash) return consumed ? [] : [invite]
      if (query.slug === 'eq.article-review' && query.session_token_hash === `eq.${invite.session_token_hash}`) {
        return [invite]
      }
      return []
    },
    async update(table, filters, body) {
      assert.equal(table, 'ck_preview_access')
      assert.equal(filters.consumed_at, 'is.null')
      if (consumed) return []
      consumed = true
      Object.assign(invite, body)
      return [invite]
    },
  }
  const repo = createRepository({ previewSecret: 'preview-secret' }, db, {})
  const exchanged = await repo.exchangePreviewInvitation('one-time-secret')
  assert.equal(exchanged.slug, 'article-review')
  assert.match(invite.session_token_hash, /^[0-9a-f]{64}$/)
  assert.ok(!invite.session_token_hash.includes(exchanged.token))
  assert.equal(await repo.exchangePreviewInvitation('one-time-secret'), null)
  assert.equal((await repo.authenticatePreview('article-review', exchanged.token)).release_id, 'release-1')
})

function snapshotRepo({
  siteLocales = [{ site_id: 'site-1', locale: 'de' }],
  extraItems = [],
  extraRevisions = [],
  // What a `SELECT … FOR UPDATE` on the site row sees. Defaults to the same row
  // every unlocked read returns; a test sets it to model a racing transaction that
  // committed between the unlocked read and the lock.
  lockedSite = null,
} = {}) {
  const site = {
    id: 'site-1',
    slug: 'site-1',
    name: 'Site',
    base_url: 'https://example.com',
    default_locale: 'de',
    settings: {},
  }
  const items = [
    {
      id: 'item-a',
      site_id: 'site-1',
      kind: 'post',
      locale: 'de',
      translation_key: 'a',
      published_revision_id: 'rev-a',
    },
    {
      id: 'item-b',
      site_id: 'site-1',
      kind: 'post',
      locale: 'de',
      translation_key: 'b',
      published_revision_id: 'rev-b',
    },
    { id: 'item-c', site_id: 'site-1', kind: 'page', locale: 'de', translation_key: 'c', published_revision_id: null },
    ...extraItems,
  ]
  const revisions = [
    { id: 'rev-a', item_id: 'item-a', markdown: '# a', status: 'published' },
    { id: 'rev-a2', item_id: 'item-a', markdown: '# a v2', status: 'draft' },
    { id: 'rev-b', item_id: 'item-b', markdown: '# b', status: 'published' },
    { id: 'rev-c', item_id: 'item-c', markdown: '# c', status: 'draft' },
    ...extraRevisions,
  ]
  // The locale and item selects honour the `locale=eq.` filter and the
  // `locale.asc` order the repository sends, because the locale writes below
  // depend on both: an unfiltered fake would report every existing locale as a
  // duplicate of the one being added.
  const filterLocale = (rows, query) =>
    query.locale ? rows.filter((row) => row.locale === query.locale.slice(3)) : rows
  const db = {
    async select(table, query = {}) {
      if (table === 'ck_sites') return query.slug === 'eq.site-1' || query.id === 'eq.site-1' ? [site] : []
      if (table === 'ck_site_locales') {
        const rows = filterLocale(siteLocales, query)
        return query.order === 'locale.asc' ? [...rows].sort((a, b) => a.locale.localeCompare(b.locale)) : rows
      }
      if (table === 'ck_content_items') return filterLocale(items, query)
      if (table === 'ck_content_revisions') {
        // Both shapes the repository sends: revisions by id (the release overlay)
        // and revisions by item with a status filter (the removal guard looking for
        // scheduled publications).
        const ids = query.id?.match(/^in\.\((.*)\)$/)?.[1].split(',')
        const itemIds = query.item_id?.match(/^in\.\((.*)\)$/)?.[1].split(',')
        if (!ids && !itemIds) return []
        return revisions.filter(
          (revision) =>
            (!ids || ids.includes(revision.id)) &&
            (!itemIds || itemIds.includes(revision.item_id)) &&
            (!query.status || revision.status === query.status.slice(3)),
        )
      }
      if (table === 'ck_comments') return []
      return []
    },
    async insert(table, rows) {
      assert.equal(table, 'ck_site_locales')
      siteLocales.push(...(Array.isArray(rows) ? rows : [rows]))
      return (Array.isArray(rows) ? rows : [rows]).map((row) => ({ ...row, created_at: '2026-07-30T00:00:00.000Z' }))
    },
    async remove(table, filters) {
      assert.equal(table, 'ck_site_locales')
      const locale = filters.locale.slice(3)
      const index = siteLocales.findIndex((row) => row.locale === locale)
      if (index >= 0) siteLocales.splice(index, 1)
    },
    // The locale writes run in one transaction behind a row lock, so the fake has
    // to be able to run one. `query` answers only the lock, which is the single
    // piece of raw SQL these writes use.
    async tx(run) {
      return run(txApi)
    },
  }
  const txApi = {
    ...db,
    async query(sql, values) {
      assert.match(sql, /FROM ck_sites WHERE id = \$1 FOR UPDATE/, 'the only raw statement is the site-row lock')
      return values[0] === site.id ? [lockedSite ?? site] : []
    },
  }
  return createRepository({}, db, {})
}

test('buildSnapshot excludes retired items from the rendered set', async () => {
  const repo = snapshotRepo()
  const snapshot = await repo.buildSnapshot('site-1', [], ['item-a'])
  assert.deepEqual(
    snapshot.revisions.map((revision) => revision.id),
    ['rev-b'],
  )
})

test('buildSnapshot keeps overlay semantics for items that are not retired', async () => {
  const repo = snapshotRepo()
  const snapshot = await repo.buildSnapshot('site-1', ['rev-c'], ['item-b'])
  assert.deepEqual(snapshot.revisions.map((revision) => revision.id).sort(), ['rev-a', 'rev-c'])
})

test('buildSnapshot rejects retired items from another site', async () => {
  const repo = snapshotRepo()
  await assert.rejects(
    () => repo.buildSnapshot('site-1', [], ['foreign-item']),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /retired items do not belong/)
      return true
    },
  )
})

test('buildSnapshot rejects two revisions of the same item in one release', async () => {
  // Activation would set the published pointer to only one of them
  // (nondeterministically) while the event derivation would announce both.
  const repo = snapshotRepo()
  await assert.rejects(
    () => repo.buildSnapshot('site-1', ['rev-a', 'rev-a2']),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /one revision per content item/)
      return true
    },
  )
})

test('buildSnapshot rejects publishing and retiring the same item', async () => {
  const repo = snapshotRepo()
  await assert.rejects(
    () => repo.buildSnapshot('site-1', ['rev-a'], ['item-a']),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /published and retired/)
      return true
    },
  )
})

// A site with zero locale rows does not build nothing — it builds exactly the
// default_locale tree, because of this fallback. What is missing is the record: the
// stored set says nothing while a release emits one tree, which is why the read path
// reports `locales` and `builds` separately. Building such a site *verbatim*, before
// the fallback existed, produced an assets-only release that still reported success
// — the omission first showed up as a 404 on a URL the build never emitted, which is
// how it reached the deploy canary's named deck preview.
test('buildSnapshot falls back to the default locale when a site has no locale rows', async () => {
  const repo = snapshotRepo({ siteLocales: [] })
  const snapshot = await repo.buildSnapshot('site-1', [], [])
  assert.deepEqual(
    snapshot.locales.map((entry) => entry.locale),
    ['de'],
  )
})

test('createSite always stores the default locale, even for an empty locales list', async () => {
  const inserted = []
  const db = {
    async insert(table, body) {
      inserted.push({ table, body })
      return [{ id: 'site-1' }]
    },
    async select() {
      return []
    },
  }
  const repo = createRepository({}, db, {})
  // `locales: []` is truthy, so it used to survive as zero locale rows: the site
  // then built only its default tree, with nothing recording that this was its
  // whole build matrix and nothing to add a second locale to.
  await repo.createSite({ slug: 'canary', name: 'Canary', base_url: 'https://canary.invalid', default_locale: 'DE' })
  await repo.createSite({
    slug: 'canary-2',
    name: 'Canary',
    base_url: 'https://canary.invalid',
    default_locale: 'de',
    locales: [],
  })
  await repo.createSite({
    slug: 'canary-3',
    name: 'Canary',
    base_url: 'https://canary.invalid',
    default_locale: 'de',
    locales: ['en'],
  })
  const locales = inserted
    .filter((entry) => entry.table === 'ck_site_locales')
    .map((entry) => entry.body.map((row) => row.locale))
  assert.deepEqual(locales, [['de'], ['de'], ['de', 'en']])
})

// createSite wrote the locale rows once and nothing could change them
// afterwards, so a second language was impossible to add through any door. The
// five tests below pin the invariants that make the two writes safe.
test('addSiteLocale stores the locale lowercase', async () => {
  const siteLocales = [{ site_id: 'site-1', locale: 'de' }]
  const repo = snapshotRepo({ siteLocales })
  const added = await repo.addSiteLocale('site-1', { locale: '  EN-US ' })
  assert.equal(added.locale, 'en-us')
  assert.equal(added.rebuild_required, true)
  assert.deepEqual(added.locales, ['de', 'en-us'])
  // The primary key does not case-fold, so a verbatim `EN-US` row would coexist
  // with `en-us` and build the same tree twice under two URLs.
  assert.deepEqual(
    siteLocales.map((row) => row.locale),
    ['de', 'en-us'],
  )
})

test('addSiteLocale rejects a locale the site already has', async () => {
  const repo = snapshotRepo({ siteLocales: [{ site_id: 'site-1', locale: 'de' }] })
  await assert.rejects(
    // Case-folded first: `DE` is the existing `de` row, not a new one.
    () => repo.addSiteLocale('site-1', { locale: 'DE' }),
    (error) => {
      assert.equal(error.statusCode, 409)
      assert.match(error.message, /locale de already exists/)
      return true
    },
  )
})

test('addSiteLocale rejects a tag no content could carry', async () => {
  const repo = snapshotRepo()
  await assert.rejects(
    () => repo.addSiteLocale('site-1', { locale: 'Deutsch' }),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /IETF language tag/)
      return true
    },
  )
})

test('removeSiteLocale refuses to remove the site default_locale', async () => {
  const siteLocales = [{ site_id: 'site-1', locale: 'de' }]
  const repo = snapshotRepo({ siteLocales })
  await assert.rejects(
    () => repo.removeSiteLocale('site-1', 'DE'),
    (error) => {
      assert.equal(error.statusCode, 409)
      assert.match(error.message, /default_locale/)
      return true
    },
  )
  // `/` redirects to `/{default_locale}/` and the 404 page is built from it, so
  // the row has to survive the attempt.
  assert.deepEqual(
    siteLocales.map((row) => row.locale),
    ['de'],
  )
})

test('removeSiteLocale refuses a locale that still has published content', async () => {
  const siteLocales = [
    { site_id: 'site-1', locale: 'de' },
    { site_id: 'site-1', locale: 'en' },
  ]
  const repo = snapshotRepo({
    siteLocales,
    extraItems: [
      {
        id: 'item-en',
        site_id: 'site-1',
        kind: 'post',
        locale: 'en',
        translation_key: 'a',
        published_revision_id: 'rev-en',
      },
    ],
  })
  await assert.rejects(
    () => repo.removeSiteLocale('site-1', 'en'),
    (error) => {
      assert.equal(error.statusCode, 409)
      // The counts are the point: silently dropping the row would 404 that page
      // on the next release while the build still answered success.
      assert.match(error.message, /1 published and 0 scheduled content item/)
      return true
    },
  )
  assert.deepEqual(
    siteLocales.map((row) => row.locale),
    ['de', 'en'],
  )
})

// The removal guard used to read `published_revision_id` alone. A revision with
// status='scheduled' sets no pointer, so a scheduled item was indistinguishable
// from a draft: the DELETE answered 200, POST /v1/publish-due then published the
// item into a locale the build no longer emits, and the result was an item the API
// reported as published and the site served as a 404.
test('removeSiteLocale refuses a locale whose only content is scheduled for publication', async () => {
  const siteLocales = [
    { site_id: 'site-1', locale: 'de' },
    { site_id: 'site-1', locale: 'en' },
  ]
  const repo = snapshotRepo({
    siteLocales,
    extraItems: [
      {
        id: 'item-en',
        site_id: 'site-1',
        kind: 'post',
        locale: 'en',
        translation_key: 'a',
        // Nothing is published yet — this is exactly what made it look harmless.
        published_revision_id: null,
      },
    ],
    extraRevisions: [
      {
        id: 'rev-en',
        item_id: 'item-en',
        markdown: '# en',
        status: 'scheduled',
        scheduled_at: '2099-01-01T00:00:00.000Z',
      },
    ],
  })
  await assert.rejects(
    () => repo.removeSiteLocale('site-1', 'en'),
    (error) => {
      assert.equal(error.statusCode, 409)
      assert.match(error.message, /0 published and 1 scheduled content item/)
      return true
    },
  )
  assert.deepEqual(
    siteLocales.map((row) => row.locale),
    ['de', 'en'],
    'the row has to survive, or publish-due publishes into a locale nothing builds',
  )
})

// `draft_items` is every remaining item without a published revision, which
// includes items that were published and then unpublished — the label used to say
// "never-published", a number the code never computed.
test('removeSiteLocale reports every item left with no published revision', async () => {
  const siteLocales = [
    { site_id: 'site-1', locale: 'de' },
    { site_id: 'site-1', locale: 'en' },
  ]
  const repo = snapshotRepo({
    siteLocales,
    extraItems: [
      {
        id: 'item-draft',
        site_id: 'site-1',
        kind: 'post',
        locale: 'en',
        translation_key: 'd',
        published_revision_id: null,
      },
      // Published once, unpublished since: no pointer, an archived revision.
      {
        id: 'item-was-live',
        site_id: 'site-1',
        kind: 'post',
        locale: 'en',
        translation_key: 'w',
        published_revision_id: null,
      },
    ],
    extraRevisions: [{ id: 'rev-was-live', item_id: 'item-was-live', markdown: '# w', status: 'archived' }],
  })
  const removed = await repo.removeSiteLocale('site-1', 'en')
  assert.equal(removed.draft_items, 2)
})

test('adding and removing a locale changes what buildSnapshot emits', async () => {
  const repo = snapshotRepo()
  const before = await repo.buildSnapshot('site-1', [], [])
  assert.deepEqual(
    before.locales.map((entry) => entry.locale),
    ['de'],
  )
  await repo.addSiteLocale('site-1', { locale: 'EN' })
  const added = await repo.buildSnapshot('site-1', [], [])
  assert.deepEqual(
    added.locales.map((entry) => entry.locale),
    ['de', 'en'],
  )
  const removed = await repo.removeSiteLocale('site-1', 'en')
  assert.deepEqual(removed, {
    deleted: true,
    site_id: 'site-1',
    locale: 'en',
    draft_items: 0,
    locales: ['de'],
    rebuild_required: true,
  })
  const after = await repo.buildSnapshot('site-1', [], [])
  assert.deepEqual(
    after.locales.map((entry) => entry.locale),
    ['de'],
  )
})

// A racing PATCH {default_locale:'en'} that commits after this call resolved the
// site is invisible to an unlocked read: the removal then validated against the old
// default, deleted the row, and left the site with a default_locale nothing builds.
// The locked re-read is what makes the pair serialize.
test('removeSiteLocale re-reads default_locale under the lock, so a racing PATCH cannot orphan it', async () => {
  const siteLocales = [
    { site_id: 'site-1', locale: 'de' },
    { site_id: 'site-1', locale: 'en' },
  ]
  const repo = snapshotRepo({
    siteLocales,
    // What the transaction sees once it holds the lock: the racing PATCH committed.
    lockedSite: { id: 'site-1', slug: 'site-1', default_locale: 'en', base_url: 'https://example.com', settings: {} },
  })
  await assert.rejects(
    () => repo.removeSiteLocale('site-1', 'en'),
    (error) => {
      assert.equal(error.statusCode, 409)
      assert.match(error.message, /default_locale/)
      return true
    },
  )
  assert.deepEqual(
    siteLocales.map((row) => row.locale),
    ['de', 'en'],
  )
})

test('siteLocales reports the stored rows, what the next release builds and the cap', async () => {
  const repo = snapshotRepo({ siteLocales: [{ site_id: 'site-1', locale: 'de', created_at: 'c' }] })
  const listed = await repo.siteLocales('site-1')
  assert.equal(listed.site_id, 'site-1')
  assert.equal(listed.default_locale, 'de')
  assert.deepEqual(listed.locales, [{ locale: 'de', created_at: 'c' }])
  assert.deepEqual(listed.builds, ['de'])
  assert.equal(listed.max_locales, 32)
  // A site with no rows at all is the case the documentation used to get wrong: it
  // does not build nothing, it builds default_locale. The read path has to say so,
  // or a locale editor shows an empty set for a site that serves pages.
  const zero = await snapshotRepo({ siteLocales: [] }).siteLocales('site-1')
  assert.deepEqual(zero.locales, [])
  assert.deepEqual(zero.builds, ['de'])
})

// Every locale row multiplies the build matrix — one page tree, with home,
// listings, tags, feeds and a 404, per row and per release.
test('addSiteLocale caps the number of locales a site builds', async () => {
  const tags = [...'abcdefghijklmnopqrstuvwxyzabcdef'].map((letter, index) => `${index < 26 ? 'a' : 'b'}${letter}`)
  const siteLocales = ['de', ...tags.slice(0, 31)].map((locale) => ({ site_id: 'site-1', locale }))
  assert.equal(siteLocales.length, 32)
  const repo = snapshotRepo({ siteLocales })
  await assert.rejects(
    () => repo.addSiteLocale('site-1', { locale: 'fr' }),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /at most 32 locales/)
      return true
    },
  )
  assert.equal(siteLocales.length, 32)
})

// F7, door one: content entering. The locale set was only ever read by the
// builder, so `locale: en` on a site that builds `de` produced an item and a
// revision for a page no release can emit — publishable, listed by the read API and
// a 404 on the site.
test('ingest refuses a document in a locale the site does not build', async () => {
  const db = {
    async select(table) {
      return table === 'ck_site_locales' ? [{ locale: 'de' }] : []
    },
    async insert(table) {
      assert.fail(`nothing may be written: ${table}`)
    },
  }
  const repo = createRepository({}, db, { async upload() {} })
  const md = '---\nkind: post\ntitle: T\nlocale: en\nslug: t\ntranslationKey: t\n---\n# T'
  await assert.rejects(
    () => repo.ingest('site-1', md),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /locale en is not a locale this site builds \(de\)/)
      return true
    },
  )
})

// The check is against what a release builds, not against the rows: a site
// provisioned with no rows still builds its default_locale tree, so its content
// must keep ingesting.
test('ingest accepts the default locale of a site that carries no locale rows', async () => {
  const inserted = []
  const db = {
    async select(table) {
      return table === 'ck_sites' ? [{ id: 'site-1', default_locale: 'de' }] : []
    },
    async insert(table, body) {
      inserted.push(table)
      const rows = Array.isArray(body) ? body : [body]
      return rows.map((row, index) => ({ id: `id-${index}`, ...row }))
    },
  }
  const repo = createRepository({}, db, { async upload() {} })
  const md = '---\nkind: post\ntitle: T\nlocale: de\nslug: t\ntranslationKey: t\n---\n# T'
  const result = await repo.ingest('site-1', md)
  assert.equal(result.revision.title, 'T')
  assert.ok(inserted.includes('ck_content_revisions'))
})

// F7, door two: publishing. Reached when the item was ingested first and the locale
// removed later, or when a scheduled publish lands after the removal.
test('buildSnapshot refuses to publish a revision whose locale the site does not build', async () => {
  const repo = snapshotRepo({
    siteLocales: [{ site_id: 'site-1', locale: 'de' }],
    extraItems: [
      {
        id: 'item-en',
        site_id: 'site-1',
        kind: 'post',
        locale: 'en',
        translation_key: 'a',
        published_revision_id: null,
      },
    ],
    extraRevisions: [{ id: 'rev-en', item_id: 'item-en', markdown: '# en', status: 'draft' }],
  })
  await assert.rejects(
    () => repo.buildSnapshot('site-1', ['rev-en'], []),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /cannot publish into locale\(s\) en/)
      return true
    },
  )
  // Only the revisions this release publishes are checked. An item published before
  // the rule (or before its locale went away) keeps its pointer, or the site could
  // never build another release at all.
  const snapshot = await snapshotRepo({
    siteLocales: [{ site_id: 'site-1', locale: 'de' }],
    extraItems: [
      {
        id: 'item-en',
        site_id: 'site-1',
        kind: 'post',
        locale: 'en',
        translation_key: 'a',
        published_revision_id: 'rev-en',
      },
    ],
    extraRevisions: [{ id: 'rev-en', item_id: 'item-en', markdown: '# en', status: 'published' }],
  }).buildSnapshot('site-1', [], [])
  assert.deepEqual(
    snapshot.locales.map((entry) => entry.locale),
    ['de'],
  )
})

// F9: the two doors that write locale rows have to validate identically, or the
// stricter one is decoration. `Deutsch` passed here and 422s at
// POST /v1/sites/{site}/locales.
test('createSite validates the locale shape on both default_locale and locales', async () => {
  const createDb = () => ({
    inserted: [],
    async insert(table, body) {
      this.inserted.push({ table, body })
      return [{ id: 'site-1' }]
    },
    async select() {
      return []
    },
  })
  for (const input of [
    { default_locale: 'Deutsch' },
    { default_locale: 'de', locales: ['English'] },
    { default_locale: 'de', locales: ['de_AT'] },
  ]) {
    const db = createDb()
    await assert.rejects(
      () =>
        createRepository({}, db, {}).createSite({
          slug: 'canary',
          name: 'Canary',
          base_url: 'https://canary.invalid',
          ...input,
        }),
      (error) => {
        assert.equal(error.statusCode, 422)
        assert.match(error.message, /IETF language tag/)
        return true
      },
      `expected ${JSON.stringify(input)} to be rejected`,
    )
    // The site row must not exist either: a site whose only locale row can never
    // hold a document is one nothing can repair, because the row is the default.
    assert.deepEqual(db.inserted, [])
  }
  const db = createDb()
  await createRepository({}, db, {}).createSite({
    slug: 'canary',
    name: 'Canary',
    base_url: 'https://canary.invalid',
    default_locale: ' DE ',
    locales: ['EN-US'],
  })
  assert.equal(db.inserted[0].body.default_locale, 'de')
  assert.deepEqual(
    db.inserted[1].body.map((row) => row.locale),
    ['de', 'en-us'],
  )
})

test('createSite caps the initial locale set', async () => {
  const db = {
    inserted: [],
    async insert(table) {
      this.inserted.push(table)
      return [{ id: 'site-1' }]
    },
    async select() {
      return []
    },
  }
  const locales = ['a', 'b'].flatMap((first) => [...'abcdefghijklmnopqrst'].map((second) => `${first}${second}`))
  assert.equal(new Set(locales).size, 40)
  await assert.rejects(
    () =>
      createRepository({}, db, {}).createSite({
        slug: 'canary',
        name: 'Canary',
        base_url: 'https://canary.invalid',
        default_locale: 'de',
        locales,
      }),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /at most 32 locales/)
      return true
    },
  )
  assert.deepEqual(db.inserted, [])
})

function enqueueDb({ endpoints = [] }) {
  const inserts = []
  return {
    inserts,
    async insert(table, body) {
      inserts.push({ table, body })
      return Array.isArray(body) ? body : [body]
    },
    async select(table, query = {}) {
      if (table === 'ck_webhook_endpoints') {
        // Emulate the DB-side filter the repository relies on.
        return query.disabled_at === 'is.null' ? endpoints.filter((e) => !e.disabled_at) : endpoints
      }
      if (table === 'ck_sites') return [{ id: 'site-1', name: 'Site' }]
      return []
    },
  }
}

test('enqueueEvent fans out to matching endpoints plus the env fallback', async () => {
  const db = enqueueDb({
    endpoints: [
      { id: 'ep-all', events: [], disabled_at: null },
      { id: 'ep-contact', events: ['contact.submitted'], disabled_at: null },
      { id: 'ep-comment', events: ['comment.submitted'], disabled_at: null },
    ],
  })
  const repo = createRepository({ webhookUrl: 'https://env.example/hook' }, db, {})
  await repo.enqueueEvent(db, {
    site: { id: 'site-1', name: 'Site' },
    type: 'contentkit.contact.submitted',
    resourceKind: 'contact',
    resourceId: 'c-1',
    data: { email: 'a@b.c' },
  })
  const deliveries = db.inserts.find((i) => i.table === 'ck_webhook_deliveries').body
  const targets = deliveries.map((d) => d.endpoint_id)
  // ep-all (no filter) + ep-contact (matches) + null (env fallback); NOT ep-comment
  assert.deepEqual(new Set(targets), new Set(['ep-all', 'ep-contact', null]))
  assert.equal(deliveries[0].payload.data.email, 'a@b.c')
})

test('enqueueEvent skips disabled endpoints and omits env fallback when unconfigured', async () => {
  const db = enqueueDb({ endpoints: [{ id: 'ep-off', events: [], disabled_at: '2026-01-01T00:00:00Z' }] })
  const repo = createRepository({ webhookUrl: '' }, db, {})
  await repo.enqueueEvent(db, {
    site: { id: 'site-1', name: 'Site' },
    type: 'contentkit.comment.submitted',
    resourceKind: 'comment',
    resourceId: 'x',
  })
  // Disabled endpoints are filtered out by the select's disabled_at is.null guard;
  // our mock returns it anyway, so assert enqueue used the guard by checking no deliveries insert.
  const deliveryInsert = db.inserts.find((i) => i.table === 'ck_webhook_deliveries')
  assert.equal(deliveryInsert, undefined)
})

test('enqueueContentEvents loads endpoints once and fans out per event with filter matching', async () => {
  const selects = []
  const inserts = []
  const db = {
    async insert(table, body) {
      inserts.push({ table, body })
      return Array.isArray(body) ? body : [body]
    },
    async select(table, query = {}) {
      selects.push({ table, query })
      return [
        { id: 'ep-all', events: [], disabled_at: null },
        { id: 'ep-content', events: ['content.published'], disabled_at: null },
        { id: 'ep-contact', events: ['contact.submitted'], disabled_at: null },
      ]
    },
  }
  const repo = createRepository({ webhookUrl: 'https://env.example/hook' }, db, {})
  const eventIds = await repo.enqueueContentEvents(db, { id: 'site-1', name: 'Site' }, [
    {
      type: 'contentkit.content.published',
      resourceKind: 'content',
      resourceId: 'item-1',
      summary: 'Content published',
      data: { item_id: 'item-1', slug: 'hello' },
    },
    {
      type: 'contentkit.release.published',
      resourceKind: 'release',
      resourceId: 'release-1',
      summary: 'Site release published',
      data: { release_id: 'release-1' },
    },
  ])
  assert.equal(selects.filter((call) => call.table === 'ck_webhook_endpoints').length, 1)

  const outbox = inserts.find((call) => call.table === 'ck_outbox_events').body
  assert.equal(outbox.length, 2)
  assert.deepEqual(
    eventIds,
    outbox.map((row) => row.id),
  )
  assert.equal(outbox[0].payload.data.slug, 'hello')
  assert.deepEqual(outbox[0].payload.resource, { kind: 'content', id: 'item-1' })
  assert.deepEqual(outbox[0].payload.site, { id: 'site-1', name: 'Site' })

  // content.published: ep-all + ep-content + env; release.published: ep-all + env.
  const deliveries = inserts.find((call) => call.table === 'ck_webhook_deliveries').body
  const byType = (type) => deliveries.filter((row) => row.type === type).map((row) => row.endpoint_id)
  assert.deepEqual(new Set(byType('contentkit.content.published')), new Set(['ep-all', 'ep-content', null]))
  assert.deepEqual(new Set(byType('contentkit.release.published')), new Set(['ep-all', null]))
  assert.ok(deliveries.every((row) => row.event_id && row.payload && row.status === 'pending'))
})

test('enqueueContentEvents with no events writes nothing and returns an empty list', async () => {
  const calls = []
  const db = {
    async insert(...args) {
      calls.push(args)
      return []
    },
    async select(...args) {
      calls.push(args)
      return []
    },
  }
  const repo = createRepository({ webhookUrl: '' }, db, {})
  assert.deepEqual(await repo.enqueueContentEvents(db, { id: 'site-1', name: 'Site' }, []), [])
  assert.equal(calls.length, 0)
})

test('buildSnapshot returns the item list and overlay revisions alongside the rendered set', async () => {
  const repo = snapshotRepo()
  const snapshot = await repo.buildSnapshot('site-1', ['rev-c'], ['item-b'])
  assert.deepEqual(
    snapshot.items.map((item) => item.id),
    ['item-a', 'item-b', 'item-c'],
  )
  assert.deepEqual(
    snapshot.overlay.map((revision) => revision.id),
    ['rev-c'],
  )
})

test('ingest rejects every browser-executable asset content type', async () => {
  const db = {
    // Ingest now reads the site's locale rows: a document in a locale the site does
    // not build is refused before any asset is uploaded.
    async select(table) {
      return table === 'ck_site_locales' ? [{ locale: 'de' }] : []
    },
    async insert(table, body) {
      return Array.isArray(body) ? body : [body]
    },
  }
  const storage = { async upload() {} }
  const repo = createRepository({}, db, storage)
  const md = '---\nkind: post\ntitle: T\nlocale: de\nslug: t\ntranslationKey: t\n---\n# T'
  // Each type served inline from /media would execute as active content — svg is
  // the notable image-looking one. Pin the whole block-list so narrowing it fails.
  for (const contentType of [
    'text/html',
    'image/svg+xml',
    'application/xhtml+xml',
    'application/xml',
    'text/xml',
    'IMAGE/SVG+XML; charset=utf-8',
  ]) {
    await assert.rejects(
      () => repo.ingest('site-1', md, [{ name: 'asset:x', contentType, body: Buffer.from('<script>') }]),
      (error) => {
        assert.equal(error.statusCode, 422)
        assert.match(error.message, /not allowed/)
        return true
      },
      `expected ${contentType} to be rejected`,
    )
  }
})

test('ingest accepts a normal image content type', async () => {
  const inserted = []
  const db = {
    async select(table) {
      return table === 'ck_site_locales' ? [{ locale: 'de' }] : []
    },
    async insert(table, body) {
      const rows = Array.isArray(body) ? body : [body]
      inserted.push(table)
      return rows.map((r, i) => ({ id: `id-${i}`, ...r }))
    },
  }
  const storage = { async upload() {} }
  const repo = createRepository({}, db, storage)
  const md = '---\nkind: post\ntitle: T\nlocale: de\nslug: t\ntranslationKey: t\n---\n# T ![x](img.png)'
  const result = await repo.ingest('site-1', md, [
    { name: 'asset:img.png', contentType: 'image/png', body: Buffer.from('PNG') },
  ])
  assert.equal(result.assets.length, 1)
})

test('revision reads shed the search_vector index internal (SELECT * / RETURNING *)', async () => {
  // Migration 0006 adds search_vector to ck_content_revisions; a serialized
  // tsvector is roughly document-sized and no API consumer expects it.
  const db = {
    async select(table) {
      if (table === 'ck_content_revisions')
        return [{ id: 'rev-1', item_id: 'item-1', markdown: '# a', search_vector: "'a':1" }]
      return []
    },
    async insert(table, body) {
      const rows = Array.isArray(body) ? body : [body]
      return rows.map((row, i) => ({ id: `id-${i}`, ...row, search_vector: "'t':1" }))
    },
  }
  const repo = createRepository({}, db, { async upload() {} })
  const revisions = await repo.revisions('item-1')
  assert.ok(!('search_vector' in revisions[0]))
  assert.equal(revisions[0].id, 'rev-1')

  const md = '---\nkind: post\ntitle: T\nlocale: de\nslug: t\ntranslationKey: t\n---\n# T\n\nBody.'
  const dbEmpty = {
    async select(table) {
      return table === 'ck_site_locales' ? [{ locale: 'de' }] : []
    },
    insert: db.insert,
  }
  const ingested = await createRepository({}, dbEmpty, { async upload() {} }).ingest('site-1', md)
  assert.ok(!('search_vector' in ingested.revision))
  assert.equal(ingested.revision.title, 'T')
})

// updateSite spans two tables: `default_locale` lives on ck_sites and the set it
// must belong to in ck_site_locales. The fake records which executor every call
// arrived on, because that is the whole point of the fix — a write on the pool
// executor is the unsynchronized one a concurrent locale removal raced.
// `txLocales` models the racing transaction having already committed: the pool
// still answers the old locale set, the transaction sees the new one.
function siteWriteDb({
  locales = [{ locale: 'de' }],
  txLocales = null,
  site = { id: 'site-1', name: 'Example' },
} = {}) {
  const calls = []
  const tx = {
    async select(table) {
      calls.push(['tx-select', table])
      return table === 'ck_site_locales' ? (txLocales ?? locales) : [site]
    },
    async update(table, filters, body) {
      calls.push(['update', table, body])
      return [{ ...site, ...body }]
    },
    async remove(table, filters) {
      calls.push(['remove', table, filters])
    },
    async insert(table, rows) {
      calls.push(['insert', table, rows])
      return rows
    },
    async query(sql, values) {
      assert.match(sql, /FROM ck_sites WHERE id = \$1 FOR UPDATE/)
      calls.push(['lock', values[0]])
      return [site]
    },
  }
  const db = {
    async select(table) {
      calls.push(['pool-select', table])
      return table === 'ck_site_locales' ? locales : [site]
    },
    async update(table, filters, body) {
      calls.push(['pool-update', table, body])
      return [{ ...site, ...body }]
    },
    async tx(run) {
      return run(tx)
    },
  }
  return { repo: createRepository({}, db, {}), calls }
}

test('updateSite rejects a default_locale not among the site locales', async () => {
  const { repo } = siteWriteDb()
  await assert.rejects(
    () => repo.updateSite('site-1', { default_locale: 'fr' }),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /site locales/)
      return true
    },
  )
})

test('updateSite accepts and lowercases a valid default_locale', async () => {
  const { repo, calls } = siteWriteDb()
  await repo.updateSite('site-1', { default_locale: 'DE' })
  const update = calls.find(([op]) => op === 'update')
  assert.equal(update[2].default_locale, 'de')
})

// The invariant is cross-table, so the read that validates it and the write that
// depends on it have to be one atomic step behind one lock. Unlocked, a concurrent
// PATCH {default_locale:'en'} and DELETE /locales/en each validated against the
// state the other was about to change and both committed: default_locale='en' with
// no `en` row — a root redirect and a 404 page pointing into a tree no release
// emits.
test('updateSite validates default_locale against the locked, transactional read', async () => {
  const { repo, calls } = siteWriteDb({ locales: [{ locale: 'de' }, { locale: 'en' }], txLocales: [{ locale: 'de' }] })
  await assert.rejects(
    () => repo.updateSite('site-1', { default_locale: 'en' }),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.match(error.message, /site locales/)
      return true
    },
  )
  assert.deepEqual(
    calls.map(([op]) => op),
    ['lock', 'tx-select'],
    'the site row is locked first, then the locale rows are read inside the transaction',
  )
  assert.ok(!calls.some(([op]) => op === 'pool-update' || op === 'update'), 'nothing is written when the check fails')
})

test('updateSite replaces domains in full, lowercased; absent domains leave mappings alone', async () => {
  const { repo, calls: recorded } = siteWriteDb()
  const calls = recorded

  // Domains-only PATCH: no ck_sites update, but the row still comes back.
  const site = await repo.updateSite('site-1', { domains: ['Verify.Example', 'www.verify.example'] })
  assert.equal(site.id, 'site-1')
  assert.deepEqual(calls[0], ['remove', 'ck_site_domains', { site_id: 'eq.site-1' }])
  assert.equal(calls[1][1], 'ck_site_domains')
  assert.deepEqual(
    calls[1][2].map((row) => row.hostname),
    ['verify.example', 'www.verify.example'],
  )
  assert.ok(
    calls[1][2].every((row) => row.verified_at),
    'PATCHed domains are verified like created ones',
  )
  assert.ok(!calls.some(([op]) => op === 'update'), 'a domains-only PATCH must not touch ck_sites')
  // The read-back of the row happens inside the same transaction as the domain
  // replacement, so a domains-only PATCH cannot report a state it did not commit.
  assert.equal(calls.at(-1)[0], 'tx-select')

  // Empty array removes every mapping without inserting.
  calls.length = 0
  await repo.updateSite('site-1', { domains: [] })
  assert.deepEqual(
    calls.map(([op]) => op),
    ['remove', 'tx-select'],
  )

  // Absent domains and no default_locale: nothing spans two tables, so this stays
  // one statement on the pool executor — no transaction is opened for it.
  calls.length = 0
  await repo.updateSite('site-1', { name: 'Renamed' })
  assert.deepEqual(
    calls.map(([op]) => op),
    ['pool-update'],
  )
})

test('updateSite rejects an empty-string default_locale (guard on presence, not truthiness)', async () => {
  const { repo } = siteWriteDb()
  await assert.rejects(
    () => repo.updateSite('site-1', { default_locale: '' }),
    (error) => {
      assert.equal(error.statusCode, 422)
      return true
    },
  )
})

// Published read API fixture: three published posts (two sharing an
// updated_at so the item-id tiebreak is observable), one draft-only post and
// one published page.
function publishedRepo() {
  const items = [
    {
      id: 'item-1',
      site_id: 'site-1',
      kind: 'post',
      locale: 'de',
      translation_key: 'one',
      published_revision_id: 'rev-1',
      updated_at: '2026-07-03T10:00:00.000Z',
    },
    {
      id: 'item-2',
      site_id: 'site-1',
      kind: 'post',
      locale: 'de',
      translation_key: 'two',
      published_revision_id: 'rev-2',
      updated_at: '2026-07-02T10:00:00.000Z',
    },
    {
      id: 'item-3',
      site_id: 'site-1',
      kind: 'post',
      locale: 'de',
      translation_key: 'three',
      published_revision_id: 'rev-3',
      updated_at: '2026-07-02T10:00:00.000Z',
    },
    {
      id: 'item-4',
      site_id: 'site-1',
      kind: 'post',
      locale: 'de',
      translation_key: 'draft',
      published_revision_id: null,
      updated_at: '2026-07-04T10:00:00.000Z',
    },
    {
      id: 'item-5',
      site_id: 'site-1',
      kind: 'page',
      locale: 'de',
      translation_key: 'five',
      published_revision_id: 'rev-5',
      updated_at: '2026-07-01T10:00:00.000Z',
    },
  ]
  const revision = (id, slug, title, tags, markdown = `# ${title}`) => ({
    id,
    item_id: `item-${id.slice(4)}`,
    slug,
    title,
    summary: `${title} summary`,
    tags,
    metadata: { kind: 'post', title, extra: { series: slug } },
    markdown,
    source_sha256: `sha-${id}`,
    published_at: '2026-07-01T00:00:00.000Z',
  })
  const revisions = [
    revision(
      'rev-1',
      'one',
      'One',
      ['a', 'b'],
      '---\nkind: post\ntitle: One\nlocale: de\nslug: one\n---\n\n**Hello** read API.',
    ),
    revision('rev-2', 'two', 'Two', ['a']),
    revision('rev-3', 'three', 'Three', ['b']),
    revision(
      'rev-5',
      'five',
      'Five',
      [],
      '---\nkind: page\nlayout: composition\ntitle: Five\nlocale: de\nslug: five\ncomposition:\n  format: report\n  canvas: flow\n  intent: status\n---\n:::chart{type="bar" title="Werte" description="Werte nach Monat"}\n| Monat | Wert |\n|-|-:|\n| Jan | 5 |\n:::',
    ),
  ]
  const db = {
    async select(table, query = {}) {
      if (table === 'ck_content_items') {
        return items.filter(
          (item) =>
            (!query.site_id || query.site_id === `eq.${item.site_id}`) &&
            (!query.kind || query.kind === `eq.${item.kind}`) &&
            (!query.locale || query.locale === `eq.${item.locale}`),
        )
      }
      if (table === 'ck_content_revisions') {
        const wanted = query.id?.match(/^in\.\((.*)\)$/)?.[1].split(',') || []
        return revisions.filter((row) => wanted.includes(row.id) && (!query.slug || query.slug === `eq.${row.slug}`))
      }
      return []
    },
  }
  return createRepository({}, db, {})
}

test('listPublished merges items with their published revisions and skips drafts', async () => {
  const repo = publishedRepo()
  const { items, next_cursor } = await repo.listPublished('site-1', {})
  assert.deepEqual(
    items.map((entry) => entry.item_id),
    ['item-1', 'item-2', 'item-3', 'item-5'],
  )
  assert.equal(next_cursor, null)
  // The entry shape: item identity + revision fields, metadata verbatim.
  assert.deepEqual(items[0], {
    item_id: 'item-1',
    kind: 'post',
    locale: 'de',
    translation_key: 'one',
    slug: 'one',
    title: 'One',
    summary: 'One summary',
    tags: ['a', 'b'],
    metadata: { kind: 'post', title: 'One', extra: { series: 'one' } },
    report_series: null,
    revision_id: 'rev-1',
    revision_sha256: 'sha-rev-1',
    published_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-03T10:00:00.000Z',
  })
})

test('published reads expose the authored report series as report_series', async () => {
  const repo = publishedRepo()
  const listed = await repo.listPublished('site-1', {})
  const report = listed.items.find((entry) => entry.item_id === 'item-5')
  assert.equal(report.report_series, null)

  const db = {
    async select(table) {
      if (table === 'ck_content_items')
        return [
          {
            id: 'report-item',
            site_id: 'site-1',
            kind: 'page',
            locale: 'en',
            translation_key: 'report',
            published_revision_id: 'report-revision',
            updated_at: '2026-07-20T10:00:00.000Z',
          },
        ]
      if (table === 'ck_content_revisions')
        return [
          {
            id: 'report-revision',
            item_id: 'report-item',
            slug: 'report',
            title: 'Report',
            summary: 'Report summary',
            tags: [],
            metadata: { report_series: 'operations' },
            published_at: '2026-07-20T09:00:00.000Z',
          },
        ]
      return []
    },
  }
  const seriesRepo = createRepository({}, db, {})
  const result = await seriesRepo.listPublished('site-1', {})
  assert.equal(result.items[0].report_series, 'operations')
})

test('listPublished filters by kind, tag and updated_since (strictly greater)', async () => {
  const repo = publishedRepo()
  const posts = await repo.listPublished('site-1', { kind: 'post' })
  assert.deepEqual(
    posts.items.map((entry) => entry.item_id),
    ['item-1', 'item-2', 'item-3'],
  )
  const tagged = await repo.listPublished('site-1', { tag: 'a' })
  assert.deepEqual(
    tagged.items.map((entry) => entry.item_id),
    ['item-1', 'item-2'],
  )
  // Strictly greater: the entry carrying exactly this updated_at is excluded.
  const since = await repo.listPublished('site-1', { updated_since: '2026-07-02T10:00:00.000Z' })
  assert.deepEqual(
    since.items.map((entry) => entry.item_id),
    ['item-1'],
  )
})

test('listPublished pages stably through an updated_at tie via the cursor', async () => {
  const repo = publishedRepo()
  const first = await repo.listPublished('site-1', { limit: '2' })
  assert.deepEqual(
    first.items.map((entry) => entry.item_id),
    ['item-1', 'item-2'],
  )
  assert.ok(first.next_cursor)
  // The tie (item-2/item-3 share updated_at) is split across pages; the item-id
  // tiebreak in the cursor must resume at item-3 without repeating item-2.
  const second = await repo.listPublished('site-1', { limit: '2', cursor: first.next_cursor })
  assert.deepEqual(
    second.items.map((entry) => entry.item_id),
    ['item-3', 'item-5'],
  )
  assert.equal(second.next_cursor, null)
})

test('listPublished rejects malformed query parameters with 422 and clamps oversized limits', async () => {
  const repo = publishedRepo()
  const rejects = async (query, message) =>
    assert.rejects(
      () => repo.listPublished('site-1', query),
      (error) => {
        assert.equal(error.statusCode, 422)
        assert.equal(error.message, message)
        return true
      },
    )
  await rejects({ kind: 'article' }, 'kind must be page, post, project or deck')
  await rejects({ updated_since: 'not-a-date' }, 'updated_since must be an ISO 8601 timestamp')
  await rejects({ limit: 'abc' }, 'limit must be a positive integer')
  await rejects({ limit: '0' }, 'limit must be a positive integer')
  await rejects({ cursor: '%%%' }, 'cursor is invalid')
  // Values above the cap are clamped silently, not rejected.
  const clamped = await repo.listPublished('site-1', { limit: '999' })
  assert.equal(clamped.items.length, 4)
})

test('getPublished returns the merged document with markdown verbatim and on-demand html', async () => {
  const repo = publishedRepo()
  const doc = await repo.getPublished('site-1', 'post', 'de', 'one')
  assert.equal(doc.item_id, 'item-1')
  assert.equal(doc.revision_id, 'rev-1')
  assert.equal(doc.revision_sha256, 'sha-rev-1')
  assert.equal(doc.markdown, '---\nkind: post\ntitle: One\nlocale: de\nslug: one\n---\n\n**Hello** read API.')
  assert.match(doc.html, /<strong>Hello<\/strong>/)
  assert.equal(doc.source_sha256, 'sha-rev-1')
  assert.deepEqual(doc.metadata, { kind: 'post', title: 'One', extra: { series: 'one' } })
})

test('getPublished materializes report charts as self-contained data images', async () => {
  const repo = publishedRepo()
  const doc = await repo.getPublished('site-1', 'page', 'de', 'five')
  assert.match(doc.html, /<picture class="report-chart-picture">/)
  assert.match(doc.html, /data:image\/svg\+xml;base64,/)
  assert.doesNotMatch(doc.html, /data-report-chart/)
  assert.match(doc._composition_assets.light.svg, /^<svg/)
  assert.equal(doc._composition_assets.light.png, undefined, 'ordinary document reads must not rasterize PNGs')
  assert.match(doc.representations.png, /composition\.png$/)
})

test('getPublished rasterizes PNG only when that representation is requested', async () => {
  const repo = publishedRepo()
  const doc = await repo.getPublished('site-1', 'page', 'de', 'five', { formats: ['png'] })
  assert.ok(Buffer.isBuffer(doc._composition_assets.light.png))
  assert.ok(doc._composition_assets.light.png.length > 0)
})

test('getPublished is null for drafts and for a kind/locale/slug mismatch', async () => {
  const repo = publishedRepo()
  assert.equal(await repo.getPublished('site-1', 'post', 'de', 'draft'), null)
  assert.equal(await repo.getPublished('site-1', 'page', 'de', 'one'), null)
  assert.equal(await repo.getPublished('site-1', 'post', 'en', 'one'), null)
  assert.equal(await repo.getPublished('site-1', 'post', 'de', 'nope'), null)
})

test('createAccessUser validates groups before inserting the account', async () => {
  const calls = []
  const tx = {
    async select(table) {
      calls.push(['select', table])
      return table === 'ck_access_groups' ? [{ id: 'group-1', slug: 'customers' }] : []
    },
    async insert(table) {
      calls.push(['insert', table])
      return []
    },
  }
  const repo = createRepository(
    {},
    {
      async tx(fn) {
        return fn(tx)
      },
    },
    {},
  )

  await assert.rejects(
    () =>
      repo.createAccessUser('site-1', {
        username: 'anna',
        password: 'correct horse battery staple',
        groups: ['missing'],
      }),
    (error) => error.statusCode === 422 && error.message === 'one or more access groups do not exist',
  )
  assert.ok(!calls.some(([operation]) => operation === 'insert'))
})

test('updateAccessUser validates replacement groups before changing the account', async () => {
  const calls = []
  const tx = {
    async select(table) {
      calls.push(['select', table])
      if (table === 'ck_access_users') return [{ id: 'user-1', site_id: 'site-1', username: 'anna' }]
      if (table === 'ck_access_groups') return [{ id: 'group-1', slug: 'customers' }]
      return []
    },
    async update(table) {
      calls.push(['update', table])
      return []
    },
  }
  const repo = createRepository(
    {},
    {
      async tx(fn) {
        return fn(tx)
      },
    },
    {},
  )

  await assert.rejects(
    () => repo.updateAccessUser('site-1', 'user-1', { display_name: 'Anna', groups: ['missing'] }),
    (error) => error.statusCode === 422 && error.message === 'one or more access groups do not exist',
  )
  assert.ok(!calls.some(([operation]) => operation === 'update'))
})

test('access grants reject malformed reader IDs before querying PostgreSQL', async () => {
  const repo = createRepository(
    {},
    {
      async select() {
        throw new Error('malformed IDs must not reach the database')
      },
    },
    {},
  )
  await assert.rejects(
    () => repo.validateAccessGrant('site-1', { users: ['not-a-uuid'] }),
    (error) => error.statusCode === 422 && error.message === 'users must contain UUIDs',
  )
})

test('creating an API key returns the raw secret but never the stored hash', async () => {
  const repo = createRepository(
    { keyPepper: 'test-pepper' },
    {
      async insert(table, row) {
        assert.equal(table, 'ck_api_keys')
        return [{ id: 'key-1', created_at: '2026-07-29T00:00:00Z', revoked_at: null, ...row }]
      },
    },
    {},
  )
  const created = await repo.createApiKey({ name: 'site-admin', scopes: ['site:admin'], site_ids: [] })
  assert.equal(created.name, 'site-admin')
  assert.ok(created.key.startsWith('ck_'))
  assert.equal(created.key_prefix, created.key.slice(0, 11))
  assert.ok(!('key_hash' in created))
})
