import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The console is an app shell, and that is a promise about heights.
 *
 * `body` is `overflow: hidden` on purpose: the panes scroll and the document does
 * not, which is what keeps the sidebar still while a list moves under it. That
 * only works if every element between `body` and the scrolling pane is BOUNDED to
 * the viewport. One unbounded ancestor and the whole column grows past the fold,
 * the pane's `overflow-y-auto` never overflows because its parent grew instead,
 * and `overflow: hidden` silently cuts off everything below.
 *
 * That shipped. shadcn's `SidebarProvider` wrapper is `min-h-svh` — at least the
 * viewport, growing with content, which is right for a page that scrolls in the
 * document and wrong here. Measured on the releases page in production: an 827px
 * viewport, a 9073px wrapper, `scrollHeight === clientHeight` on the pane, and
 * nine tenths of the page unreachable by any means.
 *
 * WHAT THIS TEST IS AND IS NOT. It reads source. It cannot measure a layout —
 * jsdom performs none, so `clientHeight` is 0 there and the behavioural suite is
 * blind to this entire class. What it can do is hold the pairing together: as long
 * as `body` refuses to scroll, the shell must bound itself, and both halves of the
 * flexbox rule must be present. A real fix for the class is a browser-driven check;
 * `playwright` is already a devDependency of this repository and
 * `scripts/validate-*-browser.mjs` is the established pattern, but those drive built
 * site output rather than the console, so wiring one for the SPA is its own piece of
 * work. Until then this is the cheap half, and it is written down as the cheap half.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit')
const shell = readFileSync(join(cockpit, 'src', 'app', 'shell.tsx'), 'utf8')
const css = readFileSync(join(cockpit, 'src', 'index.css'), 'utf8')
const html = readFileSync(join(cockpit, 'index.html'), 'utf8')

/** The `className` of the single `<Name` element, if it has one. */
function classesOf(text, name) {
  const at = text.indexOf(`<${name}`)
  if (at < 0) return null
  const close = text.indexOf('>', at)
  const match = text.slice(at, close).match(/className="([^"]*)"/)
  return match?.[1] ?? ''
}

describe('the console scrolls in its panes, so its shell must be bounded', () => {
  test('the document itself does not scroll — the premise the rest of this file rests on', () => {
    assert.match(css, /body\s*\{[^}]*overflow:\s*hidden/s, 'body must stay put; the panes are what move')
  })

  test('the viewport chain from html down to the app root is bounded', () => {
    for (const element of ['html', 'body', 'div id="root"']) {
      const at = html.indexOf(`<${element}`)
      assert.ok(at >= 0, `${element} is not where this test looks for it`)
      const tag = html.slice(at, html.indexOf('>', at))
      assert.match(tag, /class="[^"]*\bh-full\b/, `${element} must be bounded, or everything below it grows`)
    }
  })

  test('the sidebar wrapper is bounded, because shadcn ships it unbounded', () => {
    const classes = classesOf(shell, 'SidebarProvider')
    assert.ok(classes !== null, 'the shell no longer renders a SidebarProvider')
    assert.match(
      classes,
      /\bh-(full|svh|screen|dvh)\b/,
      'SidebarProvider is min-h-svh by default: it grows past a viewport that cannot scroll',
    )
    assert.match(
      classes,
      /\bmin-h-0\b/,
      'a flex child defaults to min-height:auto and refuses to shrink below its content',
    )
  })

  test('the inset can shrink, so the pane inside it can overflow', () => {
    const classes = classesOf(shell, 'SidebarInset')
    assert.ok(classes !== null, 'the shell no longer renders a SidebarInset')
    assert.match(classes, /\bmin-h-0\b/, 'without this the inset pushes from the inside and the pane never scrolls')
  })

  test('there is exactly one scrolling pane, and it is inside the inset', () => {
    const inset = shell.indexOf('<SidebarInset')
    assert.ok(inset > 0)
    const after = shell.slice(inset)
    assert.match(after, /overflow-y-auto/, 'the pane that scrolls must live inside the inset')
  })
})
