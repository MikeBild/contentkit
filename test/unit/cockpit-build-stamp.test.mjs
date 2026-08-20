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
 * `src/**` is deliberately not scanned. Those files run in the browser; a
 * `readFile` there is the console reading a user's upload, not the build
 * reading a source.
 */
const BUILD_TIME_READERS = {
  // contractMeta() hashes contract/cockpit-ui.css into <meta name="cockpit-ui-digest">.
  'vite.config.ts': ['contract/cockpit-ui.css'],
  // gen:css derives src/content/site.scoped.css from the published stylesheet.
  'scripts/scope-site-css.mjs': ['assets/site.css'],
}

/** The files the scan looks at: the app's own configuration and its build scripts. */
async function buildTimeFiles() {
  const app = join(root, 'apps', 'cockpit')
  const found = []
  for (const entry of await readdir(app, { withFileTypes: true })) {
    if (entry.isFile() && /\.(ts|mjs|js|cjs)$/.test(entry.name)) found.push(join(app, entry.name))
  }
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && /\.(ts|mjs|js|cjs)$/.test(entry.name)) found.push(path)
    }
  }
  await walk(join(app, 'scripts'))
  return found
}

test('every build-time reader in apps/cockpit declares what it reads', async () => {
  const files = await buildTimeFiles()
  // A scan that silently matched nothing would make every assertion here
  // vacuously true — the failure mode this whole mechanism exists against.
  assert.ok(files.length >= 3, `expected the app's build-time files to be findable, found ${files.length}`)

  const readers = []
  for (const path of files) {
    const source = await readFile(path, 'utf8')
    if (/\breadFileSync\s*\(|\breadFile\s*\(|\bcreateReadStream\s*\(/.test(source)) {
      readers.push(
        relative(join(root, 'apps', 'cockpit'), path)
          .split('\\')
          .join('/'),
      )
    }
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
  const path = STAMP_PATH.split('\\').join('/')
  assert.equal(path.startsWith('assets/cockpit/'), false, `${path} is inside the directory serveCockpit() hands out`)
  assert.ok(path.startsWith('assets/'), "it still travels with the bundle in build-binary.sh's `assets` tar entry")
})

test('every path that builds the bundle writes the stamp', async () => {
  const cockpitPackage = JSON.parse(await readFile(join(root, 'apps', 'cockpit', 'package.json'), 'utf8'))
  const WRITER = 'node ../../scripts/cockpit-build-stamp.mjs'
  assert.ok(
    cockpitPackage.scripts.build.includes(`vite build && ${WRITER}`),
    `apps/cockpit's build script must end in ${WRITER}, or the bundle it produces cannot say what it was built from`,
  )

  // Every other `vite build` in the repository would be a second path. There is
  // none today; if one appears it has to end the same way, and this is where
  // that gets noticed rather than in a green run over the wrong bytes.
  const searched = [
    'package.json',
    'apps/cockpit/package.json',
    'build-binary.sh',
    'scripts/build-cockpit.sh',
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
  ]
  for (const file of searched) {
    const source = await readFile(join(root, file), 'utf8')
    for (const line of source.split('\n')) {
      if (!/\bvite build\b/.test(line)) continue
      assert.ok(
        line.includes(WRITER),
        `${file} invokes \`vite build\` without appending the stamp writer: ${line.trim()}`,
      )
    }
  }
})
