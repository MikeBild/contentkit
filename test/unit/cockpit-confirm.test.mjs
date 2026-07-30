import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The console's own human confirmation.
 *
 * ContentKit's MCP surface refuses to publish, activate, unpublish or touch a
 * credential without a native human confirmation, and states that the model must
 * never infer one — decline, cancel, timeout and unsupported elicitation all make
 * no change. `components/confirm.tsx` is the console's half of that promise: every
 * delete, every credential issue, every unpublish is answered through it.
 *
 * A `<div>` that carries `aria-modal="true"` is not that. It names the role and
 * enforces none of it: Escape does nothing, focus is free to leave, the control
 * that opened it is not focused again, and a server's refusal is red text no
 * screen reader is told about. Those four are what this file asserts, at the one
 * place they can be decided — the component — plus the thing that must stay true
 * of the twenty-five call sites: the API they were written against is the API
 * they still get.
 *
 * The Cockpit has no test runner, so this reads committed source. Nothing here
 * touches a generated artefact.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const source = (...parts) => readFileSync(join(cockpit, ...parts), 'utf8')

const confirm = source('components', 'confirm.tsx')
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const body = stripComments(confirm)

/** Every `.tsx` under apps/cockpit/src, with its path — the call sites are found, not listed. */
const sources = () => {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx')) found.push([full.slice(cockpit.length + 1), readFileSync(full, 'utf8')])
    }
  }
  walk(cockpit)
  return found
}

/** Each `<Confirm …>…</Confirm>` in a file, whole. */
const confirmations = (text) => [...text.matchAll(/<Confirm\b[\s\S]*?<\/Confirm>/g)].map((hit) => hit[0])

describe('Cockpit confirmation: the dialog is a real one', () => {
  test('it is an AlertDialog, and not a div wearing the word modal', () => {
    assert.match(body, /from '@\/components\/ui\/alert-dialog'/, 'the vendored AlertDialog is what this is built on')
    for (const part of [
      'AlertDialogContent',
      'AlertDialogHeader',
      'AlertDialogTitle',
      'AlertDialogDescription',
      'AlertDialogFooter',
      'AlertDialogAction',
      'AlertDialogCancel',
    ]) {
      assert.match(body, new RegExp(`<${part}\\b`), `${part} is part of the composition`)
    }
    // The four failures of the hand-rolled dialog, asserted as the absence of the
    // markup that had them: no role or aria-modal of ours to claim what nothing
    // enforced, and no backdrop of ours to dismiss a mutation on a stray click.
    assert.doesNotMatch(body, /aria-modal/, 'aria-modal is Radix’s to emit, and only where it is true')
    assert.doesNotMatch(body, /role="dialog"/, 'the role comes with the primitive that traps focus')
    assert.doesNotMatch(body, /fixed inset-0/, 'the overlay is AlertDialogContent’s own')
    assert.doesNotMatch(body, /event\.currentTarget\) .*setOpen\(false\)/, 'an outside click must not answer it')
  })

  test('the title and the description are the dialog’s own, so it is named and described', () => {
    assert.match(body, /<AlertDialogTitle[^>]*>\{title\}/, 'the title Radix binds to aria-labelledby')
    assert.match(body, /<AlertDialogDescription[^>]*>\{description\}/, 'and the sentence it binds to aria-describedby')
  })

  test('a refusal is announced, not merely coloured', () => {
    // The whole defect in one line: `<p className="text-sm text-chart-5">` said
    // "this failed" to the eye and to nobody else. `Alert` carries role="alert",
    // which is a live region, so the server's own words reach a screen reader the
    // moment they appear.
    assert.match(body, /from '@\/components\/ui\/alert'/)
    assert.match(body, /<Alert variant="destructive"[^>]*data-testid="confirm-error"/, 'the refusal is an Alert')
    assert.match(body, /<AlertDescription[^>]*>\{error\}/, 'carrying the server’s own message')
    assert.doesNotMatch(body, /text-chart-5|text-destructive"/, 'severity is the variant’s, never a colour of ours')
    // Radix's own Alert is where role="alert" lives; restating it here would be a
    // second rule to keep in step with the first.
    assert.match(
      readFileSync(join(cockpit, 'components', 'ui', 'alert.tsx'), 'utf8'),
      /role="alert"/,
      'and the Alert this leans on is the one that announces',
    )
    // The refusal does not replace what was going to happen: both are on screen,
    // or the operator is asked to retry a sentence they can no longer read.
    const refusal = body.indexOf('data-testid="confirm-error"')
    assert.ok(refusal > body.indexOf('{description}'), 'the description is still above it')
    assert.ok(refusal < body.indexOf('<AlertDialogFooter'), 'and the buttons are still below it')
  })

  test('the answer closes the dialog — the click does not', () => {
    // AlertDialogAction closes on click by design. The mutation has not answered
    // yet at that point, so a dialog that let it through would report a success it
    // has not had, and a refusal would arrive with nothing left on screen to
    // carry it.
    const action = /<AlertDialogAction[\s\S]*?<\/AlertDialogAction>/.exec(body)?.[0]
    assert.ok(action, 'there is an accept button')
    assert.match(action, /event\.preventDefault\(\)/, 'the close is refused until the mutation answers')
    assert.match(action, /run\(\)/)
    assert.match(body, /await onConfirm\(\)\s*\n\s*setOpen\(false\)/, 'and success is what closes it')
    assert.match(body, /catch \(failure\)[\s\S]{0,160}setError\(/, 'a refusal keeps it open and says why')
  })

  test('a mutation in flight cannot be dismissed out from under itself', () => {
    assert.match(body, /onOpenChange=\{\(next\) => \{\s*\n[\s\S]{0,80}if \(isBusy\) return/, 'not by Escape or Cancel')
    assert.match(body, /onEscapeKeyDown=\{\(event\) => \{\s*\n\s*if \(isBusy\) event\.preventDefault\(\)/)
    assert.match(body, /data-testid="confirm-cancel"[^>]*\n?[^>]*disabled=\{isBusy\}/s, 'Cancel stands down while busy')
  })

  test('working is said with a spinner beside the label, not by moving the label', () => {
    // 'Revoke key' → 'Working…' changed the width of the control under the pointer
    // and dropped the noun that said what was being revoked.
    assert.doesNotMatch(body, /'Working…'|Working…/, 'the label stays put')
    assert.match(body, /isBusy \? <Spinner[^>]*\/> : null/, 'the spinner appears beside it')
    assert.match(body, /<Spinner[^>]*aria-hidden="true"/, 'silently: the button’s own label already says it')
    assert.match(body, /aria-busy=\{isBusy\}/, 'and the control says it is busy, which is what is announced')
  })

  test('every control in it is addressable', () => {
    for (const id of ['confirm-dialog', 'confirm-title', 'confirm-description', 'confirm-cancel', 'confirm-accept']) {
      assert.match(body, new RegExp(`data-testid="${id}"`), `${id} is addressable in the browser`)
    }
  })
})

describe('Cockpit confirmation: what the call sites see', () => {
  const callers = sources().filter(([, text]) => text.includes('<Confirm'))

  test('every mutation still reaches it through the same API', () => {
    assert.ok(callers.length > 0, 'no <Confirm> found anywhere, so this test proves nothing')
    let count = 0
    for (const [name, text] of callers) {
      assert.match(text, /from '@\/components\/confirm'/, `${name} imports it from the one place it lives`)
      for (const call of confirmations(text)) {
        count++
        const head = call.slice(0, call.indexOf('>') + 1)
        assert.match(head, /\btitle=/, `${name}: a confirmation with no title names nothing`)
        assert.match(call, /\bdescription=/, `${name}: and one with no description states no effect`)
        assert.match(call, /\bonConfirm=/, `${name}: nothing to confirm`)
        // The trigger is the caller's own control, so the caller's scope check,
        // disabled state and testid stay on it. That is the whole reason this is a
        // render prop rather than an AlertDialogTrigger.
        assert.match(call, /\{\(\w+\) => \(/, `${name}: the trigger is still the caller's own control`)
      }
    }
    assert.ok(count >= 20, `only ${count} confirmations found — the console had twenty-five`)
  })

  test('no mutation invents a second confirmation of its own', () => {
    // The point of one component is that the bar is kept in one place. A page that
    // rolls its own `window.confirm` has opted out of every guarantee above: the
    // browser's own box cannot say which key, which site or what cannot be undone,
    // and in this console it would be the one mutation nobody could style, test or
    // read out.
    for (const [name, text] of sources()) {
      assert.doesNotMatch(
        stripComments(text),
        /(^|[^.\w])(window\.confirm|confirm)\s*\(/m,
        `${name} confirms outside the component that does it`,
      )
    }
  })
})
