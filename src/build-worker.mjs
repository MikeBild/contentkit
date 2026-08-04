// Worker entry point for the site build.
//
// Resolution note: this file is only ever reached through
// `new URL('./build-worker.mjs', import.meta.url)` in build-runner.mjs, which
// is how every other module in src/ resolves a sibling. The standalone binary
// unpacks src/ to a cache directory and runs server.mjs from there, so a
// cwd-relative or argv-relative path would resolve against wherever the
// operator happened to stand and would break only in the binary — the hardest
// place to notice.
//
// Message contract:
//   parent -> worker  { type: 'build',      id, input }
//                     { type: 'deck:reply', id, value }
//                     { type: 'deck:fail',  id, error }
//   worker -> parent  { type: 'ready' }
//                     { type: 'result',     id, value }
//                     { type: 'error',      id, error }
//                     { type: 'log',        level, message, meta }
//                     { type: 'deck:acquire' | 'deck:render' | 'deck:release', id }
//
// The build itself never touches Postgres or object storage: buildSite is pure
// — it returns bytes or it throws — and every write stays on the parent thread
// where the release transaction is. That is what keeps a release exactly as
// atomic across this split as it was in one thread.
import { parentPort, workerData } from 'node:worker_threads'
import { reviveBuildError, serializeBuildError } from './build-error.mjs'
import { buildSite } from './site-builder.mjs'

const port = parentPort
const pending = new Map()
let nextCallId = 0

function call(message) {
  const id = `c${++nextCallId}`
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    port.postMessage({ ...message, id })
  })
}

// Mirrors the deck renderer's `run(task)` shape. The permit is acquired and
// held on the parent thread — that is where the concurrency limit, the queue
// and the supervised Slidev child process live, and splitting them would let
// two builds exceed a limit only one side is counting.
const deckRendererProxy = {
  async run(task) {
    await call({ type: 'deck:acquire' })
    try {
      return await task(async (markdown, theme) => call({ type: 'deck:render', markdown, theme }))
    } finally {
      await call({ type: 'deck:release' }).catch(() => {})
    }
  },
}

const logger = {
  warn: (message, meta) => port.postMessage({ type: 'log', level: 'warn', message, meta }),
  info: (message, meta) => port.postMessage({ type: 'log', level: 'info', message, meta }),
  debug: (message, meta) => port.postMessage({ type: 'log', level: 'debug', message, meta }),
  error: (message, meta) => port.postMessage({ type: 'log', level: 'error', message, meta }),
}

async function run(id, input) {
  const { hasDeckRenderer, ...rest } = input
  try {
    const built = await buildSite({
      ...rest,
      root: rest.root ?? workerData?.root,
      logger,
      deckRenderer: hasDeckRenderer ? deckRendererProxy : undefined,
    })
    port.postMessage({ type: 'result', id, value: built })
  } catch (error) {
    port.postMessage({ type: 'error', id, error: serializeBuildError(error) })
  }
}

port?.on('message', (message) => {
  if (message?.type === 'build') {
    run(message.id, message.input)
    return
  }
  const waiter = pending.get(message?.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.type === 'deck:reply') waiter.resolve(message.value)
  else waiter.reject(reviveBuildError(message.error))
})

// Announced only after the module graph above is loaded, so the parent's first
// build does not also pay for compiling Shiki, KaTeX, ECharts and resvg.
port?.postMessage({ type: 'ready' })
