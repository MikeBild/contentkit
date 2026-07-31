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
 * screen reader is told about. Those four are what this file asserts: how they
 * are *met* is decided in the component, so that half is read there — but
 * whether they are *broken* is a question about the whole console, and it is now
 * asked of every `.tsx` under apps/cockpit/src. Asked of `confirm.tsx` alone,
 * all four passed for as long as `components/ui/dialog.tsx` was a `role="dialog"`
 * div under thirteen modules. Then the thing that must stay true of the
 * twenty-five call sites: the API they were written against is the API they
 * still get, and no page answers a mutation through a confirmation of its own.
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
    assert.match(body, /<Alert variant="destructive"[^>]*data-testid=\{id\('error'\)\}/, 'the refusal is an Alert')
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
    const refusal = body.indexOf("data-testid={id('error')}")
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
    assert.match(
      body,
      /data-testid=\{id\('cancel'\)\}[^>]*\n?[^>]*disabled=\{isBusy\}/s,
      'Cancel stands down while busy',
    )
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
    // In two halves, because the names are no longer all written on the elements.
    // What an operator *reads* carries its name literally. What a script *clicks*
    // is addressed through `id()`, so that the two confirmations older than this
    // component — the site delete and the site identity change, both driven by
    // name in scripts/verify-cockpit-prod.md — keep the names that runbook uses
    // instead of the runbook being rewritten to suit a refactor.
    for (const id of ['confirm-title', 'confirm-description']) {
      assert.match(body, new RegExp(`data-testid="${id}"`), `${id} is addressable in the browser`)
    }
    const defaults = /const DEFAULT_IDS[^}]*\}/.exec(body)?.[0]
    assert.ok(defaults, 'the default names are declared in one place')
    for (const part of ['dialog', 'cancel', 'accept', 'error']) {
      assert.match(
        body,
        new RegExp(`data-testid=\\{id\\('${part}'\\)\\}`),
        `the ${part} is addressed through the name the call site may set`,
      )
      assert.match(defaults, new RegExp(`${part}: 'confirm-${part}'`), `and unnamed it stays confirm-${part}`)
    }
    // An override that is not read is a prop, not a promise.
    assert.match(body, /ids\?\.\[part\] \?\? DEFAULT_IDS\[part\]/, 'a call site’s own name is what wins')
  })
})

describe('Cockpit confirmation: nobody hand-rolls the modal it replaced', () => {
  /**
   * Old scope: `components/confirm.tsx`, four `doesNotMatch` assertions.
   * New scope: every `.tsx` under apps/cockpit/src, the same four rules.
   *
   * The four rules were right and the file they were asked of was one of the
   * twenty-six they were true of. While they read confirm.tsx alone,
   * `components/ui/dialog.tsx` was a `role="dialog"` div with a hand-written
   * `aria-modal`, a `fixed inset-0` backdrop that closed on a stray mousedown and
   * a focus trap over a selector string — under thirteen modules — and this file
   * reported nothing, because the one component that had never had the defect was
   * the one component it looked at. A guard whose subject is a filename certifies
   * a filename.
   *
   * Asked of the tree, the same four sentences are a rule about the console: the
   * accessibility of a modal is not a property of `confirm.tsx`, it is a property
   * of every overlay an operator can be standing in front of.
   */
  const stripped = sources().map(([name, text]) => [name, stripComments(text)])

  /**
   * A backdrop has to be written once per vendored primitive, or there is no
   * overlay at all — the same exemption `cockpit-one-stack.test.mjs` gives
   * `skeleton.tsx` for its pulse. It is granted by what the file renders, not by
   * its name: only a module that draws a Radix `*Primitive.Overlay` may declare
   * `fixed inset-0`, so a page that grows its own backdrop is reported however it
   * is spelled, and a vendored overlay stays legal without being listed here.
   */
  const drawsRadixOverlay = (text) => /<\w+Primitive\.Overlay\b/.test(text)

  test('no module writes the aria-modal or the role that a primitive is supposed to earn', () => {
    const claimed = []
    for (const [name, text] of stripped) {
      if (/aria-modal/.test(text))
        claimed.push(`${name}: writes aria-modal by hand — Radix emits it only where it is true`)
      if (/role="dialog"/.test(text)) claimed.push(`${name}: writes role="dialog" — the role comes with the focus trap`)
    }
    assert.deepEqual(claimed, [], `a claim is not an effect:\n${claimed.join('\n')}`)
  })

  test('no module draws its own backdrop', () => {
    const backdrops = []
    for (const [name, text] of stripped) {
      if (!/fixed inset-0/.test(text)) continue
      if (drawsRadixOverlay(text)) continue
      backdrops.push(`${name}: a hand-drawn overlay — compose Dialog, AlertDialog or Sheet instead`)
    }
    assert.deepEqual(backdrops, [], backdrops.join('\n'))
  })

  test('no overlay in the console is answered by a click that lands outside it', () => {
    // Generalised from the one spelling confirm.tsx once had
    // (`event.currentTarget) … setOpen(false)`) to the shape: a pointer handler
    // that decides on `currentTarget` and closes. A press that begins inside a
    // panel and ends on the backdrop — a selection dragged too far, a slider
    // released past its track — must not be able to answer a mutation.
    const dismissive = []
    for (const [name, text] of stripped)
      for (const [hit] of text.matchAll(
        /currentTarget[\s\S]{0,160}?(?:setOpen\(false\)|setIsOpen\(false\)|onOpenChange\(false\)|onClose\(\))/g,
      ))
        dismissive.push(`${name}: ${hit.split('\n')[0].trim()}…`)
    assert.deepEqual(dismissive, [], `an outside click must not answer a mutation:\n${dismissive.join('\n')}`)
  })

  test('every confirmation in the console is the one confirmation, or restores focus like it', () => {
    /**
     * The second confirmation stack, in the shape it actually took.
     *
     * `confirm.tsx` is not the only file that composes an `AlertDialog`: two
     * pages hand-roll their own around the console's most destructive acts —
     * deleting a site, and changing the identity every published URL is built
     * from. Both are careful about `isPending`, both name and describe
     * themselves, and both drop focus on `<body>` when they close, because
     * `@radix-ui/react-dialog`'s modal content cancels its own focus restore and
     * focuses a `DialogTrigger` ref that no call site in this console sets. A
     * keyboard operator who deletes a site is returned to the top of the
     * document, and the row they were working in is gone from under them.
     *
     * So the rule takes the review's own two answers: compose `<Confirm>`, which
     * does the three-shape restore once, or carry `onCloseAutoFocus` and do it
     * here. Nothing else counts, and neither does being careful in every other
     * respect.
     */
    const rolled = []
    for (const [name, text] of stripped) {
      if (name === 'components/confirm.tsx') continue
      for (const call of [...text.matchAll(/<AlertDialogContent\b[\s\S]*?>/g)].map((hit) => hit[0])) {
        if (/onCloseAutoFocus/.test(call)) continue
        rolled.push(`${name}: composes its own AlertDialogContent with no onCloseAutoFocus — focus lands on <body>`)
      }
    }
    assert.deepEqual(rolled, [], `use <Confirm>, or restore focus the way it does:\n${rolled.join('\n')}`)
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

  test('the two confirmations production drives by name still answer to those names', () => {
    // `scripts/verify-cockpit-prod.md` clicks these in a real browser against a
    // real installation. One of them destroys a site: the delete answers twice,
    // and the runbook tells the answer that *asks* from the answer that *purges*
    // by id. Both pages moved onto <Confirm> in this phase, and a rename here
    // would be a rename of a production procedure — silently, and at the one
    // click that cannot be undone.
    const named = {
      'pages/sites.tsx': [
        'ck-site-delete-dialog',
        'ck-site-delete-cancel',
        'ck-site-delete-confirm',
        'ck-site-delete-purge',
        'ck-site-delete-refusal',
        'ck-site-delete-error',
        'ck-site-delete-target',
      ],
      'pages/site-settings.tsx': ['ck-site-identity-confirm', 'ck-site-identity-cancel', 'ck-site-identity-accept'],
    }
    for (const [file, ids] of Object.entries(named)) {
      const text = source(...file.split('/'))
      for (const id of ids) assert.match(text, new RegExp(`['"]${id}['"]`), `${file}: ${id} is what the runbook clicks`)
      // Named parts are still not a second dialog: the page hands the names to
      // the one component and composes no alert dialog of its own.
      assert.match(text, /from '@\/components\/confirm'/, `${file} confirms through the console's own dialog`)
      assert.doesNotMatch(
        text,
        /from '@\/components\/ui\/alert-dialog'/,
        `${file} must not compose a confirmation beside the one it uses`,
      )
    }
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
