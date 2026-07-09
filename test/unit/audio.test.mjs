import test from 'node:test'
import assert from 'node:assert/strict'
import { createAudioWorker } from '../../src/audio.mjs'
import { createRepository } from '../../src/repository.mjs'
import { createTtsProvider } from '../../src/tts.mjs'
import { extractSpeechText } from '../../src/speech-text.mjs'

const config = { audioPollMs: 1000, audioMaxAttempts: 3 }
const logger = { info() {}, warn() {}, error() {} }

const markdown = (body = 'Gesprochener Text.') =>
  `---\nkind: post\ntitle: Testbeitrag\nlocale: de\nslug: testbeitrag\n---\n${body}`

// An in-memory db shaped like src/postgres.mjs, covering just the filters the
// audio worker uses. UNIQUE(item_id, speech_sha256) is emulated on insert.
function makeDb({ sites = [], items = [], revisions = [], jobs = [], assets = [] } = {}) {
  const tables = {
    ck_sites: sites,
    ck_content_items: items,
    ck_content_revisions: revisions,
    ck_audio_jobs: jobs,
    ck_assets: assets,
  }
  const matches = (row, query) =>
    Object.entries(query).every(([column, raw]) => {
      if (column === 'order' || column === 'limit') return true
      const expression = String(raw)
      if (expression === 'is.null') return row[column] == null
      if (expression === 'not.is.null') return row[column] != null
      if (expression.startsWith('eq.')) return String(row[column]) === expression.slice(3)
      if (expression.startsWith('lte.')) return String(row[column]) <= expression.slice(4)
      if (expression.startsWith('in.(')) return expression.slice(4, -1).split(',').includes(String(row[column]))
      throw new Error(`unsupported test filter: ${column}=${expression}`)
    })
  let sequence = 0
  return {
    tables,
    async select(table, query = {}) {
      let rows = tables[table].filter((row) => matches(row, query))
      const [column, direction] = String(query.order || '').split('.')
      if (column)
        rows = [...rows].sort((a, b) =>
          direction === 'desc'
            ? String(b[column]).localeCompare(String(a[column]))
            : String(a[column]).localeCompare(String(b[column])),
        )
      return query.limit ? rows.slice(0, Number(query.limit)) : rows
    },
    async insert(table, body, { returning = true } = {}) {
      const rows = Array.isArray(body) ? body : [body]
      const inserted = rows.map((row) => {
        if (table === 'ck_audio_jobs') {
          const duplicate = tables.ck_audio_jobs.find(
            (job) => job.item_id === row.item_id && job.speech_sha256 === row.speech_sha256,
          )
          if (duplicate)
            throw new Error('duplicate key value violates unique constraint "ck_audio_jobs_item_id_speech_sha256_key"')
        }
        const record = { id: `${table}-${++sequence}`, created_at: new Date(2026, 0, sequence).toISOString(), ...row }
        tables[table].push(record)
        return record
      })
      return returning ? inserted : null
    },
    async update(table, filters, body, { returning = true } = {}) {
      const rows = tables[table].filter((row) => matches(row, filters))
      for (const row of rows) Object.assign(row, body)
      return returning ? rows : null
    },
  }
}

function makeStorage() {
  const uploads = []
  return {
    uploads,
    async upload(path, body, contentType) {
      uploads.push({ path, body, contentType })
    },
  }
}

function fixture({ audioSettings = { enabled: true }, revisionMarkdown = markdown() } = {}) {
  const db = makeDb({
    sites: [{ id: 'site-1', slug: 'site-1', name: 'Site', settings: { audio: audioSettings } }],
    items: [{ id: 'item-1', site_id: 'site-1', kind: 'post', published_revision_id: 'rev-1' }],
    revisions: [
      {
        id: 'rev-1',
        item_id: 'item-1',
        markdown: revisionMarkdown,
        title: 'Testbeitrag',
        slug: 'testbeitrag',
        published_at: '2026-06-01T00:00:00Z',
      },
    ],
  })
  const storage = makeStorage()
  const repo = createRepository({}, db, storage)
  const worker = createAudioWorker(config, db, repo, storage, logger, () => createTtsProvider(config, 'fake'))
  return { db, storage, repo, worker }
}

test('enqueue creates a pending job for a published post revision', async () => {
  const { db, worker } = fixture()
  const result = await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  assert.equal(result.enqueued, 1)
  const [job] = db.tables.ck_audio_jobs
  assert.equal(job.status, 'pending')
  assert.equal(job.item_id, 'item-1')
  assert.equal(job.speech_sha256, extractSpeechText(markdown(), { title: 'Testbeitrag' }).sha256)
})

test('a second enqueue with the same speech text is a no-op (idempotent)', async () => {
  const { db, worker } = fixture()
  await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  const again = await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  assert.equal(again.enqueued, 0)
  assert.equal(db.tables.ck_audio_jobs.length, 1)
})

test('enqueue respects the site opt-in and the frontmatter audio: false override', async () => {
  const disabledSite = fixture({ audioSettings: { enabled: false } })
  assert.equal((await disabledSite.worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })).enqueued, 0)

  const optedOutPost = fixture({
    revisionMarkdown: `---\nkind: post\ntitle: Testbeitrag\nlocale: de\nslug: testbeitrag\naudio: false\n---\nText.`,
  })
  assert.equal((await optedOutPost.worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })).enqueued, 0)
  assert.equal(optedOutPost.db.tables.ck_audio_jobs.length, 0)
})

test('the worker synthesizes a pending job into an asset row and marks the job done', async () => {
  const { db, storage, worker } = fixture()
  await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  await worker.tick()
  const [job] = db.tables.ck_audio_jobs
  assert.equal(job.status, 'done')
  assert.ok(job.asset_id, 'job must reference the finished asset')
  assert.ok(job.duration_secs >= 1)
  assert.ok(job.chars > 0)
  const asset = db.tables.ck_assets.find((row) => row.id === job.asset_id)
  assert.equal(asset.content_type, 'audio/mpeg')
  assert.equal(asset.filename, 'testbeitrag-vorlesen.mp3')
  assert.match(asset.storage_path, /^sites\/site-1\/assets\/[0-9a-f]{64}\/testbeitrag-vorlesen\.mp3$/)
  assert.equal(storage.uploads.length, 1)
  assert.equal(storage.uploads[0].path, asset.storage_path)
  // The fake provider emits a real MPEG frame sync word.
  assert.equal(storage.uploads[0].body[0], 0xff)
})

test('a failing provider backs off and goes terminal after audioMaxAttempts', async () => {
  const db = makeDb({
    sites: [{ id: 'site-1', slug: 'site-1', name: 'Site', settings: { audio: { enabled: true } } }],
    items: [{ id: 'item-1', site_id: 'site-1', kind: 'post' }],
    revisions: [{ id: 'rev-1', item_id: 'item-1', markdown: markdown(), title: 'T', slug: 't' }],
    jobs: [
      {
        id: 'job-1',
        site_id: 'site-1',
        item_id: 'item-1',
        revision_id: 'rev-1',
        speech_sha256: 'x',
        status: 'pending',
        attempts: 0,
        next_attempt_at: '2000-01-01T00:00:00Z',
        created_at: '2000-01-01T00:00:00Z',
      },
    ],
  })
  const repo = createRepository({}, db, {})
  const worker = createAudioWorker(config, db, repo, makeStorage(), logger, () => ({
    async synthesize() {
      throw new Error('quota exceeded')
    },
  }))
  const job = db.tables.ck_audio_jobs[0]
  await worker.tick()
  assert.equal(job.status, 'pending')
  assert.equal(job.attempts, 1)
  assert.ok(job.next_attempt_at > new Date().toISOString(), 'backoff must schedule the retry in the future')
  job.next_attempt_at = '2000-01-01T00:00:00Z'
  await worker.tick()
  job.next_attempt_at = '2000-01-01T00:00:00Z'
  await worker.tick()
  assert.equal(job.attempts, 3)
  assert.equal(job.status, 'failed')
  assert.match(job.error, /quota exceeded/)
})

test('backfill dry_run lists candidates with a character total without enqueuing', async () => {
  const { db, repo, worker } = fixture()
  const site = await repo.getSite('site-1')
  const result = await worker.backfill({ site, dryRun: true })
  assert.equal(result.dry_run, true)
  assert.equal(result.jobs.length, 1)
  assert.equal(result.jobs[0].item_id, 'item-1')
  assert.ok(result.total_chars > 0)
  assert.ok(result.estimated_usd >= 0)
  assert.equal(db.tables.ck_audio_jobs.length, 0)
})

test('backfill enqueues newest-first within the character budget and skips existing jobs', async () => {
  const { db, repo, worker } = fixture()
  db.tables.ck_content_items.push({ id: 'item-2', site_id: 'site-1', kind: 'post', published_revision_id: 'rev-2' })
  db.tables.ck_content_revisions.push({
    id: 'rev-2',
    item_id: 'item-2',
    markdown: markdown('Ein anderer, deutlich längerer gesprochener Text für den zweiten Beitrag.'),
    title: 'Neuerer Beitrag',
    slug: 'neuerer-beitrag',
    published_at: '2026-07-01T00:00:00Z',
  })
  const site = await repo.getSite('site-1')
  const newestChars = extractSpeechText(db.tables.ck_content_revisions[1].markdown, { title: 'Neuerer Beitrag' }).chars
  // Budget covers exactly the newest post: the older one must wait for the next run.
  const budgeted = await worker.backfill({ site, limitChars: newestChars })
  assert.equal(budgeted.enqueued, 1)
  assert.equal(budgeted.jobs[0].item_id, 'item-2', 'newest post first')
  // Unlimited second run picks up the remainder and skips the existing job.
  const rest = await worker.backfill({ site })
  assert.equal(rest.enqueued, 1)
  assert.equal(rest.jobs[0].item_id, 'item-1')
  assert.equal(rest.skipped, 1)
  assert.equal(db.tables.ck_audio_jobs.length, 2)
})

test('backfill with slugs narrows the walk to the named posts', async () => {
  const { db, repo, worker } = fixture()
  db.tables.ck_content_items.push({ id: 'item-2', site_id: 'site-1', kind: 'post', published_revision_id: 'rev-2' })
  db.tables.ck_content_revisions.push({
    id: 'rev-2',
    item_id: 'item-2',
    markdown: markdown('Ein anderer gesprochener Text für den zweiten Beitrag.'),
    title: 'Neuerer Beitrag',
    slug: 'neuerer-beitrag',
    published_at: '2026-07-01T00:00:00Z',
  })
  const site = await repo.getSite('site-1')
  const result = await worker.backfill({ site, slugs: ['neuerer-beitrag'] })
  assert.equal(result.enqueued, 1)
  assert.equal(result.jobs.length, 1)
  assert.equal(result.jobs[0].item_id, 'item-2')
  assert.equal(db.tables.ck_audio_jobs.length, 1, 'only the named post is enqueued')
})

test('backfill force re-renders an unchanged post by resetting its job', async () => {
  const { db, repo, worker } = fixture()
  const site = await repo.getSite('site-1')
  const first = await worker.backfill({ site })
  assert.equal(first.enqueued, 1)
  db.tables.ck_audio_jobs[0].status = 'done'
  db.tables.ck_audio_jobs[0].attempts = 3
  // Without force the unchanged speech text is skipped ...
  const skipped = await worker.backfill({ site })
  assert.equal(skipped.enqueued, 0)
  // ... with force the existing job is reset to pending instead of duplicated.
  const forced = await worker.backfill({ site, force: true })
  assert.equal(forced.enqueued, 1)
  assert.equal(db.tables.ck_audio_jobs.length, 1, 'no duplicate row')
  assert.equal(db.tables.ck_audio_jobs[0].status, 'pending')
  assert.equal(db.tables.ck_audio_jobs[0].attempts, 0)
})

test('backfill refuses a site that has not opted in', async () => {
  const { repo, worker } = fixture({ audioSettings: { enabled: false } })
  const site = await repo.getSite('site-1')
  await assert.rejects(
    () => worker.backfill({ site }),
    (error) => {
      assert.equal(error.statusCode, 409)
      return true
    },
  )
})

test('status reports the newest job and resolves the /media URL once done', async () => {
  const { db, repo, worker } = fixture()
  await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  assert.equal((await worker.status('item-1')).status, 'pending')
  await worker.tick()
  const done = await worker.status('item-1')
  assert.equal(done.status, 'done')
  const asset = db.tables.ck_assets[0]
  assert.equal(done.audio.url, `/media/${asset.id}/testbeitrag-vorlesen.mp3`)
  assert.equal(done.audio.content_type, 'audio/mpeg')
  assert.ok(done.audio.byte_size > 0)
  assert.equal((await worker.status('item-unknown')).status, 'none')
  void repo
})
