import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
 *
 * A directory is not an answer, which is why `isFile()` and not `existsSync()`.
 * `@/forms/fields` names a folder *and* the barrel inside it, and stopping at
 * the folder is the difference between "one component reached two ways" and a
 * reported second stack: the barrel would resolve to `forms/fields` while
 * `./text` resolved to `forms/fields/text.tsx`, and `TextField` would be filed
 * under two modules for no reason but the order of this list.
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
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return undefined
}

/**
 * Every specifier in the tree, whatever syntax carried it.
 *
 * `from '…'` covers static imports, `export … from '…'` and type-only forms;
 * the other two patterns pick up `import('…')` (content/lazy.tsx splits the
 * editor out that way) and the side-effect `import '…'`. This list exists for
 * one question only — does the file on the other end still exist — and that
 * question has nothing to do with which form was used, so it is asked once over
 * all of them rather than four times over four regexes that could each be the
 * one nobody updated.
 */
function everySpecifier() {
  const found = []
  for (const file of sources) {
    for (const match of file.src.matchAll(/\bfrom\s*["']([^"']+)["']/g))
      found.push({ file: file.id, path: file.path, specifier: match[1] })
    for (const match of file.src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g))
      found.push({ file: file.id, path: file.path, specifier: match[1] })
    for (const match of file.src.matchAll(/^[ \t]*import\s+["']([^"']+)["']/gm))
      found.push({ file: file.id, path: file.path, specifier: match[1] })
  }
  return found.map((entry) => ({ ...entry, target: resolveImport(entry.path, entry.specifier) }))
}

/**
 * Every value a module pulls in under a name of its own, as
 * `{ file, specifier, target, name, alias, form }`.
 *
 * Three forms, because a second stack can arrive in any of them and only the
 * first was ever read here:
 *
 *  - `named` — `import { Button } from '…'`, with `alias` set for the
 *    `Button as UiButton` spelling;
 *  - `default` — `import Button from '…'`. This is the hole the last two rounds
 *    fell through. A hand-rolled button that is `export default` and imported
 *    without braces produces no brace to grep for, collides with no name in the
 *    importing file, and typechecks perfectly — and it was on screen next to a
 *    shadcn one twice;
 *  - `namespace` — `import * as Ui from '…'`. This one cannot be graded by name
 *    at all: `Ui.Button` is a property access, not an import, so the check below
 *    would see one binding called `Ui` and nothing else. It gets its own test.
 *
 * Type-only imports are dropped — both `import type {…}` and an inline
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
function bindings() {
  const found = []
  for (const file of sources) {
    for (const match of file.src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s*["']([^"']+)["']/g)) {
      if (match[1]) continue
      const target = resolveImport(file.path, match[3])
      for (const piece of match[2].split(',')) {
        const spec = piece.trim()
        if (!spec || /^type\s/.test(spec)) continue
        const [name, alias] = spec.split(/\s+as\s+/).map((part) => part.trim())
        found.push({ file: file.id, specifier: match[3], target, name, alias, form: 'named' })
      }
    }
    // `import Button from '…'` and `import Button, { … } from '…'`. `(?!type\s)`
    // keeps `import type Foo from` out; `(?!\*)` leaves the namespace form to the
    // pattern below.
    for (const match of file.src.matchAll(
      /import\s+(?!type\s)(?!\*)([A-Za-z_$][\w$]*)\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+)\s*)?from\s*["']([^"']+)["']/g,
    ))
      found.push({
        file: file.id,
        specifier: match[2],
        target: resolveImport(file.path, match[2]),
        name: match[1],
        alias: undefined,
        form: 'default',
      })
    for (const match of file.src.matchAll(
      /import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\*\s+as\s+([\w$]+)\s+from\s*["']([^"']+)["']/g,
    ))
      found.push({
        file: file.id,
        specifier: match[2],
        target: resolveImport(file.path, match[2]),
        name: match[1],
        alias: undefined,
        form: 'namespace',
      })
  }
  return found
}

/**
 * Where each module forwards a name it does not declare: `export { X } from '…'`
 * and `export { X as Y } from '…'`.
 *
 * Without this the check below grades the *specifier* rather than the component.
 * That is wrong in both directions, and the tree contains one of each:
 *
 *  - a false alarm — `forms/fields/index.ts` is a barrel, so `TextField` reads as
 *    "imported from `forms/fields` and from `forms/fields/text.tsx`". Those are
 *    one component behind two spellings and nothing renders twice;
 *  - a miss, and the more expensive one — a file that re-exports a second
 *    `Button` launders it. Every page then imports `Button` from one specifier,
 *    every page is internally consistent, and two differently-shaped buttons are
 *    still on one screen. Grading the spelling cannot see that; following the
 *    forward to where the component is *declared* sees both cases correctly.
 */
function forwardTable() {
  const table = new Map()
  for (const file of sources) {
    const named = new Map()
    for (const match of file.src.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s+from\s*["']([^"']+)["']/g)) {
      if (match[1]) continue
      const target = resolveImport(file.path, match[3])
      for (const piece of match[2].split(',')) {
        const spec = piece.trim()
        if (!spec || /^type\s/.test(spec)) continue
        const [original, alias] = spec.split(/\s+as\s+/).map((part) => part.trim())
        named.set(alias ?? original, { target, original })
      }
    }
    if (named.size > 0) table.set(file.path, named)
  }
  return table
}

const forwards = forwardTable()

/**
 * The file that actually declares `name`, walking every `export … from` hop.
 *
 * `seen` is not defensive tidying: a barrel that re-exports from a module which
 * re-exports back is a legal cycle in ESM, and an unguarded walk would hang the
 * suite rather than fail it.
 */
function declaringModule(target, name, seen = new Set()) {
  if (target === null || target === undefined) return target
  const key = `${target} ${name}`
  if (seen.has(key)) return target
  seen.add(key)
  const forwarded = forwards.get(target)?.get(name)
  if (!forwarded) return target
  return declaringModule(forwarded.target, forwarded.original, seen)
}

const specifiers = everySpecifier()
const imports = bindings().map((entry) => ({ ...entry, origin: declaringModule(entry.target, entry.name) }))

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
    // broken import to fix, not three. Read off `specifiers`, so a `export … from`
    // or a lazy `import('…')` left pointing at a deleted module fails here too —
    // neither carries a brace this file used to be looking for.
    const dangling = [
      ...new Set(
        specifiers
          .filter((entry) => entry.target === undefined)
          .map((entry) => `${entry.file} imports '${entry.specifier}', which resolves to no file`),
      ),
    ].sort()
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

  test('every component name is declared by exactly one module', () => {
    // The dual-stack defect in its general form. `Button` resolving to
    // ui/button.tsx in thirty files and to ui/primitives.tsx in three is what
    // put two differently-shaped buttons on one screen, and no per-file test
    // could see it — each file was internally consistent.
    //
    // Grouped by `origin`, the module that declares the component, not by the
    // specifier that was typed: a barrel is one component under two spellings and
    // is not a finding, while a re-export of a second `Button` is two components
    // under one spelling and is exactly the finding. `default` bindings count —
    // `import Button from '…'` is the form both earlier rounds missed.
    const owners = new Map()
    for (const entry of imports) {
      if (entry.form === 'namespace') continue // graded by the test below
      if (entry.origin === undefined || entry.origin === null) continue
      if (!/^[A-Z]/.test(entry.name)) continue
      if (!owners.has(entry.name)) owners.set(entry.name, new Map())
      const byOrigin = owners.get(entry.name)
      if (!byOrigin.has(entry.origin)) byOrigin.set(entry.origin, new Set())
      byOrigin.get(entry.origin).add(`${entry.file} via '${entry.specifier}'`)
    }
    const split = []
    for (const [name, byOrigin] of [...owners].sort())
      if (byOrigin.size > 1)
        split.push(
          `${name} is declared by ${byOrigin.size} modules: ` +
            [...byOrigin].map(([target, users]) => `${rel(target)} (${[...users].sort().join(', ')})`).join(' — and '),
        )
    assert.deepEqual(split, [], `two stacks:\n${split.join('\n')}`)
  })

  test('a name is exported by exactly one module, whether or not anything imports it', () => {
    /**
     * Old scope: names that something *imports*. New scope: names that something
     * *exports*.
     *
     * The test above grades the import graph, which means a second component is
     * invisible to it until a file imports it — and the last round shipped
     * exactly that: `ui/dialog.tsx` exported a `Sheet` that nothing imported,
     * while `ui/sheet.tsx` exported the real one. Two `Sheet`s in the tree, one
     * of them dead, and every check here green, because "which module declares
     * Sheet" was only ever asked of the module somebody had typed. It is how the
     * one-stack test gets beaten the next time someone autocompletes: the import
     * that revives the dead one is a single character of tab-completion away, and
     * nothing between here and the screen would object.
     *
     * So: declarations, not imports. `export … from` is not a declaration — a
     * barrel forwards a component it does not own, and `forms/fields/index.ts`
     * would otherwise read as a second stack every time. Neither is `export { X }`
     * of an `X` the module imported: that is the same forward with the hop split
     * over two lines.
     */
    const dynamic = new Map(
      sources.map((file) => [
        file.id,
        new Set(
          [...file.src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)]
            .map((match) => resolveImport(file.path, match[1]))
            .filter((target) => typeof target === 'string')
            .map((target) => rel(target)),
        ),
      ]),
    )

    const owners = new Map()
    for (const file of sources) {
      const imported = new Set(
        [...file.src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s*["'][^"']+["']/g)].flatMap((match) =>
          match[1].split(',').map((piece) =>
            (
              piece
                .trim()
                .split(/\s+as\s+/)
                .pop() ?? ''
            ).trim(),
          ),
        ),
      )
      const declared = new Set()
      // `export function X` / `export const X` / `export class X`. Types are not
      // components: `export type` and `export interface` never reach the screen,
      // and lib/release-chain.ts's `ReleaseChain` type sharing a name with
      // ui/release-chain.tsx's component renders nothing twice.
      for (const match of file.src.matchAll(/^\s*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([\w$]+)/gm))
        declared.add(match[1])
      // `export default function X` and `export default class X`. The default
      // export is exactly how a second stack arrives unseen — the review that
      // asked for this walked in through one — and it was the shape the line
      // above could not read, because `default` sits between `export` and the
      // keyword. An anonymous default declares no name and is left alone.
      for (const match of file.src.matchAll(/^\s*export\s+default\s+(?:async\s+)?(?:function|class)\s+([\w$]+)/gm))
        declared.add(match[1])
      for (const match of file.src.matchAll(/^\s*export\s+\{([^}]*)\}(?!\s*from)/gm))
        for (const piece of match[1].split(',')) {
          const spec = piece.trim()
          if (!spec || /^type\s/.test(spec)) continue
          const name = (spec.split(/\s+as\s+/).pop() ?? '').trim()
          if (!imported.has(name)) declared.add(name)
        }
      for (const name of declared) {
        if (!/^[A-Z]/.test(name)) continue
        if (!owners.has(name)) owners.set(name, new Set())
        owners.get(name).add(file.id)
      }
    }

    /**
     * The one shape that is two declarations of a name on purpose: a lazy
     * boundary. `content/lazy.tsx` declares `ContentHtml` and `Draft` as Suspense
     * wrappers around `import('./ContentHtml')` and `import('./draft')`, which
     * declare them eagerly — one component behind a code split, and every
     * importer in the console reaches it through the wrapper.
     *
     * Granted by the dynamic import, not by a filename: a module that shadows a
     * name it does not load is the defect, and stays reported.
     */
    const split = []
    for (const [name, modules] of [...owners].sort()) {
      if (modules.size < 2) continue
      const ids = [...modules].sort()
      if (ids.some((id) => ids.some((other) => other !== id && dynamic.get(id)?.has(other)))) continue
      split.push(`${name} is exported by ${ids.length} modules: ${ids.join(' — and ')}`)
    }
    assert.deepEqual(
      split,
      [],
      `one name, one module — a dead export squatting a live name is still two:\n${split.join('\n')}`,
    )
  })

  test('nothing aliases a component of this tree around a collision', () => {
    // `Button as UiButton` is the tell rather than the disease: a rename is how a
    // file holds two stacks at once without the compiler objecting. The previous
    // test would fail on the same three files, but the message would say two
    // modules declare `Button` — this one names the line to delete.
    const aliased = imports
      .filter((entry) => entry.alias && entry.target)
      .map((entry) => `${entry.file}: '${entry.name} as ${entry.alias}' from '${entry.specifier}'`)
    assert.deepEqual(aliased, [], `a renamed local component is a second stack in disguise:\n${aliased.join('\n')}`)
  })

  test('nothing namespace-imports a module of this tree', () => {
    // `import * as Ui from '@/components/ui/legacy'` then `<Ui.Button/>` is the
    // one shape the check above is blind to by construction: the only binding is
    // `Ui`, and `Button` never appears as an import anywhere. It is also the
    // easiest way to bring a whole second stack in on one line. `import * as
    // React from "react"` is untouched — a bare specifier is a package and not
    // this tree's business, which is why the rule is written over local targets.
    const wholesale = imports
      .filter((entry) => entry.form === 'namespace' && entry.target)
      .map((entry) => `${entry.file}: 'import * as ${entry.name}' from '${entry.specifier}'`)
    assert.deepEqual(
      wholesale,
      [],
      `import the components you use by name — a namespace binding hides which stack they came from:\n${wholesale.join('\n')}`,
    )
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
