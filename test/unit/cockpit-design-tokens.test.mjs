import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveDesignSystem } from '../../src/design-system.mjs'

/**
 * The console's palette is ContentKit's palette, asserted rather than promised.
 *
 * `apps/cockpit/src/index.css` gives shadcn's variable NAMES ContentKit's VALUES,
 * and says so in its own header comment: "taken from resolveDesignSystem()'s light
 * and dark defaults in src/design-system.mjs … Keep the two in sync; a drift test
 * compares all of them."
 *
 * That last clause was the only untrue sentence in the file. Nothing compared them.
 * `cockpit-scroll-containment.test.mjs` reads index.css for `body { overflow }` and
 * `cockpit-lists.test.mjs` only mentions it in a comment, so the sixty-nine bindings
 * below were held together by hand — and the failure mode is silent by construction:
 * a drifted `--accent` renders perfectly, on brand for nobody, and no test and no
 * screen says a word. UI-UX.md's own standard is "where a rule can be enforced by a
 * test, the test is named"; this file is that test, so the sentence is now true.
 *
 * The values matched exactly when this was written. It is a guard, not a repair.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cssPath = join(root, 'apps', 'cockpit', 'src', 'index.css')
const css = readFileSync(cssPath, 'utf8')

/** The design system with no tenant overrides — which is what the console renders. */
const design = resolveDesignSystem({})

/**
 * Which design token each shadcn name carries, per index.css's own header.
 *
 * Six names have no counterpart in the design system and are *derived* rather than
 * invented; each is written here with the derivation the comment states, so a
 * changed derivation is a changed line in this file rather than a silent edit.
 */
const BINDINGS = {
  background: 'background',
  foreground: 'foreground',
  surface: 'surface',
  // `card` and `popover` take `surface`.
  card: 'surface',
  'card-foreground': 'foreground',
  popover: 'surface',
  'popover-foreground': 'foreground',
  primary: 'primary',
  'primary-foreground': 'primary_foreground',
  // `secondary` takes `muted`.
  secondary: 'muted',
  'secondary-foreground': 'primary',
  muted: 'muted',
  'muted-foreground': 'muted_foreground',
  accent: 'accent',
  'accent-foreground': 'accent_foreground',
  // `destructive` takes chart_5 (the palette's red), `warning` chart_3 (its amber),
  // `success` chart_2 (its green) — a severity must never be spelled `bg-chart-N`.
  destructive: 'chart_5',
  warning: 'chart_3',
  success: 'chart_2',
  border: 'border',
  // `input` and `ring` follow `border` and `accent`.
  input: 'border',
  ring: 'accent',
  'chart-1': 'chart_1',
  'chart-2': 'chart_2',
  'chart-3': 'chart_3',
  'chart-4': 'chart_4',
  'chart-5': 'chart_5',
  // The sidebar carries the site context, so it sits on `surface`.
  sidebar: 'surface',
  'sidebar-foreground': 'foreground',
  'sidebar-primary': 'primary',
  'sidebar-primary-foreground': 'primary_foreground',
  'sidebar-accent': 'muted',
  'sidebar-accent-foreground': 'primary',
  'sidebar-border': 'border',
  'sidebar-ring': 'accent',
}

/** Every `--name: value` in one selector's block. */
function declarations(selector) {
  const match = css.match(new RegExp(`(^|\\n)${selector}\\s*\\{([\\s\\S]*?)\\n\\}`))
  assert.ok(match, `index.css no longer has a ${selector.replaceAll('\\', '')} block for the console's palette`)
  const out = new Map()
  for (const [, name, value] of match[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) out.set(name, value.trim())
  return out
}

const SCHEMES = [
  { scheme: 'light', selector: ':root' },
  { scheme: 'dark', selector: '\\.dark' },
]

describe('the console renders ContentKit’s palette, not a stock one', () => {
  for (const { scheme, selector } of SCHEMES) {
    test(`every ${scheme} variable carries its design-system value`, () => {
      const vars = declarations(selector)
      const drifted = []
      for (const [name, token] of Object.entries(BINDINGS)) {
        const got = vars.get(name)
        const want = design[scheme][token]
        assert.ok(got, `index.css ${scheme}: --${name} is gone; shadcn still reads it and will fall back to its own`)
        assert.ok(want, `src/design-system.mjs has no ${scheme}.${token}, which --${name} is declared to follow`)
        if (got !== want) drifted.push(`--${name}: ${got} (design-system ${scheme}.${token} is ${want})`)
      }
      assert.deepEqual(
        drifted,
        [],
        `apps/cockpit/src/index.css has drifted from src/design-system.mjs in the ${scheme} scheme:\n  ` +
          `${drifted.join('\n  ')}\n` +
          'The console and the sites it publishes read as one product only while these agree. Change the value in ' +
          'src/design-system.mjs and copy it here, or change the derivation in BINDINGS above — never one alone.',
      )
    })

    test(`no ${scheme} variable is left unaccounted for`, () => {
      // The other direction, and the one that matters as the console grows: a new
      // `--brand: #ff0000` added to index.css and to nothing else is exactly the
      // stock-demo drift this file exists to prevent, and a table that only checks
      // the names it already knows would never see it.
      const vars = declarations(selector)
      const unaccounted = [...vars.keys()].filter((name) => !(name in BINDINGS) && name !== 'radius')
      assert.deepEqual(
        unaccounted,
        [],
        `index.css declares ${unaccounted.map((name) => `--${name}`).join(', ')} in the ${scheme} scheme, which no ` +
          'binding in this file accounts for. A colour the design system never named belongs in src/design-system.mjs ' +
          'first, then here with the token it carries.',
      )
    })
  }

  test('--radius follows the design system too', () => {
    assert.equal(
      declarations(':root').get('radius'),
      design.radius,
      '--radius is the one non-colour token index.css takes from the design system',
    )
  })

  test('and the bindings are checked against a palette that is really there', () => {
    // Guards the guard: if resolveDesignSystem ever stops returning these, every
    // assertion above would compare undefined to undefined and pass on nothing.
    for (const { scheme } of SCHEMES) {
      const tokens = new Set(Object.values(BINDINGS))
      for (const token of tokens) {
        assert.match(
          String(design[scheme][token]),
          /^#[\da-f]{6}$/i,
          `src/design-system.mjs ${scheme}.${token} is not a hex colour, so the comparison above proves nothing`,
        )
      }
    }
    assert.equal(Object.keys(BINDINGS).length, 34, 'a binding was added or removed without a look at this count')
  })
})
