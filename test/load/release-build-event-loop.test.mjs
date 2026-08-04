// The one item in docs/OPEN-WORK.md whose fix is provable with a number.
//
//   node --test test/load/release-build-event-loop.test.mjs
//
// Not part of `npm test`: it builds a real site twice and takes about half a
// minute. Run it when releases.mjs, site-builder.mjs or build-runner.mjs change.
//
// It runs the harness in both modes on purpose. The worker case is the claim;
// the inline case is what stops the claim from being vacuous. A probe that
// silently stopped measuring — a dropped interval, a swallowed error, a
// keep-alive socket answering from a buffer — would make the worker case pass
// for the wrong reason. The inline case fails if the harness cannot still see
// the defect it was written to find.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const harness = join(root, 'scripts', 'loadtest-release-build.mjs')

// Small enough to run in seconds, large enough that the inline build holds the
// loop for multiple seconds — the assertions below check that it did.
const DOCUMENTS = '150'

// Defended: an unrelated request must not wait longer than a quarter second
// while a release builds. The floor is not zero — the parent thread still
// deserialises the build's output (tens of megabytes, ~17 ms at 400 documents)
// and still runs its own GC — so a threshold of "a few milliseconds" would be a
// flake generator on a loaded CI box. A quarter second is the largest delay
// that no client, human or scripted, treats as a failure, and it is ~40x below
// what the in-process build produces at this corpus size.
const WORST_MS = 250

async function harnessRun(mode) {
  const { stdout } = await run(process.execPath, [harness], {
    env: { ...process.env, CONTENTKIT_LOADTEST_MODE: mode, CONTENTKIT_LOADTEST_DOCUMENTS: DOCUMENTS },
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

test('a release build leaves the API answering', async () => {
  const report = await harnessRun('worker')

  assert.ok(
    report.build_ms > 1000,
    `the build finished in ${report.build_ms} ms — too fast to prove anything about a blocked loop`,
  )
  assert.ok(report.completed >= 5, `only ${report.completed} probe responses; the probe is not measuring`)
  assert.equal(report.failed, 0, `probe requests failed: ${report.errors.join(', ')}`)
  assert.equal(report.abandoned, 0, 'a probe request never came back')
  assert.ok(
    report.worst_ms <= WORST_MS,
    `worst GET /health during the build was ${report.worst_ms} ms, over the ${WORST_MS} ms ceiling`,
  )
})

test('the harness still detects an in-process build blocking the loop', async () => {
  const report = await harnessRun('inline')

  assert.ok(report.completed >= 5, `only ${report.completed} probe responses; the probe is not measuring`)
  // Not a bug report about the inline path — it is the control. If this ever
  // stops holding, the probe stopped working, not the event loop.
  assert.ok(
    report.worst_ms > WORST_MS,
    `an in-process build of ${DOCUMENTS} documents measured a worst response of ${report.worst_ms} ms. ` +
      'Either the build became far cheaper or the harness stopped measuring; check the harness before trusting it.',
  )
  assert.ok(
    report.worst_ms > report.build_ms * 0.5,
    `the in-process stall (${report.worst_ms} ms) should be most of the build (${report.build_ms} ms)`,
  )
})
