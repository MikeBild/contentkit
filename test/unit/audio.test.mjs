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
    async remove(table, filters) {
      const survivors = tables[table].filter((row) => !matches(row, filters))
      tables[table].length = 0
      tables[table].push(...survivors)
    },
  }
}

function makeStorage() {
  const uploads = []
  const removed = []
  return {
    uploads,
    removed,
    async upload(path, body, contentType) {
      uploads.push({ path, body, contentType })
    },
    async remove(paths) {
      removed.push(...paths)
    },
  }
}

function fixture({
  audioSettings = { enabled: true },
  revisionMarkdown = markdown(),
  workerConfig = config,
  ttsFactory = () => createTtsProvider(config, 'fake'),
} = {}) {
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
  const worker = createAudioWorker(workerConfig, db, repo, storage, logger, ttsFactory)
  return { db, storage, repo, worker }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

test('a finished job schedules one debounced auto-rebuild with empty revision_ids', async () => {
  const { worker } = fixture({ workerConfig: { ...config, audioRebuildDebounceMs: 10 } })
  const published = []
  worker.setPublisher(async (input) => published.push(input))
  await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  await worker.tick()
  assert.equal(published.length, 0, 'the rebuild must be debounced, not immediate')
  await sleep(50)
  assert.equal(published.length, 1)
  assert.deepEqual(published[0], { siteId: 'site-1', revisionIds: [], reason: 'audio auto-rebuild' })
  worker.stop()
})

test('a burst of completed jobs collapses into a single rebuild per site', async () => {
  const { db, worker } = fixture({ workerConfig: { ...config, audioRebuildDebounceMs: 10 } })
  db.tables.ck_content_items.push({ id: 'item-2', site_id: 'site-1', kind: 'post', published_revision_id: 'rev-2' })
  db.tables.ck_content_revisions.push({
    id: 'rev-2',
    item_id: 'item-2',
    markdown: markdown('Ein anderer gesprochener Text für den zweiten Beitrag.'),
    title: 'Neuerer Beitrag',
    slug: 'neuerer-beitrag',
    published_at: '2026-07-01T00:00:00Z',
  })
  const published = []
  worker.setPublisher(async (input) => published.push(input))
  await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1', 'rev-2'] })
  await worker.tick()
  assert.equal(db.tables.ck_audio_jobs.filter((job) => job.status === 'done').length, 2)
  await sleep(50)
  assert.equal(published.length, 1, 'two completions within the debounce window are one rebuild')
  worker.stop()
})

test('auto_rebuild: false gates the rebuild, and stop() cancels a pending timer', async () => {
  const optedOut = fixture({
    audioSettings: { enabled: true, auto_rebuild: false },
    workerConfig: { ...config, audioRebuildDebounceMs: 10 },
  })
  const published = []
  optedOut.worker.setPublisher(async (input) => published.push(input))
  await optedOut.worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  await optedOut.worker.tick()
  await sleep(50)
  assert.equal(published.length, 0, 'settings.audio.auto_rebuild=false must suppress the rebuild')
  optedOut.worker.stop()

  const stopped = fixture({ workerConfig: { ...config, audioRebuildDebounceMs: 10 } })
  stopped.worker.setPublisher(async (input) => published.push(input))
  await stopped.worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  await stopped.worker.tick()
  stopped.worker.stop()
  await sleep(50)
  assert.equal(published.length, 0, 'stop() must clear pending rebuild timers')
})

test('enqueue refuses a job that would exceed the monthly character budget', async () => {
  const chars = extractSpeechText(markdown(), { title: 'Testbeitrag' }).chars
  const warns = []
  const { db, repo } = fixture({ audioSettings: { enabled: true, monthly_char_budget: chars + 10 } })
  const consumed = {
    id: 'job-old',
    site_id: 'site-1',
    item_id: 'item-0',
    revision_id: 'rev-0',
    speech_sha256: 'other',
    status: 'done',
    chars: 11,
    created_at: new Date().toISOString(),
  }
  db.tables.ck_audio_jobs.push(consumed)
  const worker = createAudioWorker(
    config,
    db,
    repo,
    makeStorage(),
    { info() {}, error() {}, warn: (message, data) => warns.push({ message, data }) },
    () => createTtsProvider(config, 'fake'),
  )
  // 11 chars already consumed this month; the post's chars would overrun.
  assert.equal((await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })).enqueued, 0)
  assert.equal(db.tables.ck_audio_jobs.length, 1, 'no job past the budget')
  assert.equal(warns[0].message, 'audio budget exhausted')
  assert.deepEqual(warns[0].data, { siteId: 'site-1', itemId: 'item-1', chars })

  // Skipped jobs never billed, jobs from earlier months already paid: neither counts.
  consumed.status = 'skipped'
  assert.equal((await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })).enqueued, 1)
})

test('enqueue ignores jobs from earlier months when checking the budget', async () => {
  const chars = extractSpeechText(markdown(), { title: 'Testbeitrag' }).chars
  const { db, worker } = fixture({ audioSettings: { enabled: true, monthly_char_budget: chars + 10 } })
  db.tables.ck_audio_jobs.push({
    id: 'job-old',
    site_id: 'site-1',
    item_id: 'item-0',
    revision_id: 'rev-0',
    speech_sha256: 'other',
    status: 'done',
    chars: 999999,
    created_at: '2000-01-01T00:00:00Z',
  })
  assert.equal((await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })).enqueued, 1)
})

test('remove deletes the jobs, the assets and their storage objects, and schedules a rebuild', async () => {
  const { db, storage, repo, worker } = fixture({ workerConfig: { ...config, audioRebuildDebounceMs: 10 } })
  const published = []
  worker.setPublisher(async (input) => published.push(input))
  await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  await worker.tick()
  const assetPath = db.tables.ck_assets[0].storage_path
  const site = await repo.getSite('site-1')
  const result = await worker.remove({ site, item: db.tables.ck_content_items[0] })
  assert.deepEqual(result, { item_id: 'item-1', deleted_jobs: 1, deleted_assets: 1, rebuild_scheduled: true })
  assert.equal(db.tables.ck_audio_jobs.length, 0)
  assert.equal(db.tables.ck_assets.length, 0)
  assert.deepEqual(storage.removed, [assetPath])
  await sleep(50)
  // One rebuild from the synthesis, debounced into the one from the delete.
  assert.equal(published.length, 1)
  worker.stop()

  const untouched = await worker.remove({ site, item: { id: 'item-unknown' } })
  assert.deepEqual(untouched, { item_id: 'item-unknown', deleted_jobs: 0, deleted_assets: 0, rebuild_scheduled: false })
})

test('a force re-render deletes the superseded asset at the swap point', async () => {
  let call = 0
  const { db, storage, repo, worker } = fixture({
    ttsFactory: () => ({
      async synthesize() {
        call++
        return { audio: Buffer.from([0xff, call]), contentType: 'audio/mpeg', durationSecs: 60 }
      },
    }),
  })
  await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  await worker.tick()
  const oldAsset = db.tables.ck_assets[0]
  const site = await repo.getSite('site-1')
  await worker.backfill({ site, force: true })
  db.tables.ck_audio_jobs[0].next_attempt_at = '2000-01-01T00:00:00Z'
  await worker.tick()
  const [job] = db.tables.ck_audio_jobs
  assert.equal(job.status, 'done')
  assert.notEqual(job.asset_id, oldAsset.id, 'the job must reference the new asset')
  assert.equal(db.tables.ck_assets.length, 1, 'the superseded asset row is gone')
  assert.notEqual(db.tables.ck_assets[0].id, oldAsset.id)
  assert.deepEqual(storage.removed, [oldAsset.storage_path])
  worker.stop()
})

test('listJobs resolves slugs, filters by status and reports the monthly budget summary', async () => {
  const { db, repo, worker } = fixture({ audioSettings: { enabled: true, monthly_char_budget: 100000 } })
  await worker.enqueueAudioJobs({ siteId: 'site-1', revisionIds: ['rev-1'] })
  const pending = db.tables.ck_audio_jobs[0]
  pending.created_at = new Date().toISOString()
  db.tables.ck_audio_jobs.push({
    id: 'job-failed',
    site_id: 'site-1',
    item_id: 'item-9',
    revision_id: 'rev-gone',
    speech_sha256: 'x',
    status: 'failed',
    attempts: 5,
    chars: 42,
    error: 'quota exceeded',
    created_at: '2000-01-01T00:00:00Z',
  })
  const site = await repo.getSite('site-1')
  const all = await worker.listJobs({ site })
  assert.equal(all.jobs.length, 2)
  assert.equal(all.jobs[0].slug, 'testbeitrag', 'newest first, slug joined via the revision')
  assert.equal(all.jobs[0].title, 'Testbeitrag')
  assert.equal(all.jobs[1].slug, null, 'a job whose revision is gone still lists')
  assert.deepEqual(
    { ...all.summary },
    {
      pending: 1,
      processing: 0,
      done: 0,
      failed: 1,
      skipped: 0,
      chars_this_month: pending.chars,
      monthly_char_budget: 100000,
      budget_remaining: 100000 - pending.chars,
    },
  )

  const failed = await worker.listJobs({ site, status: 'failed', limit: 1 })
  assert.equal(failed.jobs.length, 1)
  assert.equal(failed.jobs[0].error, 'quota exceeded')

  await assert.rejects(
    () => worker.listJobs({ site, status: 'nope' }),
    (error) => {
      assert.equal(error.statusCode, 422)
      return true
    },
  )
})
