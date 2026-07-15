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
