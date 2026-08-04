// Worker thread vs forked child, measured rather than preferred.
//
// The functional work is identical either way — the same buildSite, the same
// deck bridge, the same pure-build/parent-writes split. Only two things differ
// measurably, and both are about moving the result: a release build's output is
// tens of megabytes of Buffers, and the parent needs all of it to upload and
// hash. So this measures (a) time from spawn to the child/worker being ready to
// build, and (b) round-trip time for a real build result.
//
//   node scripts/compare-build-transport.mjs [documents]
//
// Recorded run (Darwin arm64, Node 22, 400 documents, ~26 MB result) is in the
// task report; re-run it rather than trusting the number if the corpus changes.
import { fork } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite } from '../src/site-builder.mjs'
import { loadTestCorpus, loadTestLocales, loadTestSite } from './loadtest-corpus.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const documents = Number(process.argv[2] || 400)

const built = await buildSite({
  root,
  site: loadTestSite,
  locales: loadTestLocales,
  revisions: loadTestCorpus(documents),
})
const payloadBytes = [...built.files.values()].reduce((sum, file) => sum + file.body.length, 0)

// Startup is "spawned process/thread has buildSite's module graph loaded and is
// answering" — the graph is the expensive part (Shiki, KaTeX, ECharts, resvg),
// and it is the same graph in both, so the difference is the runtime's own
// process/thread cost plus a second V8 isolate's module compilation.
const echoWorker = join(here, 'transport-echo-worker.mjs')
const echoChild = join(here, 'transport-echo-child.mjs')

async function measureWorker() {
  const spawnStart = performance.now()
  const worker = new Worker(echoWorker)
  const ready = await new Promise((resolve) => {
    worker.once('message', (message) => resolve(message))
  })
  const startupMs = performance.now() - spawnStart
  const roundStart = performance.now()
  worker.postMessage(built)
  await new Promise((resolve) => worker.once('message', resolve))
  const roundTripMs = performance.now() - roundStart
  await worker.terminate()
  return { ready, startup_ms: Number(startupMs.toFixed(1)), round_trip_ms: Number(roundTripMs.toFixed(1)) }
}

async function measureChild() {
  const spawnStart = performance.now()
  // `advanced` serialisation is the fair comparison: it is structured clone,
  // the same algorithm the worker uses, so the delta is the pipe, not the codec.
  const child = fork(echoChild, { serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  const ready = await new Promise((resolve) => child.once('message', resolve))
  const startupMs = performance.now() - spawnStart
  const roundStart = performance.now()
  child.send(built)
  await new Promise((resolve) => child.once('message', resolve))
  const roundTripMs = performance.now() - roundStart
  child.kill()
  return { ready, startup_ms: Number(startupMs.toFixed(1)), round_trip_ms: Number(roundTripMs.toFixed(1)) }
}

const worker = await measureWorker()
const child = await measureChild()

process.stdout.write(
  `${JSON.stringify(
    {
      documents,
      files: built.files.size,
      payload_bytes: payloadBytes,
      payload_mb: Number((payloadBytes / 1024 / 1024).toFixed(2)),
      worker_threads: worker,
      child_process: child,
      startup_ratio: Number((child.startup_ms / worker.startup_ms).toFixed(2)),
      transfer_ratio: Number((child.round_trip_ms / worker.round_trip_ms).toFixed(2)),
    },
    null,
    2,
  )}\n`,
)
