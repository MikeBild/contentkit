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

function snapshotRepo() {
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
  ]
  const revisions = [
    { id: 'rev-a', item_id: 'item-a', markdown: '# a' },
    { id: 'rev-a2', item_id: 'item-a', markdown: '# a v2' },
    { id: 'rev-b', item_id: 'item-b', markdown: '# b' },
    { id: 'rev-c', item_id: 'item-c', markdown: '# c' },
  ]
  const db = {
    async select(table, query = {}) {
      if (table === 'ck_sites') return query.slug === 'eq.site-1' || query.id === 'eq.site-1' ? [site] : []
      if (table === 'ck_site_locales') return [{ site_id: 'site-1', locale: 'de' }]
      if (table === 'ck_content_items') return items
      if (table === 'ck_content_revisions') {
        const wanted = query.id?.match(/^in\.\((.*)\)$/)?.[1].split(',') || []
        return revisions.filter((revision) => wanted.includes(revision.id))
      }
      if (table === 'ck_comments') return []
      return []
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
    async select() {
      return []
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
    async select() {
      return []
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
    async select() {
      return []
    },
    insert: db.insert,
  }
  const ingested = await createRepository({}, dbEmpty, { async upload() {} }).ingest('site-1', md)
  assert.ok(!('search_vector' in ingested.revision))
  assert.equal(ingested.revision.title, 'T')
})

test('updateSite rejects a default_locale not among the site locales', async () => {
  const db = {
    async select(table) {
      return table === 'ck_site_locales' ? [{ locale: 'de' }] : []
    },
    async update() {
      return [{}]
    },
  }
  const repo = createRepository({}, db, {})
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
  const updated = []
  const db = {
    async select() {
      return [{ locale: 'de' }]
    },
    async update(table, filters, body) {
      updated.push(body)
      return [{ id: 'site-1', ...body }]
    },
  }
  const repo = createRepository({}, db, {})
  await repo.updateSite('site-1', { default_locale: 'DE' })
  assert.equal(updated[0].default_locale, 'de')
})

test('updateSite replaces domains in full, lowercased; absent domains leave mappings alone', async () => {
  const calls = []
  const txApi = {
    async remove(table, filters) {
      calls.push(['remove', table, filters])
    },
    async insert(table, rows) {
      calls.push(['insert', table, rows])
      return rows
    },
  }
  const db = {
    async select(table) {
      return table === 'ck_site_locales' ? [{ locale: 'de' }] : [{ id: 'site-1', name: 'Example' }]
    },
    async update(table, filters, body) {
      calls.push(['update', table, body])
      return [{ id: 'site-1', ...body }]
    },
    async tx(fn) {
      return fn(txApi)
    },
  }
  const repo = createRepository({}, db, {})

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

  // Empty array removes every mapping without inserting.
  calls.length = 0
  await repo.updateSite('site-1', { domains: [] })
  assert.deepEqual(
    calls.map(([op]) => op),
    ['remove'],
  )

  // Absent domains: plain metadata update, no domain writes.
  calls.length = 0
  await repo.updateSite('site-1', { name: 'Renamed' })
  assert.deepEqual(
    calls.map(([op]) => op),
    ['update'],
  )
})

test('updateSite rejects an empty-string default_locale (guard on presence, not truthiness)', async () => {
  const db = {
    async select(table) {
      return table === 'ck_site_locales' ? [{ locale: 'de' }] : []
    },
    async update() {
      return [{}]
    },
  }
  const repo = createRepository({}, db, {})
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
