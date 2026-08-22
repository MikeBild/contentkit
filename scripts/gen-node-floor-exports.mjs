/**
 * Writes down what `node:` modules export on the OLDEST Node this package claims.
 *
 * `package.json` says `engines.node: >=20.12`; CI runs a 20.x leg. A developer
 * machine on 22 or 24 has every export the floor has and more, so an import of
 * something newer — `fs.globSync`, added in 22 — is green locally and red on the
 * runner, and it is red as a MODULE THAT DOES NOT LOAD rather than as a case
 * that fails. That is the shape LOCAL-CK-CI-NEUER-ALS-DER-RUNNER names: local
 * green bought with a richer machine.
 *
 * The snapshot this writes is what `test/unit/ci-workflows.test.mjs` measures
 * imports against, so the check needs no second Node binary and runs everywhere.
 * Regenerate ONLY when `engines.node` moves to a new major:
 *
 *   nvm exec 20 node scripts/gen-node-floor-exports.mjs
 *
 * Running it on the wrong major is refused rather than silently widening the
 * snapshot — a snapshot generated from Node 24 would permit exactly the imports
 * it exists to forbid.
 */
import { builtinModules } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.removeAllListeners('warning')
process.on('warning', () => {})

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(root, 'test', 'fixtures', 'node-engine-floor.json')

const { engines } = JSON.parse(await (await import('node:fs/promises')).readFile(join(root, 'package.json'), 'utf8'))
const floor = /(\d+)\./.exec(engines?.node ?? '')?.[1]
if (!floor) {
  console.error(`package.json engines.node ('${engines?.node}') does not name a floor version`)
  process.exit(1)
}
const running = process.versions.node.split('.')[0]
if (running !== floor) {
  console.error(
    `refusing to write the floor snapshot from Node ${process.versions.node}: engines.node is '${engines.node}', ` +
      `so this must run on ${floor}.x. Try: nvm exec ${floor} node scripts/gen-node-floor-exports.mjs`,
  )
  process.exit(1)
}

/**
 * `builtinModules` does not list the prefix-only builtins on this floor —
 * `node:test` is missing from it on 20.x, and every test file in this repository
 * imports it. Left out, the checker would call the module unknown and go red on
 * a hundred files that are perfectly correct.
 */
const PREFIX_ONLY = ['test', 'test/reporters', 'sea', 'sqlite']

const modules = {}
for (const name of [...new Set([...builtinModules, ...PREFIX_ONLY])].sort()) {
  if (name.startsWith('_') || name === 'sys') continue
  try {
    modules[name] = Object.keys(await import(`node:${name}`))
      .filter((key) => key !== 'default')
      .sort()
  } catch {
    // A builtin this Node refuses to load (a flag-gated one, or a prefix-only
    // name this floor does not have yet) exports nothing an import statement may
    // name here either. Recording it empty is the honest answer for the first
    // case; for the second the name simply must not appear at all.
    if (!PREFIX_ONLY.includes(name)) modules[name] = []
  }
}

const snapshot = {
  comment:
    'Named exports of every node: builtin on the OLDEST Node engines.node allows. Regenerate with ' +
    'scripts/gen-node-floor-exports.mjs on that major — never on a newer one. See the script header.',
  engines: engines.node,
  generatedFrom: `v${process.versions.node}`,
  modules,
}
await writeFile(OUT, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`wrote ${OUT} from Node v${process.versions.node} — ${Object.keys(modules).length} modules`)
