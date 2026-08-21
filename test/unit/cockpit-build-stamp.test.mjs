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
 * A hand-written list of six paths and a `/\bvite build\b/` regex are the same
 * mistake twice — modelling commands as prose. Both halves are kept because
 * running them over one corpus, rather than reasoning about them, is what
 * settled it: 50 mutations, one unstamped build each; the text version caught
 * 44, the command version 21, and 25 of the 26 it gave up were real (quoting,
 * grouping punctuation, shell wrappers, substitutions). Together: 50 of 50, and
 * the one legitimate spelling stays green. The corpus is the two tests above.
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

/**
 * A shell string, cut into the commands it actually runs.
 *
 * The obvious `split(/&&|\|\||;|\n/)` loses four spellings, each one a
 * regression against the text version in f6e0f81: it cuts inside quotes; it
 * leaves grouping punctuation attached, and `(cd "$APP" && npm run build)` is
 * the HOUSE spelling in scripts/build-cockpit.sh:27; it stops at a shell handed
 * a script (`bash -lc 'vite build'`); and it stops at a command substitution.
 * So quoting is respected, grouping punctuation is opened, and anything that is
 * itself a script is asked the same question again.
 */
function splitOutsideQuotes(text) {
  const parts = []
  let current = ''
  let quote = null
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quote) {
      current += character
      if (character === quote && text[index - 1] !== '\\') quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }
    if (character === '\n' || character === ';') {
      parts.push(current)
      current = ''
      continue
    }
    if (character === '&' && text[index + 1] === '&') {
      parts.push(current)
      current = ''
      index += 1
      continue
    }
    if (character === '|') {
      if (text[index + 1] === '|') index += 1
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  parts.push(current)
  return parts
}

/** The shells that take a script as an argument, and the flag that says so. */
const SHELL_WRAPPER = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:env\s+)?(?:\S*[/\\])?(?:sh|bash|zsh|dash|ash|ksh)\s+/

/**
 * The script a shell wrapper was handed, or `null` if this is not one.
 *
 * `-c`, `-lc`, `-ec`, `-eu -c`: the flag that matters is the one carrying a
 * `c`, and it can be bundled with any others. What comes after it is a script,
 * quoted or not, and the caller asks the whole question about it again.
 */
function shellWrapperBody(command) {
  const head = SHELL_WRAPPER.exec(command)
  if (!head) return null
  let rest = command.slice(head[0].length).trim()
  let carriesC = false
  while (rest.startsWith('-')) {
    const end = rest.search(/\s/)
    const flag = end === -1 ? rest : rest.slice(0, end)
    if (flag.includes('c')) carriesC = true
    rest = end === -1 ? '' : rest.slice(end).trim()
  }
  if (!carriesC || !rest) return null
  const quoted = /^(['"])([\s\S]*?)\1/.exec(rest)
  return quoted ? quoted[2] : rest
}

/** Every command in a shell string, cut at the operators that end one. */
function commands(text, depth = 0) {
  // A backslash before a newline is not two commands, it is one written over
  // two lines. Neither the text version nor the first command version saw a
  // build spelled that way.
  const joined = String(text).replace(/\\\r?\n[ \t]*/g, ' ')
  const found = []
  for (const raw of splitOutsideQuotes(joined)) {
    let part = raw
    // Substitutions first, innermost outwards, and BEFORE the grouping strip —
    // otherwise the strip eats the closing parenthesis of `echo $(vite build)`
    // and there is nothing left to recognise.
    for (let round = 0; round < 4; round += 1) {
      const substitutions = [...part.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)]
      if (substitutions.length === 0) break
      for (const match of substitutions) {
        const inner = (match[1] ?? match[2]).trim()
        if (inner && depth < 4) found.push(...commands(inner, depth + 1))
        part = part.replace(match[0], ' ')
      }
    }
    part = part
      .replace(/^[({\s]+/, '')
      .replace(/[)}\s]+$/, '')
      .trim()
    if (!part) continue
    const body = shellWrapperBody(part)
    if (body !== null && depth < 4) {
      found.push(...commands(body, depth + 1))
      continue
    }
    found.push(part)
  }
  return found
}

/**
 * Whether one command invokes Vite with `build` anywhere in its ARGUMENTS.
 *
 * Not the word pair "vite build". `npx vite --mode production build` is a vite
 * build; `vite preview` and `vitest run` are not; `node_modules/.bin/vite
 * build` is. The question a guard has to ask is what the process does, not what
 * the text looks like.
 *
 * Punctuation is stripped off a token before it is compared. `commands()` above
 * already opens the groupings it knows, and this is the second line of defence
 * for the spelling it does not: `(vite` has to be `vite` and `build)` has to be
 * `build`, or the guard is back to reading prose.
 */
function isViteBuild(command) {
  const tokens = command
    .split(/\s+/)
    .map((token) => token.replace(/^[('"`{]+/, '').replace(/[)'"`};,]+$/, ''))
    .filter(Boolean)
  const vite = tokens.findIndex((token) => token === 'vite' || /[/\\]vite$/.test(token))
  if (vite === -1) return false
  return tokens.slice(vite + 1).includes('build')
}

/** Every string a JSON document carries, at any depth. */
function stringsIn(value, into = []) {
  if (typeof value === 'string') into.push(value)
  else if (Array.isArray(value)) for (const entry of value) stringsIn(entry, into)
  else if (value && typeof value === 'object') for (const entry of Object.values(value)) stringsIn(entry, into)
  return into
}

/**
 * The command strings a file carries.
 *
 * Wider than "the places a command is supposed to be", and that is the point:
 * the text version this replaced read every LINE of six files, and reading only
 * `scripts` and only `run:` silently gave that reach back. Measured on a corpus,
 * four classes went missing — `lint-staged` and `husky` entries in a
 * package.json, a `with: args:` handed to a container action, a `BUILD_CMD:`
 * in `env:` that a `run:` then expands, and a commented-out step. Only the last
 * of those runs nothing today, and a commented-out build is one keystroke from
 * running.
 *
 * So a package.json contributes every string it holds, and a workflow is read
 * TWICE: as raw text, which is what gives back the reach above, and as a parsed
 * tree, which resolves anchors and block scalars that text alone would tear at
 * the wrong place. Whichever sees it first, the same command model judges it.
 */
function commandsInSource(file, source) {
  if (file.endsWith('package.json')) return stringsIn(JSON.parse(source))
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
  return [source, ...runs]
}

async function commandsIn(file) {
  return commandsInSource(file, await readFile(join(root, file), 'utf8'))
}

/** Does this text, read as shell, carry an unstamped Vite build? */
function carriesViteBuild(chain) {
  return commands(chain).some(isViteBuild)
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
    // Punctuation, at the token level: `commands()` normally takes these apart
    // first, and this is the half of the defence that does not depend on it.
    '(vite build)',
    '(cd apps/cockpit && npx vite build)'.split('&&')[1],
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
    '(npm run build)',
  ]) {
    assert.equal(isViteBuild(command), false, command)
  }

  // And the whole pipeline, because the six spellings that got past this file
  // after 39acb3d all got past `commands()`, not `isViteBuild()`. The verifier
  // found four; a corpus over the same class found these.
  for (const chain of [
    '(cd apps/cockpit && npx vite build)',
    '(vite build)',
    '{ vite build; }',
    'sh -c "npx vite build"',
    "bash -lc 'vite build'",
    'sh -c "vite build; echo done"',
    '/bin/sh -ec "cd apps/cockpit && vite build"',
    'echo `vite build`',
    'echo $(vite build)',
    'npx vite \\\n  build',
    'env NODE_ENV=production vite build',
    'time vite build',
    'npx vite build > /dev/null',
  ]) {
    assert.equal(carriesViteBuild(chain), true, chain)
  }
  for (const chain of [
    'npm run build',
    '(cd apps/cockpit && npm run build)',
    'sh -c "npm run build"',
    'echo $(vitest run)',
    'echo "vite preview"',
  ]) {
    assert.equal(carriesViteBuild(chain), false, chain)
  }

  // And the splitting, because a chain is where the writer has to come after.
  assert.deepEqual(commands('a && b || c ; d\ne | f'), ['a', 'b', 'c', 'd', 'e', 'f'])
  assert.deepEqual(commands('(cd apps/cockpit && vite build)'), ['cd apps/cockpit', 'vite build'])
  assert.deepEqual(commands('sh -c "a; b"'), ['a', 'b'])
  // The writer still has to be SEEN as coming afterwards once the wrapper and
  // the parenthesis are gone — an unwrap that loses the order would turn every
  // one of the rows above into a false red.
  const stamped = commands('(cd apps/cockpit && vite build && node ../../scripts/cockpit-build-stamp.mjs)')
  const at = stamped.findIndex(isViteBuild)
  assert.ok(at >= 0 && stamped.slice(at + 1).some((command) => /cockpit-build-stamp\.mjs/.test(command)))
})

test('a build is found wherever a file can carry one, not only where one is expected', () => {
  const carries = (file, source) => commandsInSource(file, source).some(carriesViteBuild)

  // npm scripts are not the only strings in a package.json that get executed.
  assert.equal(
    carries('package.json', JSON.stringify({ scripts: { build: 'tsc' }, 'lint-staged': { '*.ts': 'vite build' } })),
    true,
  )
  // `run:` is not the only place a workflow names a command.
  assert.equal(
    carries(
      '.github/workflows/x.yml',
      'jobs:\n  a:\n    steps:\n      - uses: docker://node:22\n        with:\n          args: vite build\n',
    ),
    true,
  )
  assert.equal(
    carries(
      '.github/workflows/x.yml',
      'jobs:\n  a:\n    env:\n      BUILD_CMD: vite build\n    steps:\n      - run: $BUILD_CMD\n',
    ),
    true,
  )
  assert.equal(carries('.github/workflows/x.yml', 'jobs:\n  a:\n    steps:\n      # - run: vite build\n'), true)
  // …and a `run:` still arrives through the parsed tree.
  assert.equal(
    carries('.github/workflows/x.yml', 'jobs:\n  a:\n    steps:\n      - run: |\n          npx vite build\n'),
    true,
  )
  // A file that names no build stays quiet, or the guard is a permanent red.
  assert.equal(carries('.github/workflows/x.yml', 'jobs:\n  a:\n    steps:\n      - run: npm run build\n'), false)
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
  //
  // Deduplicated by file AND command, because a workflow is now read as text
  // and as a parsed tree: one `run: vite build` would otherwise arrive twice
  // and this list would report two paths where there is one. Two DIFFERENT
  // builds in one file still count as two — the pair is the key, not the file.
  const distinct = [...new Map(builds.map((entry) => [`${entry.file}\u0000${entry.command}`, entry])).values()]
  assert.deepEqual(
    distinct.map((entry) => entry.file),
    ['apps/cockpit/package.json'],
    `Vite builds found at: ${distinct.map((entry) => `${entry.file} (${entry.command})`).join(', ') || 'nowhere — the scan is broken'}`,
  )
})
