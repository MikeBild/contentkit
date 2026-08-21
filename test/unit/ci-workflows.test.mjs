/**
 * The coupling between `npm run verify` in package.json and the jobs in
 * .github/workflows/ci.yml.
 *
 * The convention check became mandatory in two places at once — the end of the
 * `verify` chain and a step in `cockpit-e2e` — and nothing but a comment said
 * the two lists belonged together. That is the shape
 * cockpit-parity/BEFUND-GATE-IST-NICHT-CI.md names: an equivalence a comment
 * asserts and nothing enforces. Remove the stage from either side and the other
 * stays green and silent. A comment cannot fail; this can.
 *
 * Mechanism copied from WikiKit's test/unit/ci-workflows.test.ts and WatchKit's
 * improvement on it (stage ids read from the source, plus a guard against a
 * regex that silently matches nothing) rather than imported — §7 has patterns
 * travel as copies.
 *
 * What is NOT asserted: that the two lists are identical. Three `verify` stages
 * have no CI job on purpose and two are spelled out in CI as the steps they
 * decompose into. Each is a row in the table below with its reason, so the
 * asymmetry is on the record instead of being a gap nobody can see.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const ci = parse(await readFile(join(root, '.github', 'workflows', 'ci.yml'), 'utf8'))
const release = parse(await readFile(join(root, '.github', 'workflows', 'release.yml'), 'utf8'))

/**
 * The stages of `npm run verify`, read out of the chain rather than typed here.
 *
 * Typed, this file would hold two hand-written lists against each other and
 * pass while both drifted away from the command that actually runs. Derived,
 * the only way to change the expectation is to change `verify` — which is the
 * event this file exists to notice.
 */
function verifyStages() {
  const chain = packageJson.scripts.verify
  assert.ok(typeof chain === 'string' && chain.length > 0, 'package.json must define a `verify` script')
  const stages = chain
    .split('&&')
    .map((step) => step.trim())
    // `npm test` is npm's shorthand for `npm run test`; both spellings are the
    // same stage and the chain uses the short one.
    .map((step) => (step === 'npm test' ? 'test' : /^npm run ([a-z][a-z0-9:-]*)$/.exec(step)?.[1]))
  // A step the parser did not recognise is not a step it may drop: a silently
  // shorter list would satisfy every assertion below without measuring
  // anything, which is the exact failure this file is written against.
  assert.deepEqual(
    stages.filter((stage) => stage === undefined),
    [],
    `every step of \`verify\` must be an \`npm run <script>\`; unparsed step in: ${chain}`,
  )
  assert.ok(stages.length > 8, `expected \`verify\` to have its stages readable, found ${stages.length}`)
  return stages
}

function job(name) {
  const found = ci.jobs?.[name]
  // A throwing accessor makes "the job was renamed or removed" a loud failure
  // rather than an `undefined` that quietly satisfies nothing.
  assert.ok(found, `expected ci.yml to define a job '${name}'`)
  return found
}

function runs(from) {
  return (from.steps ?? []).map((step) => step.run ?? '')
}

/**
 * Every stage of `verify`, and the CI job that runs it.
 *
 * `job: null` means "deliberately not in CI", and the reason has to be written
 * down — a stage with no job and no reason is the thing this file forbids.
 * `runs` are the exact step commands the job must carry: two stages are
 * decomposed in CI rather than invoked by their script name, and naming the
 * pieces is what keeps "CI runs this stage" from degrading into "CI runs
 * something in the same area".
 */
const VERIFY_STAGES_IN_CI = {
  lint: { job: 'test', runs: ['npm run lint'] },
  test: { job: 'test', runs: ['npm test'] },
  'test:contract': { job: 'test', runs: ['npm run test:contract'] },
  'test:smoke': { job: 'test', runs: ['npm run test:smoke'] },
  'check:embedded-drift': { job: 'test', runs: ['npm run check:embedded-drift'] },
  'check:docs-drift': { job: 'test', runs: ['npm run check:docs-drift'] },
  'test:integration': { job: 'integration', runs: ['npm run test:integration'] },
  // Spelled out rather than invoked: the `cockpit` job's working directory is
  // apps/cockpit, so it runs the two halves the root script composes —
  // regenerate, then refuse a diff — against the app's own lockfile and cache.
  'check:cockpit-api-drift': {
    job: 'cockpit',
    runs: ['npm run gen:api', 'git diff --exit-code -- src/api/schema.d.ts'],
  },
  // Also spelled out: `validate:cockpit` is `cockpit:build` followed by the
  // browser validator, and cockpit-e2e needs the build step to stand on its own
  // because `konvention:check` runs against the same bundle afterwards.
  'validate:cockpit': { job: 'cockpit-e2e', runs: ['npm run cockpit:build', 'npm run validate:cockpit:browser'] },
  'konvention:check': { job: 'cockpit-e2e', runs: ['npm run konvention:check'] },
  // Local only. The gallery validators drive a browser against generated site
  // output, and ci.yml says so in the cockpit-e2e job: "The three site
  // validators in `validate:visuals` need one too and run nowhere but a
  // developer's machine." That is a standing gap, not an oversight — and it is
  // written here so it stays one somebody can see.
  'validate:visuals': { job: null },
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ASSERTION THIS FILE WAS WRITTEN FOR.
//
// Both directions, from one comparison: a stage removed from `verify` leaves a
// key here with nothing to match, and a stage added to `verify` arrives without
// one. Either way somebody has to say which job runs it, or say why none does.
// ─────────────────────────────────────────────────────────────────────────────
test('every stage of `npm run verify` is accounted for against CI', () => {
  assert.deepEqual(
    verifyStages().sort(),
    Object.keys(VERIFY_STAGES_IN_CI).sort(),
    'the `verify` chain and the table in this file have drifted apart. A stage was added or removed; say which CI ' +
      'job runs it, or say why none does — an equivalence nothing enforces is what this test exists to prevent',
  )
})

test('each stage runs in the job the table names, step by step', () => {
  for (const [stage, entry] of Object.entries(VERIFY_STAGES_IN_CI)) {
    if (entry.job === null) continue
    const steps = runs(job(entry.job))
    for (const command of entry.runs) {
      assert.ok(
        steps.includes(command),
        `\`verify\` stage '${stage}' is claimed by CI job '${entry.job}', which runs no step \`${command}\`. ` +
          `The job's steps are: ${steps.filter(Boolean).join(' | ')}`,
      )
    }
  }
})

// The other side of the same seam: a stage that stays in `verify` but quietly
// moves to a different job, or gets a second home, would satisfy the test above
// and still break the sentence the table asserts.
test('no CI job runs a verify stage the table assigns elsewhere', () => {
  const stages = new Set(verifyStages())
  for (const [name, entry] of Object.entries(ci.jobs)) {
    for (const command of runs(entry)) {
      const stage = /^npm (?:run )?([a-z][a-z0-9:-]*)$/.exec(command.trim())?.[1]
      const resolved = stage === 'test' ? 'test' : stage
      if (!resolved || !stages.has(resolved)) continue
      assert.equal(
        VERIFY_STAGES_IN_CI[resolved].job,
        name,
        `job '${name}' runs the verify stage '${resolved}', which this file assigns to ` +
          `'${VERIFY_STAGES_IN_CI[resolved].job ?? 'no job at all'}'`,
      )
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Order, in both files.
//
// The stages are not interchangeable. Two orderings carry a guarantee, and both
// of them are the kind that fails silently when broken: the run stays green and
// stops meaning anything.
// ─────────────────────────────────────────────────────────────────────────────
test('`verify` builds the console before it measures it, and generates before it builds', () => {
  const stages = verifyStages()
  const at = (stage) => {
    const index = stages.indexOf(stage)
    assert.notEqual(index, -1, `\`verify\` must contain '${stage}'`)
    return index
  }

  // konvention:check reads the BUILT assets/cockpit and refuses a bundle whose
  // inputs no longer hash to its stamp. Pulled ahead of validate:cockpit it
  // would meet either no bundle at all or the previous one, and the guard that
  // exists to stop a green verdict about the wrong bytes would be answering
  // about the wrong bytes itself.
  assert.ok(
    at('validate:cockpit') < at('konvention:check'),
    '`konvention:check` must run after `validate:cockpit`, which is what builds the bundle it measures',
  )

  // check:cockpit-api-drift REWRITES apps/cockpit/src/api/schema.d.ts before it
  // refuses a diff, so it belongs in front of the build that reads that input
  // (LOCAL-CK-DRIFT-VOR-BUILD). Under the old mtime guard this was not a
  // preference: the rewrite pushed the mtime past the bundle's and made
  // konvention:check red on every run. The content stamp removed that symptom —
  // measured: `gen-api` moves the mtime, leaves the content identical and the
  // digest unmoved — so the order now stands on the plain argument alone.
  assert.ok(
    at('check:cockpit-api-drift') < at('validate:cockpit'),
    '`check:cockpit-api-drift` regenerates a build input, so it must run before the build, not after it',
  )
})

test('the cockpit-e2e job installs a browser, builds, and only then measures', () => {
  const steps = runs(job('cockpit-e2e'))
  const at = (predicate, what) => {
    const index = steps.findIndex(predicate)
    assert.notEqual(index, -1, `the cockpit-e2e job must ${what}`)
    return index
  }

  // Playwright's browser binaries are not in node_modules, and there is no
  // postinstall that fetches them. Without this step the mandatory stage is red
  // for a reason that has nothing to do with the convention.
  const install = at((step) => /playwright install/.test(step), 'install a browser')
  assert.ok(steps[install].includes('chromium'))
  const build = at((step) => step === 'npm run cockpit:build', 'build the bundle')
  const check = at((step) => step === 'npm run konvention:check', 'run the convention check')
  assert.ok(install < build, 'the browser has to exist before the build that the check drives')
  assert.ok(build < check, 'the convention check reads the built bundle; building it afterwards measures nothing')
})

// The seam WikiKit's copy of this test was written for: CI invokes package.json
// script NAMES, and nothing else in the repository compares those names to the
// scripts that exist. A reverted package.json edit once made CI fail with
// "Missing script" while every local gate stayed green.
test('every `npm run <script>` a workflow invokes exists in package.json', () => {
  const workflows = [
    ['ci.yml', ci],
    ['release.yml', release],
  ]
  let seen = 0
  for (const [file, workflow] of workflows) {
    for (const [name, entry] of Object.entries(workflow.jobs ?? {})) {
      for (const command of runs(entry)) {
        for (const match of command.matchAll(/\bnpm run (?:--silent )?([a-z][a-z0-9:-]*)/g)) {
          // Steps that run inside apps/cockpit call that package's scripts.
          if (entry.defaults?.run?.['working-directory'] === 'apps/cockpit') continue
          seen += 1
          assert.ok(
            packageJson.scripts[match[1]],
            `${file} job '${name}' runs \`npm run ${match[1]}\`, which package.json lacks`,
          )
        }
      }
    }
  }
  assert.ok(seen > 8, `expected the workflows' npm invocations to be readable, found ${seen}`)
})

test('the workflow files parse into the jobs this file reasons about', () => {
  // Another guard against a vacuous pass: a parse that yielded an empty object
  // would let every loop above iterate over nothing.
  const jobs = Object.keys(ci.jobs ?? {})
  assert.ok(jobs.length >= 7, `expected ci.yml to define its jobs, found ${jobs.join(', ') || 'none'}`)
  for (const name of jobs) {
    assert.ok((ci.jobs[name].steps ?? []).length > 0, `job '${name}' has no steps`)
  }
})
