/**
 * The content stamp of `assets/cockpit`: what the bundle was built FROM.
 *
 * WHY THIS EXISTS
 *
 * Every rule in scripts/konvention-check.mjs but one is read off the BUILT
 * console, so a bundle that predates a source change turns the checker into a
 * green verdict about bytes nobody ships. The first attempt at that guard
 * compared modification times, and mtimes answer a different question than the
 * one being asked. Three ways it said "fresh" over a changed source, the first
 * measured rather than reasoned:
 *
 *   1. A restore that preserves timestamps. `cp -p`, `rsync -a`, `tar -x` and
 *      every CI cache restore keep the original mtime, so a source older than
 *      the bundle can carry newer content. Measured: a §6 breach written into
 *      apps/cockpit/src/lib/i18n.ts plus `touch -t 202608202000` produced
 *      `conform: true` and exit 0.
 *   2. Dotted entries were skipped wholesale — correct for `.vite`, a cache
 *      written DURING the build, but `.env.production` is skipped by the same
 *      line and Vite bakes its `VITE_*` values into the bundle.
 *   3. Build inputs outside `apps/cockpit` were never looked at at all:
 *      vite.config.ts hashes `contract/cockpit-ui.css` into the served
 *      document, and `gen:css` derives `src/content/site.scoped.css` from
 *      `assets/site.css` — the second one only during a build, so editing it
 *      changes nothing a source walk can see until the next build happens.
 *
 * All three are the same defect: mtime is a proxy, and a proxy can be wrong in
 * the direction that matters. Content cannot. This module hashes the actual
 * build inputs; `npm run build` in apps/cockpit writes the result beside the
 * bundle, and the checker recomputes it and compares. Equal means the bundle
 * was built from exactly these bytes — restored timestamps, dotfiles and files
 * outside the app included.
 *
 * WHAT IT COSTS
 *
 * One walk and one sha256 per input file, measurable with this file's `--time`
 * CLI. It is a fraction of a second against a build that takes tens of them and
 * a browser sweep that takes twenty.
 *
 * THE FAILURE DIRECTION
 *
 * Every way of being wrong here is red. A missing or unreadable stamp is
 * refused outright. A bundle built by a path that writes no stamp leaves the
 * previous one standing — and that is still safe, because the previous stamp
 * describes the sources of the previous build: if they have moved since, the
 * hashes disagree and the run is refused; if they have not, the rebuild came
 * from the same bytes and the stamp is telling the truth. The one thing this
 * cannot do is certify a bundle it cannot account for.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Where the stamp lives: beside the bundle it describes, and deliberately NOT
 * inside it.
 *
 * `assets/cockpit` is served unauthenticated at /cockpit/ — src/cockpit.mjs
 * says so in as many words, because the bundle carries no data. The stamp does:
 * a list of every source file in the console and a sha256 of each. Inside the
 * output directory it would be `GET /cockpit/build-stamp.json` to anybody, and
 * the day an `.env.production` appears that becomes a hash of secrets, offered
 * over the internet to be brute-forced. One directory up it is unreachable —
 * serveCockpit() normalises the path first and rejects anything that leaves
 * COCKPIT_DIR — while still travelling with the bundle in build-binary.sh's
 * `assets` tar entry.
 */
export const STAMP_PATH = join('assets', 'cockpit-build-stamp.json')

/** The app whose whole tree is a build input. */
const APP = join('apps', 'cockpit')

/**
 * Build inputs that do NOT live under apps/cockpit.
 *
 * This list is held by test/unit/cockpit-build-stamp.test.mjs, which finds
 * every file in the app that reads from disk at build time and requires each of
 * them to declare what it reads. A fourth input added tomorrow arrives as a new
 * build-time reader, and that test turns red until it appears here — which is
 * the answer to "what could join the build without anybody noticing".
 */
export const EXTERNAL_INPUTS = [
  // vite.config.ts hashes this file and writes the digest into the served
  // document as <meta name="cockpit-ui-digest">. It is the family's contract
  // file, so of all the inputs this is the one a stale bundle may not hide.
  join('contract', 'cockpit-ui.css'),
  // apps/cockpit/scripts/scope-site-css.mjs derives src/content/site.scoped.css
  // from it, and `gen:css` runs inside `npm run build`. The derived file is a
  // build input too and is walked with the app — but it is only rewritten BY a
  // build, so without this entry an edit to the published stylesheet would be
  // invisible to the stamp until the very build it is supposed to demand.
  join('assets', 'site.css'),
]

/**
 * Directory names never walked under apps/cockpit.
 *
 * `node_modules` is the dependency tree: hashing ~900 packages would dominate
 * the cost, and `package-lock.json` — which IS hashed, like every other file in
 * the app — already names every byte of it. `dist` and `.vite` are outputs and
 * caches written during the build, so hashing them would make every bundle
 * stale the moment it was made.
 */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.vite', '.git'])

/**
 * Files never hashed.
 *
 * Only Finder's folder-metadata droppings. Note what is NOT here: dotted
 * entries in general ARE hashed, because `.env`, `.env.production` and
 * `.gitignore` all reach the bundle — `.env.production` most directly of all,
 * since Vite substitutes its `VITE_*` values into the emitted JavaScript.
 */
const SKIPPED_FILES = new Set(['.DS_Store'])

async function walk(directory, out) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      await walk(join(directory, entry.name), out)
      continue
    }
    if (!entry.isFile()) continue
    if (SKIPPED_FILES.has(entry.name)) continue
    out.push(join(directory, entry.name))
  }
  return out
}

/** Every build input, as repository-relative paths, sorted so the order is not a variable. */
export async function buildInputPaths(root = ROOT) {
  const absolute = await walk(join(root, APP), [])
  const paths = absolute.map((path) => relative(root, path))
  for (const external of EXTERNAL_INPUTS) {
    // A declared input is not optional: its disappearance is a changed build,
    // and it is recorded as such rather than quietly dropped from the hash.
    const exists = await stat(join(root, external)).then(
      (info) => info.isFile(),
      () => false,
    )
    paths.push(exists ? external : `${external} (missing)`)
  }
  return paths.sort()
}

async function hashFile(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

/**
 * The per-file hashes and the digest over them.
 *
 * The per-file map is kept, not only the total, so a mismatch can name the file
 * that moved. "The bundle is stale" is an instruction to rebuild;
 * "apps/cockpit/src/lib/i18n.ts changed since the build" is an explanation, and
 * the difference is whether anybody learns anything from a red run.
 */
export async function computeStamp(root = ROOT) {
  const paths = await buildInputPaths(root)
  /** @type {Record<string, string>} */
  const files = {}
  for (const path of paths) {
    files[path] = path.endsWith(' (missing)') ? 'missing' : await hashFile(join(root, path))
  }
  const digest = createHash('sha256')
  // Path and hash both, and the path first: swapping two files' names would
  // otherwise leave the total unchanged.
  for (const path of paths) digest.update(`${path.split(sep).join('/')} ${files[path]}\n`)
  return { algorithm: 'sha256', inputs: paths.length, digest: `sha256-${digest.digest('hex')}`, files }
}

/** Named differences between a recorded stamp and the tree as it stands now. */
export function diffStamps(recorded, current) {
  const changed = []
  const added = []
  const removed = []
  for (const [path, hash] of Object.entries(current.files)) {
    if (!(path in recorded.files)) added.push(path)
    else if (recorded.files[path] !== hash) changed.push(path)
  }
  for (const path of Object.keys(recorded.files)) if (!(path in current.files)) removed.push(path)
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() }
}

/**
 * Reads the stamp the build wrote, or explains in one sentence why there is none.
 * Returns `{ stamp }` or `{ problem }` — never a throw, because the caller turns
 * both into the same red with different words.
 */
export async function readStamp(root = ROOT) {
  let raw
  try {
    raw = await readFile(join(root, STAMP_PATH), 'utf8')
  } catch {
    return {
      problem:
        `${STAMP_PATH} is missing, so nothing here can say what assets/cockpit was built from. ` +
        'It is written by `npm run build` in apps/cockpit, which every path to a bundle goes through. ' +
        'Build it: npm run cockpit:build',
    }
  }
  let stamp
  try {
    stamp = JSON.parse(raw)
  } catch (error) {
    return {
      problem:
        `${STAMP_PATH} is not readable JSON (${error instanceof Error ? error.message : String(error)}). ` +
        'Build it: npm run cockpit:build',
    }
  }
  if (typeof stamp?.digest !== 'string' || typeof stamp?.files !== 'object' || stamp.files === null) {
    return { problem: `${STAMP_PATH} carries no digest and no file list. Build it: npm run cockpit:build` }
  }
  return { stamp }
}

/**
 * Whether `assets/cockpit` was built from the sources as they stand.
 *
 * Returns null when it was, and the sentence to fail with when it was not.
 */
export async function bundleStaleReason(root = ROOT) {
  const { stamp, problem } = await readStamp(root)
  if (problem) return problem
  const current = await computeStamp(root)
  if (current.digest === stamp.digest) return null

  const { changed, added, removed } = diffStamps(stamp, current)
  const named = [
    ...changed.map((path) => `changed: ${path}`),
    ...added.map((path) => `added: ${path}`),
    ...removed.map((path) => `removed: ${path}`),
  ]
  // Enough to recognise the edit, not so much that the report becomes a diff.
  const shown = named.slice(0, 8)
  const rest = named.length - shown.length
  return (
    'assets/cockpit was built from different sources than the ones on disk. ' +
    `Built from ${stamp.inputs} input(s) (${stamp.digest}${stamp.builtAt ? `, ${stamp.builtAt}` : ''}); ` +
    `${current.inputs} input(s) now hash to ${current.digest}. ` +
    `${named.length} difference(s): ${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}. ` +
    'Every rule but 15 is read off the built console, so this run would report on a bundle that is not ' +
    'the source. Build it: npm run cockpit:build'
  )
}

/** Writes the stamp beside the bundle it describes. Called at the end of apps/cockpit's `build`. */
export async function writeStamp(root = ROOT) {
  const stamp = await computeStamp(root)
  const record = { ...stamp, builtAt: new Date().toISOString() }
  await writeFile(join(root, STAMP_PATH), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return record
}

// CLI. `--write` is what apps/cockpit's `build` script runs; `--time` is how the
// cost claim in this file's header is measured rather than asserted.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const started = Date.now()
  if (process.argv.includes('--time')) {
    const stamp = await computeStamp()
    process.stdout.write(`${stamp.inputs} input(s), ${stamp.digest}, ${((Date.now() - started) / 1000).toFixed(3)}s\n`)
  } else {
    const record = await writeStamp()
    process.stdout.write(
      `wrote ${STAMP_PATH}: ${record.inputs} build input(s), ${record.digest} (${((Date.now() - started) / 1000).toFixed(3)}s)\n`,
    )
  }
}
