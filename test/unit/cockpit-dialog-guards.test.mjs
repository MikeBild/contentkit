import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A dialog that owns a mutation may not be dismissed while the request is in the air.
 *
 * Radix gives three separate ways out of a modal and closing any one of them is not
 * enough: `onOpenChange` (the X, and any programmatic close), `onEscapeKeyDown`, and
 * `onPointerDownOutside`. Leave one open and the operator can walk away mid-write —
 * the mutation still lands, the dialog that was reporting it is gone, and a refusal
 * is announced to nobody.
 *
 * This is a source-reading test and it is deliberately the cheap half. The expensive
 * half — that the guards actually hold when you press Escape — is
 * `apps/cockpit/src/components/ui/dialog.test.tsx`, which drives the real component.
 * What that suite cannot see is the other twelve call sites: it renders one dialog,
 * so removing all three guard lines from a live one left 70 DOM tests, 956 Node tests
 * and `tsc` green. That gap is what this file closes, and it closes it the only way a
 * grep can — by insisting the lines are present, not that they work.
 *
 * The distinction that makes it non-vacuous is between a dialog that WRITES and one
 * that READS. A reader has nothing in flight and must stay freely dismissable; making
 * it un-dismissable would be its own defect. So readers are named here, each with the
 * reason, and everything else must carry all three.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const src = join(root, 'apps', 'cockpit', 'src')

/**
 * Dialogs that own no mutation. Each entry is a promise that the dialog only reads,
 * and it is checked: a reader that grows a mutation fails the last test below.
 */
const READERS = {
  'forms/content/revisions.tsx': 'shows the diff between two revisions already stored; writes nothing',
  'pages/authoring.tsx': 'three inspectors — a published document, a pattern, a guide — all reads',
  'components/ui/command.tsx': 'the command palette navigates; the destination does the writing',
}

/**
 * Comments out, before anything is matched.
 *
 * Every guard in this console is written under a paragraph explaining why it is
 * there — which is the house style and worth keeping — and a naïve window from
 * `onOpenChange={` to the pending flag lands in the middle of that paragraph. The
 * first version of this test reported `readers.tsx` as unguarded because its
 * comment is 180 characters long.
 */
const code = (text) => text.replaceAll(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1')

/** Every `.tsx` under apps/cockpit/src, excluding co-located tests. */
function walk(directory) {
  const out = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

const files = walk(src)
  .map((file) => ({ id: relative(src, file).replaceAll('\\', '/'), text: readFileSync(file, 'utf8') }))
  .filter((file) => file.text.includes('<DialogContent'))

describe('a dialog that owns a mutation cannot be dismissed mid-flight', () => {
  test('every module rendering a DialogContent is either a writer or a declared reader', () => {
    assert.ok(files.length >= 10, `expected the console's dialogs, found ${files.length}`)
    const undeclared = files.filter((file) => !(file.id in READERS)).map((file) => file.id)
    // Not an assertion that the list is empty — writers are the normal case. This
    // pins that the split is complete, so a new dialog cannot arrive unclassified.
    assert.ok(undeclared.length > 0, 'the console has writers; if this is empty the walk broke')
  })

  test('each declared reader really is one — no pending flag reaches its dialog', () => {
    for (const [id, reason] of Object.entries(READERS)) {
      const file = files.find((entry) => entry.id === id)
      assert.ok(file, `${id} is declared a reader but renders no DialogContent — drop the entry`)
      for (const element of dialogElements(file.text)) {
        assert.doesNotMatch(
          element,
          /isPending|isSaving|closeDisabled/,
          `${id} is declared a reader (${reason}) but its dialog reads a pending flag — it writes`,
        )
      }
    }
  })

  test('every writing dialog carries all three guards, not two', () => {
    const missing = []
    for (const file of files) {
      if (file.id in READERS) continue
      for (const element of dialogElements(file.text)) {
        const has = {
          close: /closeDisabled=/.test(element),
          escape: /onEscapeKeyDown=/.test(element),
          pointer: /onPointerDownOutside=/.test(element),
        }
        const absent = Object.entries(has)
          .filter(([, present]) => !present)
          .map(([name]) => name)
        if (absent.length) missing.push(`${file.id}: ${absent.join(', ')}`)
      }
    }
    assert.deepEqual(
      missing,
      [],
      'a dialog owning a mutation must refuse Escape, the backdrop and the X while the request is in the air',
    )
  })

  test('the busy check also guards onOpenChange, so a programmatic close cannot slip past', () => {
    const missing = files
      .filter((file) => !(file.id in READERS))
      .filter((file) => !/onOpenChange=\{[\s\S]{0,300}?(isPending|isSaving|busy)/.test(code(file.text)))
      .map((file) => file.id)
    assert.deepEqual(missing, [], 'onOpenChange must return early while the mutation is in flight')
  })
})

/** Each `<DialogContent …>` opening tag in the file, braces balanced. */
function dialogElements(text) {
  const out = []
  let from = 0
  for (;;) {
    const at = text.indexOf('<DialogContent', from)
    if (at < 0) return out
    let depth = 0
    let index = at
    for (; index < text.length; index++) {
      const char = text[index]
      if (char === '{') depth++
      else if (char === '}') depth--
      else if (depth === 0 && char === '>') break
    }
    out.push(text.slice(at, index + 1))
    from = index + 1
  }
}
