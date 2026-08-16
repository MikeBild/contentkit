import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS, AUDIT_TRANSPORTS } from '../../src/audit.mjs'
import { createApp } from '../../src/server.mjs'
import { createRepository } from '../../src/repository.mjs'
import { createAudioWorker } from '../../src/audio.mjs'
import { siteEtag } from '../../src/routes.mjs'
import { validateWebhookEvents, WEBHOOK_EVENT_TYPES } from '../../src/webhook-events.mjs'

// The verbs a console needs before "view, create, edit and delete work
// everywhere" can be true: the ones that destroy something, plus the reads and
// the concurrency guard they depend on. Destructive paths are tested for what
// they refuse, not only for what they remove.

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const SITE = { id: 'site-1', slug: 'my-site', name: 'My site', settings: {}, active_release_id: 'release-live' }

const auth = {
  async authenticate(headers) {
    return headers.get?.('x-api-key') === 'valid' || headers['x-api-key'] === 'valid'
      ? { id: 'key', scopes: ['*'], site_ids: [] }
      : null
  },
  authorize(principal) {
    return Boolean(principal)
  },
}

async function withApp({ db = {}, repo = {}, releases = {}, audio, storage = {}, logger }, run) {
  const app = createApp(
    { publicUrl: 'https://contentkit-api.example', version: 'test', root, trustProxy: false, maxBodyBytes: 1 << 20 },
    {
      logger: logger || { info() {}, warn() {}, error() {}, debug() {} },
      database: { db, async close() {} },
      storage,
      repo,
      releases: {
        inflight() {
          return 0
        },
        ...releases,
      },
      auth,
      outbox: { start() {}, stop() {} },
      ...(audio ? { audio } : {}),
    },
  )
  await new Promise((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const { port } = app.server.address()
    await run((path, init = {}) =>
      fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { 'x-api-key': 'valid', ...(init.headers || {}) } }),
    )
  } finally {
    app.limiter.stop()
    app.loginLimiter.stop()
    app.deckJobs.stop()
    await new Promise((resolve) => app.server.close(resolve))
  }
}

describe('DELETE /v1/sites/{site}', () => {
  test('refuses a non-empty site and names what would be destroyed', async () => {
    let deleted = false
    await withApp(
      {
        repo: {
          async getSite() {
            return SITE
          },
          async siteInventory() {
            return { content_items: 12, releases: 4, readers: 2 }
          },
          async deleteSite() {
            deleted = true
          },
        },
      },
      async (request) => {
        const response = await request('/v1/sites/my-site', { method: 'DELETE' })
        assert.equal(response.status, 409)
        const body = await response.json()
        assert.match(body.error, /12 content item\(s\), 4 release\(s\) and 2 reader\(s\)/)
        assert.match(body.error, /purge=true/)
        // The counts are machine-readable too: a console has to render them
        // without parsing the sentence.
        assert.equal(body.content_items, 12)
        assert.equal(body.releases, 4)
        assert.equal(body.readers, 2)
        assert.equal(deleted, false, 'a refusal must not delete anything')
      },
    )
  })

  test('purge=true cascades and records an audit event that outlives the site', async () => {
    const audits = []
    const inserted = []
    await withApp(
      {
        db: {
          async insert(table, row) {
            inserted.push({ table, row })
            if (table === 'ck_audit_events') audits.push(row)
            return [row]
          },
        },
        repo: {
          async getSite() {
            return SITE
          },
          async siteInventory() {
            return { content_items: 3, releases: 1, readers: 0 }
          },
          async deleteSite(siteId) {
            return {
              site_id: siteId,
              deleted: true,
              content_items: 3,
              releases: 1,
              readers: 0,
              assets: 5,
              removed_objects: 42,
            }
          },
        },
      },
      async (request) => {
        const response = await request('/v1/sites/my-site?purge=true', { method: 'DELETE' })
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), {
          site_id: 'site-1',
          deleted: true,
          content_items: 3,
          releases: 1,
          readers: 0,
          assets: 5,
          removed_objects: 42,
        })
        assert.equal(audits.length, 1)
        assert.equal(audits[0].action, 'site.delete')
        assert.equal(audits[0].resource_id, 'site-1')
        // site_id would reference a row that no longer exists.
        assert.equal(audits[0].site_id, null)
        // Renamed on purpose: the audit sanitizer drops keys that look like content.
        assert.equal(audits[0].metadata.items, 3)
        assert.equal(audits[0].metadata.slug, 'my-site')
        assert.equal(
          inserted.every((entry) => entry.table === 'ck_audit_events'),
          true,
        )
      },
    )
  })

  test('an empty site needs no purge flag', async () => {
    await withApp(
      {
        db: {
          async insert() {
            return []
          },
        },
        repo: {
          async getSite() {
            return SITE
          },
          async siteInventory() {
            return { content_items: 0, releases: 0, readers: 0 }
          },
          async deleteSite(siteId) {
            return { site_id: siteId, deleted: true, content_items: 0, releases: 0, readers: 0, removed_objects: 0 }
          },
        },
      },
      async (request) => {
        const response = await request('/v1/sites/my-site', { method: 'DELETE' })
        assert.equal(response.status, 200)
        assert.equal((await response.json()).deleted, true)
      },
    )
  })
})

describe('site ETag', () => {
  test('GET answers a strong validator and honours If-None-Match', async () => {
    await withApp(
      {
        repo: {
          async getSite() {
            return SITE
          },
        },
      },
      async (request) => {
        const first = await request('/v1/sites/my-site')
        assert.equal(first.status, 200)
        const etag = first.headers.get('etag')
        assert.equal(etag, siteEtag(SITE))
        const second = await request('/v1/sites/my-site', { headers: { 'if-none-match': etag } })
        assert.equal(second.status, 304)
      },
    )
  })

  test('PATCH with a stale If-Match is a 412 and writes nothing', async () => {
    let updates = 0
    await withApp(
      {
        repo: {
          async getSite() {
            return SITE
          },
          async updateSite(_siteId, patch) {
            updates++
            return { ...SITE, ...patch }
          },
        },
      },
      async (request) => {
        const stale = await request('/v1/sites/my-site', {
          method: 'PATCH',
          headers: { 'if-match': '"someone-elses-version"', 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed' }),
        })
        assert.equal(stale.status, 412)
        assert.match((await stale.json()).error, /changed since it was read/)
        assert.equal(updates, 0)

        const fresh = await request('/v1/sites/my-site', {
          method: 'PATCH',
          headers: { 'if-match': siteEtag(SITE), 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed' }),
        })
        assert.equal(fresh.status, 200)
        assert.equal(updates, 1)
        // The new tag describes the row that was just written, not the one read.
        assert.equal(fresh.headers.get('etag'), siteEtag({ ...SITE, name: 'Renamed' }))
      },
    )
  })

  test('a PATCH without If-Match stays unconditional', async () => {
    await withApp(
      {
        repo: {
          async getSite() {
            return SITE
          },
          async updateSite(_siteId, patch) {
            return { ...SITE, ...patch }
          },
        },
      },
      async (request) => {
        const response = await request('/v1/sites/my-site', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Renamed' }),
        })
        assert.equal(response.status, 200)
      },
    )
  })
})

describe('GET /v1/content/{item}', () => {
  test('answers the merged item the list would show', async () => {
    await withApp(
      {
        db: {
          async select(table) {
            return table === 'ck_content_items' ? [{ id: 'item-1', site_id: 'site-1' }] : []
          },
        },
        repo: {
          async getContentItem(itemId) {
            return { id: itemId, site_id: 'site-1', title: 'A post', slug: 'a-post', latest_revision_status: 'draft' }
          },
        },
      },
      async (request) => {
        const response = await request('/v1/content/item-1')
        assert.equal(response.status, 200)
        assert.equal((await response.json()).title, 'A post')
      },
    )
  })

  test('an unknown item is a 404, not an empty body', async () => {
    await withApp(
      {
        db: {
          async select() {
            return []
          },
        },
      },
      async (request) => {
        const response = await request('/v1/content/missing')
        assert.equal(response.status, 404)
        assert.match((await response.json()).error, /content item not found/)
      },
    )
  })
})

describe('DELETE /v1/content/{item}', () => {
  // Discarding a draft is the console's only destructive content verb, and it
  // had no route-level test at all — which is how it came to write an audit row
  // the database rejects (`transport: 'rest'`) and to name the *site* as the
  // actor. Both failures are silent: the delete succeeds, the trail does not.
  const draftApp = (item, sink) => ({
    db: {
      async select(table) {
        return table === 'ck_content_items' ? [item] : []
      },
      async remove(table, filter) {
        sink.removed.push({ table, filter })
      },
      async insert(table, row) {
        if (table === 'ck_audit_events') sink.audits.push(row)
        return [row]
      },
    },
  })

  test('discards the draft and records who did it, against the site, over http', async () => {
    const sink = { removed: [], audits: [] }
    await withApp(draftApp({ id: 'item-1', site_id: 'site-1', published_revision_id: null }, sink), async (request) => {
      const response = await request('/v1/content/item-1', { method: 'DELETE' })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { item_id: 'item-1', deleted: true })
      assert.equal(sink.removed.length, 1)
      assert.equal(sink.removed[0].table, 'ck_content_items')

      assert.equal(sink.audits.length, 1, 'a destructive verb must leave exactly one trail')
      const [row] = sink.audits
      assert.equal(row.action, 'content.delete_draft')
      assert.equal(row.resource_id, 'item-1')
      // The three columns the check constraints close over. `transport: 'rest'`
      // is not in the enum, so the insert used to fail and be swallowed.
      assert.ok(AUDIT_TRANSPORTS.includes(row.transport), `transport ${row.transport} is not an accepted value`)
      assert.ok(AUDIT_ACTOR_TYPES.includes(row.actor_type), `actor_type ${row.actor_type} is not an accepted value`)
      assert.ok(AUDIT_RESULTS.includes(row.result), `result ${row.result} is not an accepted value`)
      // Answerable questions: who deleted it, and which site was it in.
      assert.equal(row.actor_id, 'key', 'the actor is the principal, never the site')
      assert.equal(row.site_id, 'site-1', 'the row is indexed by site; without it the delete is unfindable')
    })
  })

  test('a published item is refused, and nothing is removed', async () => {
    const sink = { removed: [], audits: [] }
    await withApp(
      draftApp({ id: 'item-1', site_id: 'site-1', published_revision_id: 'rev-live' }, sink),
      async (request) => {
        const response = await request('/v1/content/item-1', { method: 'DELETE' })
        assert.equal(response.status, 409)
        assert.match((await response.json()).error, /unpublish it first/)
        assert.deepEqual(sink.removed, [], 'a refusal must not delete anything')
        assert.deepEqual(sink.audits, [], 'a refusal is not a deletion to record')
      },
    )
  })
})

describe('POST /v1/sites/{site}/render', () => {
  // The endpoint the assistant and every editor preview run on. It had no test:
  // not the 404, not the 422, not the conditional request, and not the fact
  // that `etag` is a header rather than a field of the body.
  const site = { ...SITE, default_locale: 'en' }

  test('renders a fragment, answers an ETag header and keeps it out of the body', async () => {
    await withApp(
      {
        repo: {
          async getSite() {
            return site
          },
        },
      },
      async (request) => {
        const response = await request('/v1/sites/my-site/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ markdown: 'Hello **world**.' }),
        })
        assert.equal(response.status, 200)
        const etag = response.headers.get('etag')
        assert.ok(etag, 'a conditional request needs a validator')
        const body = await response.json()
        assert.match(body.html, /<strong>world<\/strong>/)
        assert.equal(body.etag, undefined, 'the validator travels as a header, not as payload')

        const conditional = await request('/v1/sites/my-site/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'if-none-match': etag },
          body: JSON.stringify({ markdown: 'Hello **world**.' }),
        })
        assert.equal(conditional.status, 304)
      },
    )
  })

  test('two locales of one fragment get two validators', async () => {
    await withApp(
      {
        repo: {
          async getSite() {
            return site
          },
        },
      },
      async (request) => {
        const render = (locale) =>
          request('/v1/sites/my-site/render', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ markdown: '# Titel\n\nEin Absatz.\n', locale }),
          })
        const en = await render('en')
        const de = await render('de')
        assert.equal((await de.json()).semantic.locale, 'de')
        assert.notEqual(
          en.headers.get('etag'),
          de.headers.get('etag'),
          'two renders that differ must not share a validator, or the 304 serves the wrong one',
        )
      },
    )
  })

  test('an unknown site is a 404 and non-string markdown is a 422', async () => {
    await withApp(
      {
        repo: {
          async getSite(slug) {
            return slug === 'my-site' ? site : null
          },
        },
      },
      async (request) => {
        const missing = await request('/v1/sites/nope/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ markdown: '# x' }),
        })
        assert.equal(missing.status, 404)

        const invalid = await request('/v1/sites/my-site/render', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ markdown: { not: 'a string' } }),
        })
        assert.equal(invalid.status, 422)
        assert.match((await invalid.json()).error, /markdown must be a string/)
      },
    )
  })
})

describe('moderation deletes', () => {
  const commentDb = (comment) => ({
    async select(table) {
      return table === 'ck_comments' ? [comment] : []
    },
    async remove() {},
    async insert() {
      return []
    },
  })

  test('deleting an approved comment also takes it off the live site', async () => {
    const published = []
    await withApp(
      {
        db: commentDb({ id: 'c1', site_id: 'site-1', status: 'approved' }),
        releases: {
          async publish(input) {
            published.push(input)
            return { id: 'release-2' }
          },
        },
      },
      async (request) => {
        const response = await request('/v1/comments/c1', { method: 'DELETE' })
        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.deleted, true)
        assert.equal(body.release.id, 'release-2')
        assert.equal(published.length, 1)
        assert.equal(published[0].reason, 'comment deleted')
      },
    )
  })

  test('a pending comment was never rendered, so nothing is rebuilt', async () => {
    let publishes = 0
    await withApp(
      {
        db: commentDb({ id: 'c2', site_id: 'site-1', status: 'pending' }),
        releases: {
          async publish() {
            publishes++
            return {}
          },
        },
      },
      async (request) => {
        const response = await request('/v1/comments/c2', { method: 'DELETE' })
        assert.equal(response.status, 200)
        assert.equal((await response.json()).release, null)
        assert.equal(publishes, 0)
      },
    )
  })

  test('publish=false defers the rebuild to the next release', async () => {
    let publishes = 0
    await withApp(
      {
        db: commentDb({ id: 'c3', site_id: 'site-1', status: 'approved' }),
        releases: {
          async publish() {
            publishes++
            return {}
          },
        },
      },
      async (request) => {
        const response = await request('/v1/comments/c3?publish=false', { method: 'DELETE' })
        assert.equal(response.status, 200)
        assert.equal(publishes, 0)
      },
    )
  })

  test('a failed republish leaves the comment deleted and reports the error', async () => {
    await withApp(
      {
        db: commentDb({ id: 'c4', site_id: 'site-1', status: 'approved' }),
        releases: {
          async publish() {
            throw new Error('build failed')
          },
        },
      },
      async (request) => {
        const response = await request('/v1/comments/c4', { method: 'DELETE' })
        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.deleted, true)
        assert.match(body.republish_error, /build failed/)
      },
    )
  })

  test('a contact submission can go back to new, and can be erased', async () => {
    const removed = []
    const db = {
      async select(table) {
        return table === 'ck_contact_submissions' ? [{ id: 's1', site_id: 'site-1', status: 'closed' }] : []
      },
      async update(_table, _filter, patch) {
        return [{ id: 's1', ...patch }]
      },
      async remove(table, filter) {
        removed.push({ table, filter })
      },
    }
    await withApp({ db }, async (request) => {
      const reopened = await request('/v1/contact-submissions/s1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'new' }),
      })
      assert.equal(reopened.status, 200)
      assert.equal((await reopened.json()).status, 'new')

      const invalid = await request('/v1/contact-submissions/s1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      })
      assert.equal(invalid.status, 422)

      const deleted = await request('/v1/contact-submissions/s1', { method: 'DELETE' })
      assert.equal(deleted.status, 200)
      assert.deepEqual(await deleted.json(), { id: 's1', deleted: true })
      assert.equal(removed.length, 1)
      assert.equal(removed[0].table, 'ck_contact_submissions')
    })
  })

  test('resetting feedback deletes the votes of exactly one post', async () => {
    const removed = []
    const db = {
      async select(table, query) {
        if (table === 'ck_content_items') return query.id === 'eq.item-1' ? [{ id: 'item-1', site_id: 'site-1' }] : []
        if (table === 'ck_post_feedback') return [{ vote: 'up' }, { vote: 'down' }, { vote: 'up' }]
        return []
      },
      async remove(table, filter) {
        removed.push({ table, filter })
      },
    }
    await withApp({ db }, async (request) => {
      const response = await request('/v1/feedback/item-1', { method: 'DELETE' })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { content_item_id: 'item-1', deleted_votes: 3 })
      assert.deepEqual(removed, [{ table: 'ck_post_feedback', filter: { content_item_id: 'eq.item-1' } }])

      assert.equal((await request('/v1/feedback/unknown', { method: 'DELETE' })).status, 404)
    })
  })
})

describe('DELETE /v1/sites/{site}/releases/{release}', () => {
  const repoWith = (release, deletions) => ({
    async getSite() {
      return SITE
    },
    async getRelease() {
      return release
    },
    async deleteRelease(siteId, releaseId) {
      deletions.push(releaseId)
      return { release_id: releaseId, deleted: true, removed_objects: 7 }
    },
  })

  test('the release the live site is served from is a 409', async () => {
    const deletions = []
    await withApp(
      { repo: repoWith({ id: 'release-live', site_id: 'site-1', status: 'active' }, deletions) },
      async (request) => {
        const response = await request('/v1/sites/my-site/releases/release-live', { method: 'DELETE' })
        assert.equal(response.status, 409)
        assert.match((await response.json()).error, /activate another release first/)
        assert.deepEqual(deletions, [])
      },
    )
  })

  test('a superseded release goes, with its storage objects', async () => {
    const deletions = []
    await withApp(
      { repo: repoWith({ id: 'release-old', site_id: 'site-1', status: 'superseded' }, deletions) },
      async (request) => {
        const response = await request('/v1/sites/my-site/releases/release-old', { method: 'DELETE' })
        assert.equal(response.status, 200)
        assert.equal((await response.json()).removed_objects, 7)
        assert.deepEqual(deletions, ['release-old'])
      },
    )
  })

  test('a release of another site is not found here', async () => {
    const deletions = []
    await withApp(
      { repo: repoWith({ id: 'release-x', site_id: 'other-site', status: 'ready' }, deletions) },
      async (request) => {
        const response = await request('/v1/sites/my-site/releases/release-x', { method: 'DELETE' })
        assert.equal(response.status, 404)
        assert.deepEqual(deletions, [])
      },
    )
  })
})

describe('per-item audio', () => {
  const itemDb = (item, revision) => ({
    async select(table, query) {
      if (table === 'ck_content_items') return [item]
      if (table === 'ck_content_revisions') return query.id === `eq.${item.published_revision_id}` ? [revision] : []
      return []
    },
  })

  test('narrating one post is the backfill narrowed to its published slug', async () => {
    const calls = []
    await withApp(
      {
        db: itemDb(
          { id: 'item-1', site_id: 'site-1', kind: 'post', published_revision_id: 'rev-1' },
          { id: 'rev-1', slug: 'a-post' },
        ),
        repo: {
          async getSite() {
            return SITE
          },
        },
        audio: {
          async backfill(input) {
            calls.push(input)
            return { dry_run: false, jobs: [], total_chars: 0, estimated_usd: 0, skipped: 0, enqueued: 1 }
          },
        },
      },
      async (request) => {
        // No body at all: every option is optional, so an empty request is valid.
        const response = await request('/v1/content/item-1/audio', { method: 'POST' })
        assert.equal(response.status, 202)
        assert.equal((await response.json()).enqueued, 1)
        assert.deepEqual(calls[0].slugs, ['a-post'])
        assert.equal(calls[0].force, false)
        assert.equal(calls[0].dryRun, false)
      },
    )
  })

  test('an unpublished item and a non-post are both 409', async () => {
    await withApp(
      {
        db: itemDb({ id: 'item-2', site_id: 'site-1', kind: 'post', published_revision_id: null }, null),
        repo: {
          async getSite() {
            return SITE
          },
        },
        audio: {
          async backfill() {
            throw new Error('must not be reached')
          },
        },
      },
      async (request) => {
        const response = await request('/v1/content/item-2/audio', { method: 'POST' })
        assert.equal(response.status, 409)
        assert.match((await response.json()).error, /not published/)
      },
    )
    await withApp(
      {
        db: itemDb({ id: 'item-3', site_id: 'site-1', kind: 'page', published_revision_id: 'rev-3' }, null),
        repo: {
          async getSite() {
            return SITE
          },
        },
        audio: {
          async backfill() {
            throw new Error('must not be reached')
          },
        },
      },
      async (request) => {
        const response = await request('/v1/content/item-3/audio', { method: 'POST' })
        assert.equal(response.status, 409)
        assert.match((await response.json()).error, /only for posts/)
      },
    )
  })

  test('retrying an unknown job is a 404', async () => {
    await withApp(
      {
        repo: {
          async getSite() {
            return SITE
          },
        },
        audio: {
          async retryJob() {
            return null
          },
        },
      },
      async (request) => {
        const response = await request('/v1/sites/my-site/audio/jobs/job-1/retry', { method: 'POST' })
        assert.equal(response.status, 404)
      },
    )
  })
})

describe('audio.retryJob', () => {
  function workerFor(job) {
    const updates = []
    const db = {
      async select(table, query) {
        if (table !== 'ck_audio_jobs') return []
        return job && query.id === `eq.${job.id}` && query.site_id === `eq.${SITE.id}` ? [job] : []
      },
      async update(table, filter, patch) {
        updates.push({ table, filter, patch })
        return [{ ...job, ...patch }]
      },
    }
    const repo = {
      async one(table, query) {
        return (await db.select(table, query))[0] || null
      },
    }
    const worker = createAudioWorker({}, db, repo, {}, { info() {}, warn() {}, error() {} })
    return { worker, updates }
  }

  test('a failed job is re-queued with a cleared error and a zeroed attempt count', async () => {
    const { worker, updates } = workerFor({ id: 'job-1', item_id: 'item-1', status: 'failed', attempts: 5 })
    const result = await worker.retryJob({ site: SITE, jobId: 'job-1' })
    assert.equal(result.status, 'pending')
    assert.equal(result.previous_status, 'failed')
    assert.equal(updates[0].patch.attempts, 0)
    assert.equal(updates[0].patch.error, null)
    // The speech hash is untouched, so every other enqueue path stays idempotent.
    assert.equal('speech_sha256' in updates[0].patch, false)
  })

  test('a job the worker already holds is a 409, not a second claim', async () => {
    const { worker, updates } = workerFor({ id: 'job-2', item_id: 'item-1', status: 'processing', attempts: 1 })
    await assert.rejects(
      () => worker.retryJob({ site: SITE, jobId: 'job-2' }),
      (error) => error.statusCode === 409,
    )
    assert.deepEqual(updates, [])
  })

  test('a job of another site is not found', async () => {
    const { worker } = workerFor(null)
    assert.equal(await worker.retryJob({ site: SITE, jobId: 'job-3' }), null)
  })
})

describe('repository deletions', () => {
  function fixture({ items = [], releases = [], entries = [], assets = [], readers = [] } = {}) {
    const removedRows = []
    const removedObjects = []
    const db = {
      async select(table) {
        if (table === 'ck_content_items') return items
        if (table === 'ck_releases') return releases
        if (table === 'ck_release_entries') return entries
        if (table === 'ck_assets') return assets
        if (table === 'ck_access_users') return readers
        return []
      },
      async remove(table, filter) {
        removedRows.push({ table, filter })
      },
      // The dedup anti-join (unreferencedStoragePaths). The flat entries
      // fixture has a single release in play, so every entry belongs to it.
      async query() {
        return entries
      },
    }
    const storage = {
      async remove(paths) {
        removedObjects.push(...paths)
      },
    }
    return { repo: createRepository({}, db, storage), removedRows, removedObjects }
  }

  test('deleting a site clears its storage objects before the row that names them', async () => {
    const { repo, removedRows, removedObjects } = fixture({
      items: [{ id: 'item-1' }, { id: 'item-2' }],
      releases: [{ id: 'release-1' }],
      entries: [{ storage_path: 'sites/site-1/releases/1/index.html' }, { storage_path: null }],
      assets: [{ storage_path: 'sites/site-1/assets/a/cover.png' }],
      readers: [{ id: 'reader-1' }],
    })
    const result = await repo.deleteSite('site-1')
    assert.deepEqual(result, {
      site_id: 'site-1',
      deleted: true,
      content_items: 2,
      releases: 1,
      readers: 1,
      assets: 1,
      removed_objects: 2,
    })
    assert.deepEqual(removedObjects, ['sites/site-1/releases/1/index.html', 'sites/site-1/assets/a/cover.png'])
    // One row: everything else is reached by ON DELETE CASCADE.
    assert.deepEqual(removedRows, [{ table: 'ck_sites', filter: { id: 'eq.site-1' } }])
  })

  test('deleting a release removes its objects and only its own row', async () => {
    const { repo, removedRows, removedObjects } = fixture({
      entries: [{ storage_path: 'sites/site-1/releases/9/index.html' }],
    })
    const result = await repo.deleteRelease('site-1', 'release-9')
    assert.deepEqual(result, { release_id: 'release-9', deleted: true, removed_objects: 1 })
    assert.deepEqual(removedObjects, ['sites/site-1/releases/9/index.html'])
    assert.deepEqual(removedRows, [{ table: 'ck_releases', filter: { id: 'eq.release-9', site_id: 'eq.site-1' } }])
  })

  test('getContentItem merges the newest revision, and is null for an unknown id', async () => {
    const db = {
      async select(table, query) {
        if (table === 'ck_content_items') return query.id === 'eq.item-1' ? [{ id: 'item-1', site_id: 'site-1' }] : []
        if (table === 'ck_content_revisions')
          return [
            {
              id: 'revision-2',
              title: 'Newest',
              slug: 'newest',
              summary: null,
              tags: null,
              status: 'draft',
              created_at: 'now',
            },
          ]
        return []
      },
    }
    const repo = createRepository({}, db, {})
    const item = await repo.getContentItem('item-1')
    assert.equal(item.title, 'Newest')
    assert.equal(item.latest_revision_id, 'revision-2')
    assert.equal(item.latest_revision_status, 'draft')
    assert.equal(await repo.getContentItem('missing'), null)
  })
})

describe('webhook event filters', () => {
  test('every emitted type validates, in full, prefixed and suffix form', () => {
    assert.equal(WEBHOOK_EVENT_TYPES.length, 9)
    assert.deepEqual(validateWebhookEvents(WEBHOOK_EVENT_TYPES), [...WEBHOOK_EVENT_TYPES])
    assert.deepEqual(validateWebhookEvents(['comment.approved', 'release.published']), [
      'comment.approved',
      'release.published',
    ])
  })

  test('a typo is a 422 instead of an endpoint that never fires', () => {
    assert.throws(
      () => validateWebhookEvents(['contentkit.comment.aproved']),
      (error) => error.statusCode === 422 && /unknown webhook event/.test(error.message),
    )
    assert.throws(() => validateWebhookEvents('contentkit.comment.approved'), /must be an array/)
  })

  test('no filter at all still means every event', () => {
    assert.deepEqual(validateWebhookEvents(undefined), [])
    assert.deepEqual(validateWebhookEvents([]), [])
  })
})
