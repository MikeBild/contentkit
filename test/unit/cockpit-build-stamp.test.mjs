/**
 * The Cockpit bundle's content stamp, and the two questions it cannot answer
 * for itself.
 *
 * scripts/cockpit-build-stamp.mjs hashes the build inputs, `npm run build` in
 * apps/cockpit writes the hash beside the bundle, and scripts/konvention-check
 * .mjs refuses to certify a bundle whose inputs no longer hash to it. That is
 * only worth something while two things stay true, and neither is true by
 * construction:
 *
 *   1. EVERY path that produces a bundle writes a stamp. A path that does not
 *      leaves the previous one standing, which is safe but stale — and a second
 *      `vite build` invocation somewhere in the repository is a path nobody
 *      thought about, so this file requires every one of them to be the one
 *      that appends the stamp writer.
 *   2. The input list is COMPLETE. Files under apps/cockpit are found by
 *      walking; files outside it are found by somebody having thought of them.
 *      Two are declared today — contract/cockpit-ui.css and assets/site.css —
 *      and the honest question is the one the verifier asked: which build input
 *      could join tomorrow without anybody noticing? The answer is "a new file
 *      in the app that reads from disk while the build runs", so that is what
 *      this file enumerates: every build-time reader must declare what it
 *      reads, and the union of those declarations must be exactly what the
 *      stamp hashes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildInputPaths,
  computeStamp,
  diffStamps,
  EXTERNAL_INPUTS,
  STAMP_PATH,
} from '../../scripts/cockpit-build-stamp.mjs'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/**
 * Every file in apps/cockpit that reads from disk while the build runs, and the
 * repository-relative inputs it reads from OUTSIDE apps/cockpit.
 *
 * Reviewed by hand, held by the test below. Adding a build-time reader means
 * adding a row here, and adding a row that names a file outside the app means
 * adding it to EXTERNAL_INPUTS too — which is the point: the moment the build
 * grows an input, the growth is a red test rather than a silent one.
 *
 * The scan covers the whole tree the stamp walks, `src/**` included. Excluding
 * it would be cheap and wrong: "those files run in the browser" is a claim
 * about a directory, and the thing being guarded against is precisely a file
 * turning up where nobody expected one.
 */
const BUILD_TIME_READERS = {
  // contractMeta() hashes contract/cockpit-ui.css into <meta name="cockpit-ui-digest">.
  'vite.config.ts': ['contract/cockpit-ui.css'],
  // gen:css derives src/content/site.scoped.css from the published stylesheet.
  'scripts/scope-site-css.mjs': ['assets/site.css'],
  // Not a build-time reader — it globs the app's own catalogue files while
  // vitest runs. Listed rather than excluded, because the scan now covers the
  // whole stamped tree and an exclusion for `src` would be the second list with
  // the second reach that this file exists to avoid. It reads nothing outside
  // the app, so it contributes nothing to EXTERNAL_INPUTS.
  'src/lib/i18n.test.ts': [],
}

/**
 * The files the scan looks at: EXACTLY the ones the stamp walks, filtered to code.
 *
 * Derived from buildInputPaths() rather than from a second list of directories.
 * The first version enumerated `apps/cockpit/*.{ts,mjs,js,cjs}` plus
 * `apps/cockpit/scripts/**` — a shape, not a reach — and a build-time reader
 * dropped into `apps/cockpit/plugins/probe.ts` left it green at 7 of 7. A test
 * that claims to answer "which build input could join tomorrow without anybody
 * noticing" and answers it for one directory layout is a false green about
 * false greens. Two lists with two reaches were the defect; there is one now,
 * and it is the one the hash uses.
 */
async function buildTimeFiles() {
  const paths = await buildInputPaths(root)
  return paths
    .map((path) => path.split('\\').join('/'))
    .filter((path) => path.startsWith('apps/cockpit/') && /\.(ts|tsx|mjs|js|cjs)$/.test(path))
    .map((path) => path.slice('apps/cockpit/'.length))
}

test('every build-time reader in apps/cockpit declares what it reads', async () => {
  const files = await buildTimeFiles()
  // A scan that silently matched nothing would make every assertion here
  // vacuously true — the failure mode this whole mechanism exists against.
  assert.ok(files.length >= 100, `expected the app's code files to be findable, found ${files.length}`)

  const readers = []
  for (const path of files) {
    const source = await readFile(join(root, 'apps', 'cockpit', path), 'utf8')
    if (/\breadFileSync\s*\(|\breadFile\s*\(|\bcreateReadStream\s*\(/.test(source)) readers.push(path)
  }

  assert.deepEqual(
    readers.sort(),
    Object.keys(BUILD_TIME_READERS).sort(),
    'a file in apps/cockpit reads from disk at build time without declaring it. Add it to BUILD_TIME_READERS ' +
      'with the inputs it reads, and add any input outside apps/cockpit to EXTERNAL_INPUTS in ' +
      'scripts/cockpit-build-stamp.mjs — otherwise the Konvention-Check will certify a bundle built from a file ' +
      'it never hashed.',
  )
})

test('the declared external inputs are exactly the ones the stamp hashes', () => {
  const declared = [...new Set(Object.values(BUILD_TIME_READERS).flat())].sort()
  const hashed = EXTERNAL_INPUTS.map((path) => path.split('\\').join('/')).sort()
  assert.deepEqual(
    hashed,
    declared,
    'EXTERNAL_INPUTS and the readers that need them have drifted apart — one of them is hashing a file nobody ' +
      'reads, or reading a file nobody hashes',
  )
})

test('the stamp hashes the whole app, dotted entries included, and nothing it must not', async () => {
  const paths = (await buildInputPaths(root)).map((path) => path.split('\\').join('/'))
  assert.ok(paths.length > 100, `expected the app walk to find its sources, found ${paths.length}`)

  // The three inputs the mtime guard this replaced could not see.
  assert.ok(paths.includes('contract/cockpit-ui.css'), 'the family contract file is a build input')
  assert.ok(paths.includes('assets/site.css'), 'the published stylesheet gen:css derives from is a build input')
  assert.ok(
    paths.includes('apps/cockpit/.gitignore'),
    'dotted entries are hashed — .env.production is skipped by the same rule that would skip this one, and Vite ' +
      'bakes its VITE_* values into the bundle',
  )
  // The pieces that are outputs, caches or dependency trees rather than sources.
  for (const forbidden of ['node_modules', '/dist/', '/.vite/', '.DS_Store']) {
    assert.equal(
      paths.filter((path) => path.includes(forbidden)).length,
      0,
      `${forbidden} is not a build input and would make every bundle stale the moment it was made`,
    )
  }
  // The bundle itself is the output; hashing it would be circular.
  assert.equal(paths.filter((path) => path.startsWith('assets/cockpit/')).length, 0)
})

test('the digest moves when any build input moves — dotfile or file outside the app', async () => {
  // Built in a temporary tree rather than by editing the repository: this
  // assertion is about the mechanism, and a test that mutates real sources to
  // prove a point is one crash away from leaving them mutated.
  const tree = await mkdtemp(join(tmpdir(), 'ck-stamp-'))
  const write = async (relativePath, content) => {
    const path = join(tree, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
  try {
    await write(join('apps', 'cockpit', 'src', 'main.tsx'), 'export const app = 1\n')
    // The two entries the mtime guard skipped by name, and the one it never saw.
    await write(join('apps', 'cockpit', '.env.production'), 'VITE_PUBLIC_ORIGIN=https://example.test\n')
    await write(join('apps', 'cockpit', 'node_modules', 'react', 'index.js'), 'noise\n')
    await write(join('apps', 'cockpit', '.vite', 'deps', 'cache.json'), '{}\n')
    await write(join('contract', 'cockpit-ui.css'), ':root { --ck: 1; }\n')
    await write(join('assets', 'site.css'), 'body { margin: 0; }\n')

    const base = await computeStamp(tree)
    assert.deepEqual(
      Object.keys(base.files)
        .map((path) => path.split('\\').join('/'))
        .sort(),
      ['apps/cockpit/.env.production', 'apps/cockpit/src/main.tsx', 'assets/site.css', 'contract/cockpit-ui.css'],
    )

    for (const [path, changed] of [
      [join('apps', 'cockpit', 'src', 'main.tsx'), 'export const app = 2\n'],
      [join('apps', 'cockpit', '.env.production'), 'VITE_PUBLIC_ORIGIN=https://elsewhere.test\n'],
      [join('contract', 'cockpit-ui.css'), ':root { --ck: 2; }\n'],
      [join('assets', 'site.css'), 'body { margin: 1px; }\n'],
    ]) {
      const before = await readFile(join(tree, path), 'utf8')
      await write(path, changed)
      // The mtime guard answered "fresh" for exactly this: content ahead of the
      // bundle, timestamp behind it. A hash cannot be told that story.
      await utimes(join(tree, path), new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))
      const after = await computeStamp(tree)
      assert.notEqual(after.digest, base.digest, `${path} is a build input and must move the digest`)
      assert.deepEqual(
        diffStamps(base, after).changed.map((entry) => entry.split('\\').join('/')),
        [path.split('\\').join('/')],
      )
      await write(path, before)
    }

    assert.equal((await computeStamp(tree)).digest, base.digest, 'identical content must hash identically')

    // And the pieces that must NOT move it, or every bundle would be stale the
    // moment the build that produced it wrote its own cache.
    await write(join('apps', 'cockpit', 'node_modules', 'react', 'index.js'), 'different noise\n')
    await write(join('apps', 'cockpit', '.vite', 'deps', 'cache.json'), '{"a":1}\n')
    await write(join('apps', 'cockpit', '.DS_Store'), 'finder\n')
    assert.equal(
      (await computeStamp(tree)).digest,
      base.digest,
      'caches, outputs and the dependency tree are not inputs',
    )
  } finally {
    await rm(tree, { recursive: true, force: true })
  }
})

test('a declared input that disappears is a changed build, not a smaller one', async () => {
  const tree = await mkdtemp(join(tmpdir(), 'ck-stamp-'))
  try {
    await mkdir(join(tree, 'apps', 'cockpit'), { recursive: true })
    await writeFile(join(tree, 'apps', 'cockpit', 'index.html'), '<!doctype html>\n', 'utf8')
    await mkdir(join(tree, 'contract'), { recursive: true })
    await writeFile(join(tree, 'contract', 'cockpit-ui.css'), ':root{}\n', 'utf8')

    const stamp = await computeStamp(tree)
    // assets/site.css was never created here. Silently dropping it would let a
    // build input vanish without the digest noticing; it is recorded instead.
    assert.equal(stamp.files['assets/site.css (missing)'], 'missing')
    assert.equal(stamp.inputs, 3)
  } finally {
    await rm(tree, { recursive: true, force: true })
  }
})

test('the stamp is written beside the served bundle, never inside it', () => {
  // assets/cockpit is served unauthenticated at /cockpit/ (src/cockpit.mjs says
  // so, and gives the reason: the bundle carries no data). The stamp does carry
  // data — every source path in the console and a hash of each — so inside the
  // output directory it would be one unauthenticated GET away, and the day an
  // .env.production exists that is a hash of secrets on the public internet.
  //
  // What keeps it out of reach is cleanPath() in src/utils.mjs (src/routes.mjs
  // :1233), which rejects a `..` segment with 400 before routing — not the
  // prefix check in serveCockpit(), which answered /cockpit/../cockpit-build-
  // stamp.json with 200 and 21769 bytes until it was tied to a path boundary.
  // test/unit/cockpit.test.mjs holds that boundary now. Being one directory out
  // is what makes the file unaddressable; the rest is defence in depth.
  const path = STAMP_PATH.split('\\').join('/')
  assert.equal(path.startsWith('assets/cockpit/'), false, `${path} is inside the directory serveCockpit() hands out`)
  assert.ok(path.startsWith('assets/'), "it still travels with the bundle in build-binary.sh's `assets` tar entry")
})

/**
 * Everything in the repository that could invoke a build, found rather than
 * typed.
 *
 * The first version listed six paths by hand. Three ways past it, all green: a
 * new `.github/workflows/nightly.yml`, an `npx vite build` appended to
 * scripts/test-e2e-local.sh, and — inside a file that WAS on the list —
 * `npx vite --mode production build`, because a flag between the two words
 * tears `/\bvite build\b/` apart. A hand-written list of files and a regex over
 * a word sequence are the same mistake twice: modelling commands as prose.
 */
async function commandSources() {
  const skipped = new Set(['node_modules', '.git', 'dist', '.vite', 'coverage'])
  const found = []
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (skipped.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        // The built bundle and the generated gallery hold no commands and are
        // large enough to be worth not reading.
        if (path === join(root, 'assets', 'cockpit')) continue
        if (path === join(root, 'examples', 'pattern-gallery')) continue
        await walk(path)
        continue
      }
      if (!entry.isFile()) continue
      const relativePath = relative(root, path).split('\\').join('/')
      if (entry.name === 'package.json') found.push(relativePath)
      else if (entry.name.endsWith('.sh')) found.push(relativePath)
      else if (relativePath.startsWith('.github/') && /\.ya?ml$/.test(entry.name)) found.push(relativePath)
    }
  }
  await walk(root)
  return found.sort()
}

/** Every command in a shell string, cut at the operators that end one. */
function commands(text) {
  return String(text)
    .split(/\n|&&|\|\||;|\|/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Whether one command invokes Vite with `build` anywhere in its ARGUMENTS.
 *
 * Not the word pair "vite build". `npx vite --mode production build` is a vite
 * build; `vite preview` and `vitest run` are not; `node_modules/.bin/vite
 * build` is. The question a guard has to ask is what the process does, not what
 * the text looks like.
 */
function isViteBuild(command) {
  const tokens = command.split(/\s+/).filter(Boolean)
  const vite = tokens.findIndex((token) => token === 'vite' || /[/\\]vite$/.test(token))
  if (vite === -1) return false
  return tokens.slice(vite + 1).includes('build')
}

/** The command strings a file carries: script bodies, workflow `run:` steps, shell lines. */
async function commandsIn(file) {
  const source = await readFile(join(root, file), 'utf8')
  if (file.endsWith('package.json')) return Object.values(JSON.parse(source).scripts ?? {})
  if (file.endsWith('.sh')) return [source]
  // Collected wherever `run:` stands, at any depth: a step, a composite action,
  // a `defaults` block or a shape GitHub has not invented yet.
  const runs = []
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (key === 'run' && typeof value === 'string') runs.push(value)
      else visit(value)
    }
  }
  visit(parse(source))
  return runs
}

test('the command model recognises a Vite build by what it does, not by how it reads', () => {
  // The table is the specification. Every left-hand entry once passed the old
  // word-sequence regex or would have been missed by it; the point of writing
  // them down is that the next person changing this function has to keep them.
  for (const command of [
    'vite build',
    'npx vite build',
    'npx vite --mode production build',
    'npx --yes vite --config vite.config.ts build',
    'node_modules/.bin/vite build',
    'bunx --bun vite build',
  ]) {
    assert.equal(isViteBuild(command), true, command)
  }
  for (const command of [
    'vite preview',
    'vite',
    'vitest run',
    'npm run build',
    'npm --prefix apps/cockpit run build',
    'node ../../scripts/cockpit-build-stamp.mjs',
    'echo build',
  ]) {
    assert.equal(isViteBuild(command), false, command)
  }

  // And the splitting, because a chain is where the writer has to come after.
  assert.deepEqual(commands('a && b || c ; d\ne | f'), ['a', 'b', 'c', 'd', 'e', 'f'])
})

test('every path that builds the bundle writes the stamp', async () => {
  const WRITER = /cockpit-build-stamp\.mjs/
  const sources = await commandSources()
  // Both a null-match guard and a statement of reach: if the walk broke, or the
  // parser returned nothing, the loop below would sweep an empty repository and
  // pass.
  assert.ok(sources.length >= 8, `expected to find the repository's command files, found ${sources.length}`)

  const builds = []
  for (const file of sources) {
    for (const chain of await commandsIn(file)) {
      const list = commands(chain)
      const index = list.findIndex(isViteBuild)
      if (index === -1) continue
      builds.push({ file, command: list[index] })
      assert.ok(
        list.slice(index + 1).some((command) => WRITER.test(command)),
        `${file} invokes Vite with \`build\` and does not run the stamp writer afterwards: \`${list[index]}\`. ` +
          'A bundle produced this way cannot say what it was built from, and the Konvention-Check would either ' +
          'refuse it or measure it against the previous build.',
      )
    }
  }

  // Exactly one path, and it is the one this file's header describes. A second
  // would not be wrong by itself — it would have to be understood first.
  assert.deepEqual(
    builds.map((entry) => entry.file),
    ['apps/cockpit/package.json'],
    `Vite builds found at: ${builds.map((entry) => `${entry.file} (${entry.command})`).join(', ') || 'nowhere — the scan is broken'}`,
  )
})
