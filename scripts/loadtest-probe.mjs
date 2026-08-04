// Out-of-process latency probe for the release-build load harness.
//
// It must not share an event loop with the thing it measures: an in-process
// timer cannot fire while the loop is blocked, so an in-process prober would
// report the stall as "no samples" rather than as latency. This runs as its own
// process, fires GET /health on a fixed wall-clock cadence, and does NOT wait
// for the previous request — a twenty-second stall must show up as a hundred
// requests each waiting longer, which is exactly what a real client sees.
//
// Protocol: argv[2] is the base URL. Requests keep firing until stdin closes,
// then a JSON summary goes to stdout and the process exits.
import { get } from 'node:http'

const base = process.argv[2]
const intervalMs = Number(process.argv[3] || 200)
if (!base) {
  process.stderr.write('usage: loadtest-probe.mjs <base-url> [interval-ms]\n')
  process.exit(2)
}

const samples = []
let stopping = false
let inflight = 0

function fire() {
  if (stopping) return
  const started = process.hrtime.bigint()
  const sample = { started_at: Date.now(), ms: null, error: null }
  samples.push(sample)
  inflight++
  const finish = (error) => {
    if (sample.ms !== null || sample.error !== null) return
    sample.ms = Number(process.hrtime.bigint() - started) / 1e6
    sample.error = error
    inflight--
  }
  const request = get(`${base}/health`, { agent: false }, (res) => {
    res.resume()
    res.once('end', () => finish(res.statusCode === 200 ? null : `status ${res.statusCode}`))
  })
  request.once('error', (error) => finish(String(error.code || error.message || error)))
  // Long enough that a blocked loop shows up as latency rather than as a
  // socket error — the whole point is to measure the stall, not to time out of it.
  request.setTimeout(120000, () => {
    request.destroy(new Error('probe timeout'))
  })
}

const timer = setInterval(fire, intervalMs)
fire()

function quantile(sorted, q) {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[index]
}

async function stop() {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  // Drain: requests issued during the stall are still the measurement.
  const deadline = Date.now() + 150000
  while (inflight > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50))
  const done = samples.filter((sample) => sample.ms !== null)
  const ok = done.filter((sample) => !sample.error)
  const durations = ok.map((sample) => sample.ms).sort((a, b) => a - b)
  process.stdout.write(
    `${JSON.stringify({
      requests: samples.length,
      completed: done.length,
      failed: done.filter((sample) => sample.error).length,
      abandoned: samples.length - done.length,
      worst_ms: durations.length ? Number(durations[durations.length - 1].toFixed(2)) : null,
      p99_ms: durations.length ? Number(quantile(durations, 0.99).toFixed(2)) : null,
      p50_ms: durations.length ? Number(quantile(durations, 0.5).toFixed(2)) : null,
      errors: [...new Set(done.map((sample) => sample.error).filter(Boolean))],
    })}\n`,
  )
  process.exit(0)
}

process.stdin.once('end', stop)
process.stdin.once('close', stop)
process.stdin.resume()
process.once('SIGTERM', stop)
