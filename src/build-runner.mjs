// Runs `buildSite` off the request thread.
//
// WHY. Measured with scripts/loadtest-release-build.mjs, publishing through the
// real release manager (Darwin arm64, Node 22). Worst GET /health during one
// publish:
//
//   documents   in-process build   in a worker   publish duration
//         400          4227.0 ms       4.03 ms   4265 -> 4243 ms
//        1000         10197.2 ms       4.69 ms  10233 -> 10283 ms
//
// `renderMarkdown` is awaited per item, but those awaits resolve as microtasks —
// the loop never reaches its poll phase, so an unrelated request waits for
// essentially the whole build. In production that was a 103.7 s build with
// responses over twenty seconds late and a DELETE that landed 37 s after its
// client gave up. Moving the build costs 0.5% of publish duration at 1000
// documents and takes the worst unrelated response from ten seconds to five
// milliseconds.
//
// WHY A WORKER AND NOT A FORKED CHILD. Both isolate the loop equally; the
// choice was made on the two things that differ measurably
// (scripts/compare-build-transport.mjs, 400 documents, 24.77 MB of output):
//
//   transport        spawn->ready    result round trip
//   worker_threads       485 ms            16.9 ms
//   child_process        322 ms            29.4 ms
//
// Startup favours the child slightly and transfer favours the worker by 1.74x,
// but both are noise beside a multi-second build. The decision came from what
// the numbers did not show: the parent needs every byte of the result to hash
// and upload, a child would have to push all of it through a pipe as the site
// grows, and the deck path already owns the one child process ContentKit
// supervises. A worker keeps the build's dependency graph (Shiki, KaTeX,
// ECharts, resvg-wasm) in one process and adds no second supervision story.
//
// WHY WORKERS ARE REUSED. A worker per build costs ~2.6 s of module compilation
// every time: a 20-document build measured 244 ms inline and 2801 ms in a fresh
// worker. That tax lands hardest on preview builds, which are interactive. So a
// worker is kept warm between builds and terminated after `idleMs` of quiet —
// the module state it holds is the same Shiki/KaTeX/ECharts state the inline
// path already kept in the API process forever, so reuse is no less isolated
// than what it replaces, and the idle timeout gives the memory back.
//
// WHAT DOES NOT MOVE. Every Postgres and object-storage write stays on the
// parent thread in releases.mjs. `buildSite` is pure, so the release
// transaction is exactly as atomic as it was before.
import { Worker } from 'node:worker_threads'
import { reviveBuildError } from './build-error.mjs'

// Sibling resolution, never cwd: the standalone binary unpacks src/ to a cache
// directory and runs server.mjs from there. A cwd-relative path resolves
// correctly in a checkout and fails only in the binary.
export const BUILD_WORKER_ENTRY = new URL('./build-worker.mjs', import.meta.url)

// Structured clone hands back Uint8Array where the build produced Buffer.
// Everything downstream (storage.upload, sha256, byte_size) is written against
// Buffer, so restore the view — same bytes, no copy.
function restoreFiles(files) {
  if (!files) return files
  for (const file of files.values()) {
    if (file?.body && !Buffer.isBuffer(file.body)) {
      file.body = Buffer.from(file.body.buffer, file.body.byteOffset, file.body.byteLength)
    }
  }
  return files
}

export function createBuildRunner({
  root,
  logger,
  deckRenderer,
  concurrency = 1,
  idleMs = 60000,
  timeoutMs = 0,
  resourceLimits,
} = {}) {
  const idle = []
  const all = new Set()
  const queue = []
  let closed = false

  function destroy(entry, error) {
    if (!all.has(entry)) return
    all.delete(entry)
    const index = idle.indexOf(entry)
    if (index >= 0) idle.splice(index, 1)
    clearTimeout(entry.idleTimer)
    entry.job?.reject(error || Object.assign(new Error('build worker stopped'), { statusCode: 500 }))
    entry.job = null
    entry.worker.terminate().catch(() => {})
    // A dying worker takes its own job down with it, and used to take the queue
    // with it too — silently. `checkIn` is the only other place that shifts the
    // queue, and it runs when a job FINISHES; a worker that is killed never
    // finishes one. So with every worker busy and a build queued behind them, one
    // OOM left that build waiting forever: no rejection, no timeout at this level,
    // nothing for the caller to observe. Capacity has just been freed by the
    // deletion above, so it is spent on the queue rather than left idle.
    if (!closed && queue.length && all.size < concurrency) {
      const next = queue.shift()
      if (next) dispatch(spawn(), next)
    }
  }

  function spawn() {
    const entry = { worker: null, job: null, idleTimer: null, ready: null }
    entry.worker = new Worker(BUILD_WORKER_ENTRY, {
      workerData: { root },
      resourceLimits,
      // The build's stdout/stderr are left connected to the parent's. Capturing
      // them (`stdout: true`) creates two extra MessagePorts per worker that
      // `worker.unref()` does not cover, and an idle worker would then hold the
      // process open for the whole idle window — a `node --test` run took 68 s
      // to exit after 8.6 s of work. A rendering dependency writing to stderr is
      // a smaller problem than a process that will not stop.
    })
    entry.ready = new Promise((resolve, reject) => {
      entry.resolveReady = resolve
      entry.rejectReady = reject
    })
    entry.worker.on('message', (message) => handle(entry, message))
    entry.worker.once('error', (error) => {
      entry.rejectReady?.(error)
      destroy(entry, error)
    })
    entry.worker.once('exit', (code) => {
      const error = Object.assign(new Error(`build worker exited with code ${code}`), { statusCode: 500 })
      entry.rejectReady?.(error)
      destroy(entry, error)
    })
    all.add(entry)
    return entry
  }

  // The in-process path accepts a renderer with only `render` (site-builder.mjs
  // makes the same allowance, and the release tests use that shape). Mirror it
  // here rather than making the thread boundary stricter than the code it
  // replaced: a renderer without `run` gets its own single-use permit scope.
  const runDeck = (renderer, task) => (renderer.run ? renderer.run(task) : task(renderer.render.bind(renderer)))

  function handle(entry, message) {
    // A throw in here would leave the job forever unsettled and its worker
    // forever ref'd — the process would never exit. Any failure becomes the
    // build's failure instead.
    const job = entry.job
    try {
      dispatchMessage(entry, message)
    } catch (error) {
      if (job) settle(entry, () => job.reject(error))
      else logger?.error?.('build runner message failed', { error: String(error?.message || error) })
    }
  }

  function dispatchMessage(entry, message) {
    const job = entry.job
    switch (message?.type) {
      case 'ready':
        entry.rejectReady = null
        entry.resolveReady?.()
        return
      case 'log':
        logger?.[message.level]?.(message.message, message.meta)
        return
      case 'deck:acquire': {
        if (!job) return
        if (!job.deckRenderer)
          return failCall(
            entry,
            message.id,
            Object.assign(new Error('deck renderer is unavailable'), { statusCode: 503 }),
          )
        // `run` owns the permit for the whole deck pipeline. Hold it open across
        // the worker's compile by parking on a promise the worker's
        // `deck:release` resolves — the same permit the in-process path held,
        // kept on the side that counts it.
        const parked = new Promise((resolve) => (job.releasePermit = resolve))
        Promise.resolve()
          .then(() =>
            runDeck(job.deckRenderer, async (render) => {
              job.render = render
              replyCall(entry, message.id, null)
              await parked
            }),
          )
          .catch((error) => {
            job.render = null
            failCall(entry, message.id, error)
          })
        return
      }
      case 'deck:render':
        if (!job?.render)
          return failCall(
            entry,
            message.id,
            Object.assign(new Error('deck render called without a permit'), { statusCode: 500 }),
          )
        job.render(message.markdown, message.theme).then(
          (value) => replyCall(entry, message.id, value),
          (error) => failCall(entry, message.id, error),
        )
        return
      case 'deck:release':
        job?.releasePermit?.()
        if (job) {
          job.releasePermit = null
          job.render = null
        }
        replyCall(entry, message.id, null)
        return
      case 'result':
        if (job?.id !== message.id) return
        // Restored before settle(), not inside it: a throw once the job has been
        // detached from its worker would leave the caller's promise pending
        // forever, and `handle` could no longer reject it.
        return settleResolved(entry, job, {
          ...message.value,
          files: restoreFiles(message.value.files),
        })
      case 'error':
        if (job?.id !== message.id) return
        settle(entry, () => job.reject(reviveBuildError(message.error)))
    }
  }

  const replyCall = (entry, id, value) => entry.worker.postMessage({ id, type: 'deck:reply', value })
  const failCall = (entry, id, error) =>
    entry.worker.postMessage({
      id,
      type: 'deck:fail',
      error: {
        message: String(error?.message ?? error),
        code: error?.code ?? null,
        statusCode: error?.statusCode ?? null,
      },
    })

  const settleResolved = (entry, job, value) => settle(entry, () => job.resolve(value))

  function settle(entry, emit) {
    const job = entry.job
    if (!job) return
    clearTimeout(job.timer)
    // The permit always comes back, however the build ended.
    job.releasePermit?.()
    // A build that ended while a deck render was still outstanding left the
    // worker holding a promise that will never resolve. buildSite awaits its
    // decks sequentially so this should be unreachable — but a reused worker in
    // an unknown state would answer the *next* release, so it is retired
    // instead. Being wrong here costs 2.6s; being wrong the other way corrupts
    // a release.
    const suspect = Boolean(job.render)
    entry.job = null
    emit()
    if (suspect) destroy(entry)
    else checkIn(entry)
  }

  function checkIn(entry) {
    if (closed || !all.has(entry)) return
    const next = queue.shift()
    if (next) return dispatch(entry, next)
    idle.push(entry)
    // A live Worker holds the event loop open. An idle one must not: otherwise
    // every process that ever published — a test run, a CLI build — would hang
    // for `idleMs` after its last line instead of exiting.
    entry.worker.unref?.()
    // A warm worker is worth ~2.6s on the next build and costs the build's
    // retained heap until it goes. Idle termination buys both.
    entry.idleTimer = setTimeout(() => destroy(entry), idleMs)
    entry.idleTimer.unref?.()
  }

  function dispatch(entry, job) {
    clearTimeout(entry.idleTimer)
    // Held open for the duration of the build: a process must not exit out from
    // under a release that is mid-render.
    entry.worker.ref?.()
    entry.job = job
    if (timeoutMs) {
      job.timer = setTimeout(() => {
        // A hung build cannot be interrupted from outside a thread, so the
        // thread goes. destroy() rejects the job.
        destroy(entry, Object.assign(new Error('site build timed out'), { code: 'TIMEOUT', statusCode: 504 }))
      }, timeoutMs)
      job.timer.unref?.()
    }
    entry.ready.then(
      () => {
        if (entry.job === job) entry.worker.postMessage({ type: 'build', id: job.id, input: job.input })
      },
      (error) => {
        if (entry.job === job) settle(entry, () => job.reject(error))
      },
    )
  }

  let nextJobId = 0

  function build(input) {
    if (closed) return Promise.reject(Object.assign(new Error('build runner is closed'), { statusCode: 503 }))
    const { logger: _ignored, deckRenderer: perBuild, ...data } = input
    const renderer = perBuild || deckRenderer
    return new Promise((resolve, reject) => {
      const job = {
        id: `b${++nextJobId}`,
        input: { root, ...data, hasDeckRenderer: Boolean(renderer) },
        deckRenderer: renderer,
        resolve,
        reject,
        render: null,
        releasePermit: null,
        timer: null,
      }
      const entry = idle.pop()
      if (entry) return dispatch(entry, job)
      if (all.size < concurrency) return dispatch(spawn(), job)
      queue.push(job)
    })
  }

  return {
    inflight: () => [...all].filter((entry) => entry.job).length,
    queued: () => queue.length,
    workers: () => all.size,
    build,
    async close() {
      closed = true
      const stopping = [...all]
      for (const entry of stopping)
        destroy(entry, Object.assign(new Error('build runner is closed'), { statusCode: 503 }))
      while (queue.length) queue.shift().reject(Object.assign(new Error('build runner is closed'), { statusCode: 503 }))
      await Promise.all(stopping.map((entry) => entry.worker.terminate().catch(() => {})))
    },
  }
}
