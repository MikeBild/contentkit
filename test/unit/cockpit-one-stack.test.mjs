import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * One component stack, and nothing importing a module that is gone.
 *
 * The shadcn migration spent a phase in the state an adversarial review called
 * the one not to ship: shadcn/ui installed and passing, and the hand-rolled
 * `components/ui/primitives.tsx` still load-bearing under forty modules. Three
 * files imported both and aliased around the name collision — `Button as
 * UiButton` — so two visually different buttons rendered on one screen, and the
 * new stack had grown a dependency back onto the old one (`ui/skeleton.tsx`
 * imported `TD`/`TR` from primitives). Nothing in the suite could see any of it:
 * every test named the file it was about, and "which stack is this" is a
 * property of the whole tree.
 *
 * So this file asks the tree three questions instead:
 *
 *  1. does every import inside apps/cockpit/src resolve to a file that exists —
 *     a deleted module is caught by whoever still imports it, not by remembering
 *     to grep for its name;
 *  2. is each component name imported from exactly one module, everywhere — two
 *     `Button`s is the defect, whatever the second one is called;
 *  3. and does the console still hand-roll what a component now does — a
 *     `space-y-*` where a `gap-*` belongs, an `animate-pulse` where `Skeleton`
 *     belongs.
 *
 * Only committed source under apps/cockpit/src is read: `.ts` and `.tsx`, plus
 * the stylesheet the components are described in. Nothing here touches
 * src/content/site.scoped.css or assets/cockpit/*, which are generated. Node
 * reads none of it as a module — every check is over text — so this runs
 * identically on Node 20 and Node 22.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const rel = (path) => relative(cockpit, path).split(sep).join('/')

/**
 * Generated files that sit inside apps/cockpit/src but are not source.
 *
 * `content/site.scoped.css` is written by apps/cockpit/scripts/scope-site-css.mjs
 * on every build and is gitignored, so a walk of the tree finds it on a machine
 * that has built the console and finds nothing on a clean checkout — the suite
 * would then be reading a different set of files in CI than it reads here. A
 * rule about how this console is written has no business over a file this
 * console did not write.
 */
const GENERATED = new Set(['content/site.scoped.css'])

function walk(dir, match) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path, match))
    else if (match.test(entry.name) && !GENERATED.has(rel(path))) out.push(path)
  }
  return out
}

const sources = walk(cockpit, /\.tsx?$/).map((path) => ({ id: rel(path), path, src: readFileSync(path, 'utf8') }))
const styles = walk(cockpit, /\.css$/).map((path) => ({ id: rel(path), path, src: readFileSync(path, 'utf8') }))

// The walk is the only thing that decides what this file reads, so it is worth
// one assertion rather than a comment: a generated stylesheet reaching `styles`
// is how the suite starts depending on whether the console has been built.
assert.deepEqual(
  styles.filter((file) => GENERATED.has(file.id)).map((file) => file.id),
  [],
  'a generated file reached the read set; it is absent on a clean checkout and the suite would not agree with CI',
)

/**
 * What a specifier points at, the way the bundler resolves it.
 *
 * `@/` is the alias vite and tsconfig both give apps/cockpit/src. A bare
 * specifier is a package and not this tree's business, so it answers `null`;
 * a local specifier that matches no file answers `undefined`, which is the
 * failure the first test is looking for.
 */
function resolveImport(from, specifier) {
  const base = specifier.startsWith('@/')
    ? join(cockpit, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null
  if (base === null) return null
  for (const candidate of [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.d.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ])
    if (existsSync(candidate)) return candidate
  return undefined
}

/**
 * Every named import in the tree, as `{ file, specifier, target, name, alias }`.
 *
 * Type-only imports are dropped — both the `import type {…}` form and an inline
 * `{ type Choice }`. A type and a component may legitimately share a name in two
 * modules (`ReleaseChain` is the derived state in lib/ and the component in
 * ui/), and nothing renders twice because of it. Only values reach the screen.
 *
 * Both quote styles, and this is not tidiness: the files shadcn wrote are
 * formatted with double quotes and the files this console wrote with single
 * ones, so a reader that saw only `'…'` would go quiet over exactly the new
 * stack — `ui/skeleton.tsx` importing a module that no longer exists is the
 * mutation that found it. Same trap cockpit-primitives.test.mjs records.
 */
function namedImports() {
  const found = []
  for (const file of sources) {
    for (const match of file.src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
      if (match[1]) continue
      const target = resolveImport(file.path, match[3])
      for (const piece of match[2].split(',')) {
        const spec = piece.trim()
        if (!spec || /^type\s/.test(spec)) continue
        const [name, alias] = spec.split(/\s+as\s+/).map((part) => part.trim())
        found.push({ file: file.id, specifier: match[3], target, name, alias })
      }
    }
  }
  return found
}

const imports = namedImports()

/**
 * The modules this phase removed, and what took each one over.
 *
 * Named rather than derived: a file that is gone leaves no trace to derive from,
 * and re-adding one is exactly the regression worth a failing test. The first
 * test below would catch an import of them; this catches the file coming back
 * before anything imports it.
 */
const REMOVED = [
  [
    'components/ui/primitives.tsx',
    'shadcn button/card/input/textarea/select/label/badge/table, and forms/table-state.tsx',
  ],
  ['components/ui/empty-state.tsx', 'components/ui/empty.tsx'],
]

describe('the cockpit runs on one component stack', () => {
  test('no module imports a file that does not exist', () => {
    // Deduplicated: one dead module imported for three of its exports is one
    // broken import to fix, not three.
    const dangling = [
      ...new Set(
        imports
          .filter((entry) => entry.target === undefined)
          .map((entry) => `${entry.file} imports '${entry.specifier}', which resolves to no file`),
      ),
    ]
    assert.deepEqual(dangling, [], dangling.join('\n'))
  })

  test('the modules this phase removed are gone and stay gone', () => {
    for (const [path, replacement] of REMOVED)
      assert.equal(
        existsSync(join(cockpit, path)),
        false,
        `${path} is back. It was replaced by ${replacement}; a second stack starts by one file returning.`,
      )
  })

  test('every component name is imported from exactly one module', () => {
    // The dual-stack defect in its general form. `Button` resolving to
    // ui/button.tsx in thirty files and to ui/primitives.tsx in three is what
    // put two differently-shaped buttons on one screen, and no per-file test
    // could see it — each file was internally consistent.
    const owners = new Map()
    for (const entry of imports) {
      if (entry.target === undefined || entry.target === null) continue
      if (!/^[A-Z]/.test(entry.name)) continue
      if (!owners.has(entry.name)) owners.set(entry.name, new Map())
      const byTarget = owners.get(entry.name)
      if (!byTarget.has(entry.target)) byTarget.set(entry.target, new Set())
      byTarget.get(entry.target).add(entry.file)
    }
    const split = []
    for (const [name, byTarget] of [...owners].sort())
      if (byTarget.size > 1)
        split.push(
          `${name} is imported from ${byTarget.size} modules: ` +
            [...byTarget].map(([target, users]) => `${rel(target)} (${[...users].sort().join(', ')})`).join(' — and '),
        )
    assert.deepEqual(split, [], `two stacks:\n${split.join('\n')}`)
  })

  test('nothing aliases a component of this tree around a collision', () => {
    // `Button as UiButton` is the tell rather than the disease: a rename is how a
    // file holds two stacks at once without the compiler objecting. The previous
    // test would fail on the same three files, but the message would say two
    // modules own `Button` — this one names the line to delete.
    const aliased = imports
      .filter((entry) => entry.alias && entry.target)
      .map((entry) => `${entry.file}: '${entry.name} as ${entry.alias}' from '${entry.specifier}'`)
    assert.deepEqual(aliased, [], `a renamed local component is a second stack in disguise:\n${aliased.join('\n')}`)
  })
})

describe('the cockpit hand-rolls nothing a component already does', () => {
  test('spacing is a gap on a flex parent, never space-x-* or space-y-*', () => {
    // `space-y-*` puts a margin on every child but the first, which a `gap` on the
    // parent does without reaching into the children at all — and which survives
    // a child being wrapped, reordered or conditionally rendered.
    const offenders = []
    for (const file of [...sources, ...styles])
      for (const match of file.src.matchAll(/\bspace-[xy]-[\w.[\]/-]+/g)) offenders.push(`${file.id}: ${match[0]}`)
    assert.deepEqual(offenders, [], `use flex + gap-*:\n${offenders.join('\n')}`)
  })

  test('a placeholder is a Skeleton, not a hand-written pulse', () => {
    /**
     * The two places a pulse is not a placeholder.
     *
     * `skeleton.tsx` is the component itself — the pulse has to be written once
     * somewhere. `progress.tsx` pulses a full-width bar for the indeterminate
     * case, inside `role="progressbar"`: it stands in for a position the work
     * does not have, not for content that is about to arrive, and a Skeleton
     * there would claim a bar is loading rather than that progress is unknown.
     */
    const ALLOWED = new Set(['components/ui/skeleton.tsx', 'components/ui/progress.tsx'])
    const offenders = []
    for (const file of sources) if (!ALLOWED.has(file.id) && /\banimate-pulse\b/.test(file.src)) offenders.push(file.id)
    assert.deepEqual(offenders, [], `compose <Skeleton /> instead:\n${offenders.join('\n')}`)
  })
})
