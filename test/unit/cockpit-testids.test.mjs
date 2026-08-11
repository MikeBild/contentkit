import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every interactive element carries a `data-testid` — UI-UX.md §8, over the
 * whole console rather than over one file.
 *
 * This is the rule the document calls "a standing project requirement, not a
 * testing convenience", and until this file nothing checked it anywhere. A
 * mutation that deleted the `data-testid` from an action left 982 assertions
 * green: the browser checks that would have missed it are not in this repository,
 * the rendering suite reaches ten modules out of a hundred and thirty, and a
 * name that is gone is not a name any grep was looking for.
 *
 * It is asserted from source for the same reason `cockpit-affordances.test.mjs`
 * is: the claim is about every control in the console, and the rendering suite
 * renders two pages of sixteen. A test that could only see what jsdom mounts
 * would grade the two and call the console covered.
 *
 * ─── What counts as a control ────────────────────────────────────────────────
 *
 * A tab stop, or something that acts when it is clicked. Not a layout wrapper
 * that happens to be a component: `ToggleGroup` is a `role="group"` around items
 * that each carry their own name, and naming the group as well would make the
 * rule read as "every element", which is a rule nobody can apply.
 *
 * ─── The three ways an element can satisfy it ────────────────────────────────
 *
 *  1. `data-testid=` on the tag. The ordinary case.
 *  2. `asChild`, with the child it merges into carrying one. `asChild` means the
 *     component renders NO DOM of its own — Radix's Slot merges its props onto
 *     the child — so the testid belongs on the element that actually exists.
 *     `<Button asChild><a data-testid="deck-job-download">` is one element in
 *     the page and it is named. The chain is followed, because the console nests
 *     them: `TooltipTrigger asChild > DropdownMenuTrigger asChild >
 *     SidebarMenuButton data-testid="site-switcher"` is three components and one
 *     button.
 *  3. A `{...spread}`, where the name arrives with the props. This is how every
 *     field shape is named — `forms/fields/field.tsx` hands the control a
 *     `ControlProps` whose `'data-testid'` is REQUIRED, so `<Input {...control}/>`
 *     provably carries one and TypeScript is what enforces it. That requirement
 *     is asserted below, because it is the whole justification for this branch:
 *     make it optional and thirteen field shapes lose their names in silence.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')

/** The file with its prose removed, and its line numbering intact. */
const code = (text) =>
  text.replaceAll(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (match, before) => (before ?? '') + match.replace(/[^\n]/g, ''))

const FILES = (function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(path)
  }
  return out
})(cockpit).map((path) => ({
  id: relative(cockpit, path).split(sep).join('/'),
  src: code(readFileSync(path, 'utf8')),
}))

/**
 * Every opening tag of one element, with the region it holds.
 *
 * The same reader `cockpit-affordances.test.mjs` documents at length: a regex
 * cannot find the end of a JSX opening tag, because `onClick={() => set(a > b)}`
 * carries both `>` and `}` and `className="a > b"` carries a `>` in a string.
 * Depth and quote state are tracked instead. It is duplicated rather than shared
 * because these two files grade different rules and a shared helper module under
 * `test/unit` would be the only one of its kind in this suite.
 */
function elements(src, name) {
  const out = []
  const open = new RegExp(`<${name}(?=[\\s/>])`, 'g')
  let match
  while ((match = open.exec(src))) {
    let i = match.index + name.length + 1
    let depth = 0
    let quote = null
    for (; i < src.length; i++) {
      const c = src[i]
      if (quote) {
        if (c === quote && src[i - 1] !== '\\') quote = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '>' && depth === 0) break
    }
    const tag = src.slice(match.index, i + 1)
    let body = ''
    if (!/\/>$/.test(tag)) {
      let cursor = i + 1
      let nesting = 1
      const close = `</${name}>`
      while (nesting > 0 && cursor < src.length) {
        const nextOpen = src.indexOf(`<${name}`, cursor)
        const nextClose = src.indexOf(close, cursor)
        if (nextClose === -1) break
        if (nextOpen !== -1 && nextOpen < nextClose) {
          nesting += 1
          cursor = nextOpen + name.length + 1
        } else {
          nesting -= 1
          cursor = nextClose + close.length
        }
      }
      body = src.slice(i + 1, Math.max(i + 1, cursor - close.length))
    }
    out.push({ tag, body, line: src.slice(0, match.index).split('\n').length })
  }
  return out
}

/**
 * The controls, by the name they are written with.
 *
 * Both spellings are here on purpose: `<Button>` is what a page writes and
 * `<button>` is what a component writes when it builds a control itself —
 * `components/ui/tabs.tsx` renders the tab strip's buttons and derives their
 * names from the strip's, and that derivation is exactly the kind of thing that
 * can be dropped by hand.
 */
const CONTROLS = [
  'Button',
  'Input',
  'Textarea',
  'SelectTrigger',
  'Checkbox',
  'Switch',
  'Combobox',
  'MultiCombobox',
  'ToggleGroupItem',
  'Toggle',
  'Dropzone',
  'CopyButton',
  'AppLink',
  'SidebarMenuButton',
  'DropdownMenuTrigger',
  'PopoverTrigger',
  'TooltipTrigger',
  'HoverCardTrigger',
  'AccordionTrigger',
  'CollapsibleTrigger',
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'summary',
]

const named = (tag) => /data-testid=/.test(tag)
const spread = (tag) => /\{\.\.\.\w+\}/.test(tag)

/**
 * Does this `asChild` wrapper hand its name to something that has one?
 *
 * `null` means "there is no JSX child here to look at" — the child is an
 * expression, `<TooltipTrigger asChild>{item}</TooltipTrigger>`, and `item` is
 * an element built above with its own name. Those are counted separately below
 * rather than passed silently, so that the number of them cannot grow without
 * anyone noticing.
 */
function delegatesName(body) {
  const child = /<([A-Za-z][\w.]*)(?=[\s/>])/.exec(body)
  if (!child) return null
  const inner = elements(body, child[1])[0]
  if (!inner) return null
  if (named(inner.tag) || spread(inner.tag)) return true
  if (/\basChild\b/.test(inner.tag)) return delegatesName(inner.body)
  return false
}

/**
 * The controls this sweep found without a name, kept as a list rather than
 * fixed here, because both live in files this pass does not own.
 *
 * Keyed by file and element rather than by line, so an unrelated edit above them
 * does not turn this red. Each is a real violation of §8 and each is one
 * attribute away from being removable from this list:
 *
 *  - `components/ui/relative-time.tsx <TooltipTrigger asChild>` — its child is a
 *    bare `<span tabIndex={0}>`, the focus target the tooltip on every timestamp
 *    in the console hangs from. A tab stop with no name; the `TooltipContent`
 *    beside it has one.
 *  - `components/ui/release-chain.tsx <TooltipTrigger asChild>` — the same shape,
 *    on the release chain's stage labels.
 *  - `forms/content/body.tsx <summary>` — "Insert a semantic directive". A
 *    `<summary>` is a disclosure control a keyboard reaches and a browser check
 *    has to click; its `<details>` parent is named and it is not.
 */
const UNNAMED = new Set()

describe('every interactive element carries a data-testid — UI-UX.md §8', () => {
  const controls = []
  const delegated = { toChild: 0, toExpression: [] }

  for (const file of FILES) {
    for (const name of CONTROLS) {
      for (const element of elements(file.src, name)) {
        controls.push({ file, name, element })
      }
    }
  }

  test('the sweep found the console, so the rule below is read off real elements', () => {
    assert.ok(controls.length > 250, `only ${controls.length} controls found — this file would prove nothing`)
    assert.ok(FILES.length > 40, `only ${FILES.length} .tsx found under ${cockpit}`)
  })

  test('no control is unnamed', () => {
    const found = []
    for (const { file, name, element } of controls) {
      if (named(element.tag) || spread(element.tag)) continue
      let what = `<${name}>`
      if (/\basChild\b/.test(element.tag)) {
        const delegates = delegatesName(element.body)
        if (delegates === true) {
          delegated.toChild += 1
          continue
        }
        if (delegates === null) {
          delegated.toExpression.push(`${file.id}:${element.line} <${name} asChild>{…}`)
          continue
        }
        // The wrapper renders no DOM, so the element that is missing a name is
        // the child it merges into — say so, and key the exemption on the
        // wrapper, which is the line an editor has to open.
        what = `<${name} asChild>`
      }
      if (UNNAMED.has(`${file.id} ${what}`)) continue
      found.push(`${file.id}:${element.line} ${what} has no data-testid`)
    }
    assert.deepEqual(
      found,
      [],
      'a control with no name cannot be addressed by a browser check, and §8 makes that a project requirement\n' +
        'rather than a testing convenience. Add the name, or — if it is an asChild wrapper — put it on the child\n' +
        `element that actually renders:\n${found.join('\n')}`,
    )
  })

  test('the asChild branch is carrying its weight rather than excusing the sweep', () => {
    // If this ever dwarfs the named controls, the rule has become "write
    // asChild". It does not today: a handful of wrappers, against hundreds of
    // controls named outright.
    assert.ok(delegated.toChild > 0, 'no asChild wrapper delegated its name — the branch is unexercised')
    assert.ok(
      delegated.toChild < controls.length / 4,
      `${delegated.toChild} of ${controls.length} controls are named only through an asChild child`,
    )
    // The `{expression}` children, listed so they are countable. Each is an
    // element built a few lines above and named there — a Tooltip wrapped around
    // a `ToggleGroupItem` or a `SidebarMenuButton` that already has its name.
    assert.ok(
      delegated.toExpression.length <= 2,
      `an asChild wrapper whose child is an expression cannot be graded here; there are now\n` +
        `${delegated.toExpression.length}:\n${delegated.toExpression.join('\n')}`,
    )
  })

  test('the spread branch is sound: a field control cannot be handed props without a name', () => {
    // `<Input {...control} />` is accepted above only because `ControlProps`
    // makes the name mandatory. Make it optional and thirteen field shapes lose
    // their testids with nothing to say so.
    const field = FILES.find((file) => file.id === 'forms/fields/field.tsx')
    assert.ok(field, 'forms/fields/field.tsx is gone; the spread exemption has to be re-argued')
    const props = /export interface ControlProps \{([\s\S]*?)\n\}/.exec(field.src)
    assert.ok(props, 'ControlProps is no longer declared in forms/fields/field.tsx')
    assert.match(
      props[1],
      /^\s*'data-testid': string$/m,
      "ControlProps must require 'data-testid' — optional here means every {...control} spread is unchecked",
    )
  })

  test('the list of known-unnamed controls has not grown', () => {
    // A shrinking list is the point. It is asserted as a set rather than a
    // maximum so that trading one fix for one regression is still red.
    assert.deepEqual(
      [...UNNAMED].sort(),
      [],
      'UNNAMED is the list of §8 violations this sweep found and did not own. Removing an entry is the fix landing;\n' +
        'adding one needs an argument in the block comment above it.',
    )
  })

  test('the names are unique, so a check that finds one finds the right one', () => {
    // Only the literal ones: a template name is per-row by construction
    // (`pattern-open-${id}`), and two rows are the point.
    const seen = new Map()
    for (const file of FILES) {
      for (const match of file.src.matchAll(/data-testid="([^"]+)"/g)) {
        const line = file.src.slice(0, match.index).split('\n').length
        const at = `${file.id}:${line}`
        seen.set(match[1], [...(seen.get(match[1]) ?? []), at])
      }
    }
    const collisions = [...seen]
      // A name written twice in ONE module is usually two branches of the same
      // element — the save bar rendered in two states, an empty and a loaded
      // list. Across two modules it is two different controls answering to one
      // name, which is what breaks a browser check.
      .filter(([, sites]) => new Set(sites.map((at) => at.split(':')[0])).size > 1)
      .map(([name, sites]) => `${name}: ${sites.join(', ')}`)
    assert.deepEqual(collisions, [], `one name, two controls in two modules:\n${collisions.join('\n')}`)
  })
})
