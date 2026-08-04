// Release-build load harness.
//
// Question it answers: while a large site is being published, does an unrelated
// request still get a response, and how late? A separate process fires
// GET /health at a fixed cadence against a server running in THIS process; this
// process then publishes a site through the real release manager. Whatever the
// build does to the event loop shows up as the probe's worst response time.
//
// It drives `createReleaseManager`, not `buildSite`, on purpose: the thing that
// has to stay off the request thread is the *release*, and a harness pointed at
// the builder alone would keep passing if the wiring in releases.mjs were undone.
// Postgres and object storage are stubbed in memory — this measures the event
// loop, and a real network would only add waiting that is not the subject.
//
//   node scripts/loadtest-release-build.mjs                  # shipped path
//   CONTENTKIT_LOADTEST_MODE=inline node scripts/...         # in-process build
//   CONTENTKIT_LOADTEST_DOCUMENTS=800 node scripts/...
//   CONTENTKIT_LOADTEST_WORST_MS=250 node scripts/...        # assert a ceiling
//
// Exit code 1 when a threshold is given and the worst response exceeds it.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReleaseManager } from '../src/releases.mjs'
import { loadTestCorpus, loadTestLocales, loadTestSite } from './loadtest-corpus.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const documents = Number(process.env.CONTENTKIT_LOADTEST_DOCUMENTS || 400)
const mode = process.env.CONTENTKIT_LOADTEST_MODE || 'worker'
const intervalMs = Number(process.env.CONTENTKIT_LOADTEST_INTERVAL_MS || 200)
const worstMax = process.env.CONTENTKIT_LOADTEST_WORST_MS ? Number(process.env.CONTENTKIT_LOADTEST_WORST_MS) : null

// The real /health handler (routes.mjs) is a synchronous 200 with no I/O, so a
// bare server reproduces its cost exactly: any latency the probe records is the
// event loop, not the handler.
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404)
  res.end()
})
server.keepAliveTimeout = 0
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

function snapshotFor(revisions) {
  return {
    site: { ...loadTestSite, publish_epoch: 1 },
    locales: loadTestLocales,
    revisions,
    comments: [],
    audio: [],
    accessRules: [],
    accessGroups: [],
    items: revisions.map((revision) => ({
      id: revision.item_id,
      kind: revision.kind,
      locale: revision.locale,
      translation_key: revision.translation_key,
      published_revision_id: null,
    })),
    overlay: [],
  }
}

let uploadedBytes = 0
let fileCount = 0
const storage = {
  async upload(_path, body) {
    uploadedBytes += body.length
    fileCount++
  },
  async remove() {},
}
const db = {
  async insert() {},
  async update() {},
  async remove() {},
  async select() {
    return []
  },
  async tx(fn) {
    return fn({ async rpc() {}, async insert() {} })
  },
}

const revisions = loadTestCorpus(documents)
let snapshot = snapshotFor(revisions.slice(0, 1))
const repo = {
  async buildSnapshot() {
    return snapshot
  },
  async enqueueContentEvents() {},
  async createOutbox() {},
  async getSite() {
    return snapshot.site
  },
}

const logger = { warn() {}, error() {}, info() {}, debug() {} }
const releases = createReleaseManager(
  {
    root,
    buildConcurrency: 1,
    publicUrl: base,
    previewSecret: 'loadtest',
    // The one switch: undefined (default) publishes off-thread, false keeps the
    // build in this process. Nothing else about the path differs.
    ...(mode === 'inline' ? { buildWorker: false } : {}),
  },
  repo,
  db,
  storage,
  logger,
)

// Warm the renderer, the static asset reads and — off-thread — the build
// worker. Without this the first document pays for every lazy import and the
// number measures module loading.
await releases.publish({ siteId: loadTestSite.id, revisionIds: [], reason: 'warmup' })

const probe = spawn(process.execPath, [join(here, 'loadtest-probe.mjs'), base, String(intervalMs)], {
  stdio: ['pipe', 'pipe', 'inherit'],
})
let probeOut = ''
probe.stdout.on('data', (chunk) => (probeOut += chunk))
const probeDone = new Promise((resolve) => probe.once('close', resolve))
// Let the probe establish a baseline before the publish starts.
await new Promise((resolve) => setTimeout(resolve, 1000))

snapshot = snapshotFor(revisions)
uploadedBytes = 0
fileCount = 0
const started = performance.now()
await releases.publish({ siteId: loadTestSite.id, revisionIds: [], reason: 'loadtest' })
const buildMs = performance.now() - started

await new Promise((resolve) => setTimeout(resolve, 500))
probe.stdin.end()
await probeDone
server.close()
await releases.stop()

const probeReport = JSON.parse(probeOut || '{}')
const report = {
  mode,
  documents,
  probe_interval_ms: intervalMs,
  build_ms: Number(buildMs.toFixed(2)),
  documents_per_second: Number((documents / (buildMs / 1000)).toFixed(2)),
  generated_files: fileCount,
  uploaded_mb: Number((uploadedBytes / 1024 / 1024).toFixed(2)),
  rss_mb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)),
  ...probeReport,
  worst_ms_max: worstMax,
}
report.within_threshold = worstMax === null ? null : report.worst_ms !== null && report.worst_ms <= worstMax

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (report.within_threshold === false) process.exitCode = 1
