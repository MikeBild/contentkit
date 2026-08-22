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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A WARNING FROM THE SECOND HALF OF THIS FILE, TO WHOEVER TOUCHES IT NEXT.
 *
 * The readings below exist because three defects reached main that were green on
 * a developer's machine and red on the runner — a Node 22 export, an unwarmed
 * browser cache, a hook Node 20 does not call. THE FIRST VERSION OF THOSE
 * READINGS WAS THAT DEFECT ITSELF, and it is worth knowing exactly how.
 *
 * `test/fixtures/node-engine-floor.json` is written on whatever machine runs the
 * generator. The self-check compared EVERY name in it against the running Node,
 * and on the Linux runner it failed on `constants.O_SYMLINK` — an export macOS
 * has, Linux does not, and NOTHING IN THIS REPOSITORY IMPORTS. It was the only
 * failure in an otherwise green 20.x leg: 1123 of 1127.
 *
 * THE SNAPSHOT IS A FLOOR FOR THE VERSION, NOT FOR THE PLATFORM. Do not make it
 * one again. A few builtins export platform-specific names, so a check that
 * compares the whole snapshot to the whole engine is measuring a difference no
 * import can reach — and a check that fails on something nobody can act on is a
 * check people learn to ignore. The self-check therefore measures THE IMPORTS
 * THE TREE ACTUALLY MAKES, which is the set that would break at runtime and the
 * only set worth failing over.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
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

// ═════════════════════════════════════════════════════════════════════════════
// THE OTHER DIRECTION OF THE SAME SEAM — LOCAL-CK-CI-NEUER-ALS-DER-RUNNER.
//
// Everything above this line guards against a gate that switches itself off: a
// stage that stops running, a job that stops carrying it. Two defects reached
// main that were the exact INVERSE, and no assertion in this file could have
// seen either, because on the machine that measured them nothing was wrong:
//
//   • `import { globSync } from 'node:fs'` — an export Node 22 has and the
//     20.x leg does not. The whole module failed to load; 22 cases vanished.
//   • a contract test that launches Chromium in a job that installs no browser.
//     Locally the cache was warm; on the runner the hook cancelled ten cases.
//
// Neither is a suite going quiet. Both are a suite that is green LOCALLY ONLY
// BECAUSE THE MACHINE IS RICHER THAN THE RUNNER — newer Node, warm browser
// cache. A gate that only asks "does it still run here?" cannot see that. These
// two ask what the POOREST runner has, and they ask it before the push.
// ═════════════════════════════════════════════════════════════════════════════

/** Every `.mjs` under the directories CI executes code from. */
function sources() {
  const found = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full)
      } else if (entry.name.endsWith('.mjs')) found.push(full)
    }
  }
  for (const directory of ['test', 'scripts', 'src']) walk(join(root, directory))
  return found.sort()
}

/**
 * Every `node:` builtin this source names, and how.
 *
 * Two readings, because they carry different certainties:
 *
 *   • `named` — `import { x } from 'node:fs'`. Exact. An `x` the floor does not
 *     export is not a case that fails, it is a MODULE THAT DOES NOT LOAD, and
 *     it takes every case in the file with it.
 *   • `members` — `import fs from 'node:fs'` followed by `fs.x`. A regex over
 *     text, so it cannot tell a member expression from the same letters inside
 *     a string. It is only ever reported when `x` is a real export of that
 *     module on the Node RUNNING THIS FILE and absent from the floor — which is
 *     the definition of the defect and not something `'a.test.mjs'` can be.
 */
function builtinUsage(source) {
  // Prose is not code. This file's own docblocks quote the offending import
  // verbatim, and so does the next one that explains a fix — a reading that
  // counted those would be red on the explanation rather than on the defect.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const named = []
  const members = []
  for (const match of text.matchAll(/import\s+([^;'"]*?)\s+from\s+['"]node:([a-z/]+)['"]/g)) {
    const clause = match[1].trim()
    const module = match[2]
    const braces = /\{([^}]*)\}/.exec(clause)
    if (braces) {
      for (const part of braces[1].split(',')) {
        const name = part
          .trim()
          .split(/\s+as\s+/)[0]
          .trim()
        if (name) named.push({ module, name })
      }
    }
    const bare = clause
      .replace(/\{[^}]*\}/, '')
      .replace(/,/g, ' ')
      .trim()
    const binding = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(bare)?.[1] ?? (/^[A-Za-z_$][\w$]*$/.test(bare) ? bare : null)
    if (!binding) continue
    // Not preceded by a word character or a dot: `fs.globSync` reads, the `test`
    // in `'cockpit-lists.test.mjs'` does not.
    for (const use of text.matchAll(new RegExp(`(?<![\\w$.])${binding}\\.([A-Za-z_$][\\w$]*)`, 'g'))) {
      members.push({ module, binding, name: use[1] })
    }
  }
  return { named, members }
}

const FLOOR = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'node-engine-floor.json'), 'utf8'))

/** What the Node running this file exports — the yardstick for the member reading. */
const hereExports = new Map()
for (const module of new Set(Object.keys(FLOOR.modules))) {
  try {
    hereExports.set(module, new Set(Object.keys(await import(`node:${module}`))))
  } catch {
    hereExports.set(module, new Set())
  }
}

const REGENERATE = 'nvm exec 20 node scripts/gen-node-floor-exports.mjs'

test('the floor snapshot describes the engine package.json actually claims', () => {
  const floor = /(\d+)\./.exec(packageJson.engines.node)?.[1]
  assert.ok(floor, `engines.node ('${packageJson.engines.node}') must name a floor version`)
  assert.equal(
    FLOOR.generatedFrom.replace(/^v/, '').split('.')[0],
    floor,
    `the snapshot was taken on Node ${FLOOR.generatedFrom} but engines.node is '${packageJson.engines.node}'. ` +
      `A snapshot from a newer major permits exactly the imports it exists to forbid — regenerate: ${REGENERATE}`,
  )
  assert.ok(Object.keys(FLOOR.modules).length > 40, 'the snapshot must list the builtins, not a handful')
  assert.ok(FLOOR.modules.fs?.length > 50 && FLOOR.modules.test?.length > 5, 'the snapshot is not readable')
})

// The snapshot is committed, so on 22.x and on a developer machine nothing
// re-derives it. This is what stops it drifting into fiction: on the 20.x leg —
// the floor itself — a name it claims has to be really there.
//
// SCOPED TO WHAT THE TREE ACTUALLY IMPORTS, and that scope is the whole point.
// The first version compared EVERY name in the snapshot against the running
// Node and went red on the runner for `constants.O_SYMLINK` — an export macOS
// has, Linux does not, and nothing in this repository imports. The snapshot is
// written on a developer's machine, so it is a floor for the VERSION and not for
// the platform, and a check that fails on a difference no import can reach is a
// check people learn to ignore. What it has to catch is the snapshot permitting
// an import this engine cannot serve, so it measures the imports.
test('on the floor engine, every import the snapshot permits really resolves', (t) => {
  if (process.versions.node.split('.')[0] !== FLOOR.generatedFrom.replace(/^v/, '').split('.')[0]) {
    t.diagnostic(`not the floor engine (running v${process.versions.node}); the 20.x CI leg is where this measures`)
    return
  }
  let checked = 0
  for (const file of sources()) {
    for (const { module, name } of builtinUsage(readFileSync(file, 'utf8')).named) {
      if (!FLOOR.modules[module]?.includes(name)) continue
      const live = hereExports.get(module)
      if (!live?.size) continue
      checked += 1
      assert.ok(
        live.has(name),
        `${relative(root, file)} imports { ${name} } from 'node:${module}', which the snapshot permits and this ` +
          `Node (v${process.versions.node} on ${process.platform}) does not export. ${REGENERATE}`,
      )
    }
  }
  assert.ok(checked > 300, `expected the tree's builtin imports to be readable, checked ${checked}`)
})

/** Every use of a builtin export the floor engine does not have. */
function tooNewForTheFloor(text) {
  const { named, members } = builtinUsage(text)
  const offences = []
  for (const { module, name } of named) {
    const floor = FLOOR.modules[module]
    if (!floor) {
      offences.push(`node:${module} is not in the floor snapshot at all — ${REGENERATE}`)
    } else if (!floor.includes(name)) {
      offences.push(`import { ${name} } from 'node:${module}' — not exported on Node ${FLOOR.generatedFrom}`)
    }
  }
  for (const { module, binding, name } of members) {
    const floor = FLOOR.modules[module]
    if (floor && !floor.includes(name) && hereExports.get(module)?.has(name)) {
      offences.push(`${binding}.${name} (node:${module}) — exists here, not on Node ${FLOOR.generatedFrom}`)
    }
  }
  return offences
}

// The guard against a vacuous pass, and the reproduction of the defect in one:
// both spellings of the real thing that broke the 20.x leg, plus one line that
// is only the same letters inside a string.
test('the floor reading catches both spellings, and is not fooled by a filename', () => {
  // Read from disk rather than written here: the tree scan below reads every
  // .mjs in test/, and a planted offence spelled inline would be one it finds.
  const planted = readFileSync(join(root, 'test', 'fixtures', 'too-new-for-the-floor.mjs.fixture'), 'utf8')
  assert.match(planted, /globSync/, 'the planted fixture no longer contains the offence it exists to carry')
  const offences = tooNewForTheFloor(planted)

  // The named reading is exact and holds on every engine.
  assert.ok(
    offences.some((line) => line.includes('import { globSync }')),
    `the named reading missed the import it exists for; it reported: ${offences.join(' | ') || 'nothing'}`,
  )

  // The member reading only ever speaks when the engine running this file HAS
  // the export and the floor does not — which is precisely the situation it is
  // for. Run on the floor itself there is nothing newer to see, and saying so
  // is honest; on 22.x and on a developer machine it must find `fs.globSync`.
  const aboveTheFloor = process.versions.node.split('.')[0] !== FLOOR.generatedFrom.replace(/^v/, '').split('.')[0]
  assert.equal(
    offences.some((line) => line.includes('fs.globSync')),
    aboveTheFloor,
    aboveTheFloor
      ? `running above the floor, the member reading must report fs.globSync; it reported: ${offences.join(' | ')}`
      : 'running on the floor, the member reading has nothing newer to compare against and must stay quiet',
  )

  // And the decoy: `.test.mjs` inside a string is not a member expression.
  assert.equal(
    offences.filter((line) => /\bmjs\b|readFileSync|existsSync/.test(line)).length,
    0,
    `the reading was fooled by something that is not an offence: ${offences.join(' | ')}`,
  )
  assert.equal(offences.length, aboveTheFloor ? 2 : 1, `unexpected offence list: ${offences.join(' | ')}`)
})

test('no source uses a `node:` export the oldest supported engine lacks', () => {
  const files = sources()
  assert.ok(files.length > 100, `expected the tree to be readable, found ${files.length} .mjs files`)
  const offences = []
  for (const file of files) {
    for (const line of tooNewForTheFloor(readFileSync(file, 'utf8'))) {
      offences.push(`${relative(root, file)}: ${line}`)
    }
  }
  assert.deepEqual(
    offences,
    [],
    'these run on `engines.node ' +
      packageJson.engines.node +
      '` and on the 20.x CI leg, where a missing export is not a failing case but a module that never loads:\n  ' +
      offences.join('\n  '),
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// A HOOK OUTSIDE A SUITE IS A ROOT HOOK, AND THE FLOOR DOES NOT CALL THOSE.
//
// The third defect of the same family, and the one no import list can see:
// Node's runner only began running root `before`/`after` in 22. On the 20.x leg
// a hook written at the top level is REGISTERED AND NEVER CALLED. It does not
// throw and it does not say so — the cases simply meet whatever the hook was
// supposed to set up. Measured before the fix: eight cases of the identity
// reader failing on `page === null`, and a build worker outliving its file by
// the whole rest of the process.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT_HOOK = /^(?:before|after|beforeEach|afterEach)\s*\(/m

test('no test file registers a hook outside a suite', () => {
  // The reading, held against a planted line first. It is spelled as a string
  // here, so the scan below does not find it in this file: a root hook is one
  // that starts a LINE, and this one starts after a quote.
  const planted = 'const shared = make()\nafter(() => shared.close())\n'
  assert.match(planted, ROOT_HOOK, 'the reading no longer recognises a root hook')
  assert.doesNotMatch("describe('x', () => {\n  after(() => {})\n})\n", ROOT_HOOK, 'a hook inside a suite is fine')

  const offenders = sources()
    .filter((file) => file.startsWith(join(root, 'test')))
    .filter((file) => ROOT_HOOK.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
    .map((file) => relative(root, file))
  assert.deepEqual(
    offenders,
    [],
    'Node runs root hooks from 22 onward; `engines.node ' +
      packageJson.engines.node +
      '` and the 20.x CI leg do not. Move the hook inside its `describe`, or make the teardown a final case:\n  ' +
      offenders.join('\n  '),
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// A BROWSER IS NOT PART OF `npm ci`.
//
// Playwright's binaries live outside node_modules and no postinstall fetches
// them, so a developer's cache is warm for reasons a fresh runner's never is.
// A suite that launches one in a job that installs none does not fail loudly —
// the hook throws and every case in the file is CANCELLED, which is neither a
// pass nor a failure anybody reads as "this measured nothing".
// ─────────────────────────────────────────────────────────────────────────────

/** The files a `node --test <glob>` command actually runs. Only the forms package.json uses. */
function filesOfTestGlob(pattern) {
  const slash = pattern.lastIndexOf('/')
  const directory = join(root, pattern.slice(0, slash))
  const suffix = pattern.slice(slash + 1).replace(/^\*/, '')
  return readdirSync(directory)
    .filter((name) => name.endsWith(suffix))
    .map((name) => join(directory, name))
}

/** A file, plus every local `.mjs` it imports, transitively. */
function withLocalImports(entry, seen = new Set()) {
  // A specifier can also appear inside a string literal that a test asserts
  // about; resolving one of those yields a path that is not there. Skipping it
  // is right — it is not something the job runs.
  if (seen.has(entry) || !existsSync(entry)) return seen
  seen.add(entry)
  let text
  try {
    text = readFileSync(entry, 'utf8')
  } catch {
    return seen
  }
  for (const match of text.matchAll(/from\s+['"](\.[^'"]+\.mjs)['"]/g)) {
    withLocalImports(join(dirname(entry), match[1]), seen)
  }
  return seen
}

/** Everything a CI job executes: the test files behind its `node --test` globs and the scripts it names. */
function filesRunBy(entry) {
  const files = new Set()
  const add = (file) => {
    for (const reached of withLocalImports(file)) files.add(reached)
  }
  for (const command of runs(entry)) {
    for (const match of command.matchAll(/\bnpm (?:run (?:--silent )?)?([a-z][a-z0-9:-]*)/g)) {
      const script = packageJson.scripts[match[1]]
      if (!script) continue
      for (const glob of script.matchAll(/(?:^|\s)(test\/[a-z-]+\/\S*\.mjs)/g)) {
        for (const file of glob[1].includes('*') ? filesOfTestGlob(glob[1]) : [join(root, glob[1])]) add(file)
      }
      for (const named of script.matchAll(/node\s+(scripts\/\S+\.mjs)/g)) add(join(root, named[1]))
    }
    for (const named of command.matchAll(/node\s+(scripts\/\S+\.mjs)/g)) add(join(root, named[1]))
  }
  return files
}

const LAUNCHES_A_BROWSER = /from\s+['"](?:playwright|playwright-core)['"]|require\(['"]playwright/

test('every CI job that runs browser-driving code installs the browser first', () => {
  let inspected = 0
  const missing = []
  for (const [name, entry] of Object.entries(ci.jobs)) {
    const drivers = [...filesRunBy(entry)].filter((file) => LAUNCHES_A_BROWSER.test(readFileSync(file, 'utf8')))
    inspected += 1
    if (drivers.length === 0) continue
    const installs = runs(entry).some((step) => /playwright install/.test(step))
    if (!installs) missing.push(`job '${name}' runs ${drivers.map((file) => relative(root, file)).join(', ')}`)
  }
  assert.ok(inspected >= 7, `expected to inspect every job, inspected ${inspected}`)
  assert.deepEqual(
    missing,
    [],
    'a browser is not part of `npm ci`, and a launch that fails in a hook cancels every case in the file rather ' +
      'than failing one. Add `npx playwright install chromium` to the job, or move the file to a job that has ' +
      `one:\n  ${missing.join('\n  ')}`,
  )
})

// The guard against the assertion above passing because it found nothing: the
// two jobs that DO drive a browser have to be seen as such.
test('the browser reading actually finds the jobs that drive one', () => {
  for (const name of ['test', 'cockpit-e2e']) {
    const drivers = [...filesRunBy(job(name))].filter((file) => LAUNCHES_A_BROWSER.test(readFileSync(file, 'utf8')))
    assert.ok(drivers.length > 0, `job '${name}' drives a browser; this reading found none, so it is measuring nothing`)
  }
})
