import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * One grammar for actions — UI-UX.md §2, graded from source.
 *
 * The console had three affordances doing three different things while looking
 * like one another, and every one of them was a defensible local choice:
 *
 *  - `release-delete` was `ghost`, the same control as `release-expand` beside
 *    it, so an irreversible act and a disclosure were one shape. Eleven more
 *    deletes, revokes, resets and rotations were `ghost` too — every trigger of
 *    a `<Confirm destructive>` in the console.
 *  - `pattern-open`, `guide-open`, `ck-site-warnings-*` and
 *    `assistant-elicitation-open` were link-styled, and none of them changed the
 *    URL: three opened a dialog or an accordion on the page they were already on,
 *    and the fourth called `window.open` — a link with no href, unable to be
 *    middle-clicked, copied or read as a link by anything.
 *  - Fifteen buttons rewrote their own label while the request was in flight:
 *    'Save' → 'Saving…', 'New release' → 'Building…'. The control the operator
 *    aimed at changes width and loses its noun at the moment they arrive.
 *
 * None of that is visible in a screenshot of a page at rest, which is why it
 * came back after each individual fix and why this file exists. Everything here
 * is read off the source, because the rules are about *what a control means* and
 * a rendering test cannot ask that question: a `ghost` delete renders perfectly.
 *
 * Three of §2's four rules are asserted literally. The fourth — "a row of
 * actions is one kind or the other; Details navigates, so it is a link" — is
 * asserted in the only form the console can honour, and this is the correction
 * the document asked for rather than a rule worked around:
 *
 *   Nothing named "Details" in this console navigates. `release-expand-*`,
 *   `ck-audit-expand-*` and `ck-delivery-expand-*` reveal a second row *in
 *   place*; `content-open`, `published-inspect`, `pattern-open-*` and
 *   `guide-open-*` open a dialog. `src/router.tsx` has sixteen routes and not one
 *   of them addresses a record, so there is no URL for any of them to change.
 *   Styling them as links would be a promise the console cannot keep — a
 *   destination that does not exist, a middle-click that does nothing.
 *
 *   So the rule asserted is the one §2 states first: *the rule is about what
 *   happens, never about how it looks*. A link-styled control must navigate; a
 *   control that navigates must be an anchor. That leaves a row like the site
 *   registry's — `ck-sites-settings-*` (a real route) beside `ck-site-delete-*`
 *   (a real mutation) — correctly carrying two grammars, because it is carrying
 *   two meanings.
 *
 * Only committed source is read; nothing here touches a build artefact.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')

/**
 * What the file would show on screen, with the prose about it removed.
 *
 * Every rule below is argued for in a comment beside the code it governs, which
 * means every forbidden shape is also written out, in words, a few lines above
 * the shape that replaced it. An assertion that read the comments would fail on
 * the explanation of why it passes. `[^:]` before `//` keeps `https://` intact.
 */
const code = (text) => text.replaceAll(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1')

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
 * Every opening tag of one element, with the tag itself and the region it holds.
 *
 * Written rather than borrowed because a regex cannot find the end of a JSX
 * opening tag: `onClick={() => setOpen(open ? null : id)}` contains both `>` and
 * `}`, and `className="a > b"` contains a `>` inside a quote. Depth and quote
 * state are tracked, so the tag ends at the first `>` that is neither inside a
 * brace expression nor inside a string.
 *
 * `body` runs to the matching close tag, counting same-named opens on the way so
 * that a nested `<Confirm>` inside a `<Confirm>` would not end the outer one
 * early. Nothing in the console nests today; a future one that did would be
 * measured correctly rather than silently mis-attributed.
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
    const selfClosing = /\/>$/.test(tag)
    let body = ''
    if (!selfClosing) {
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
    out.push({ index: match.index, tag, body, line: src.slice(0, match.index).split('\n').length })
  }
  return out
}

const at = (file, element) => `${file.id}:${element.line}`
const testid = (tag) => /data-testid=[{"]?[`"]?([^"}`\s]+)/.exec(tag)?.[1] ?? '(unnamed)'
/**
 * One brace expression out of an opening tag, balanced.
 *
 * `onClick={() => save.mutate()}` cannot be read with a regex that stops at the
 * first `}` — nor with one that stops at the last, which would swallow the
 * neighbouring `disabled={save.isPending}` and make every Cancel button look
 * like the submit it sits beside. Depth is counted, quotes are respected.
 */
function attribute(tag, name) {
  const start = tag.indexOf(`${name}={`)
  if (start === -1) return null
  let i = start + name.length + 2
  let depth = 1
  let quote = null
  for (; i < tag.length && depth > 0; i++) {
    const c = tag[i]
    if (quote) {
      if (c === quote && tag[i - 1] !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{') depth += 1
    else if (c === '}') depth -= 1
  }
  return tag.slice(start + name.length + 2, i - 1)
}

const variant = (tag) => {
  const literal = /variant="([a-z]+)"/.exec(tag)
  if (literal) return literal[1]
  return /variant=\{/.test(tag) ? 'dynamic' : 'default'
}

/** Every `<Button>` in the console, with the file it is in. */
const buttons = FILES.flatMap((file) => elements(file.src, 'Button').map((element) => ({ file, element })))

describe('cockpit affordances — one grammar for actions', () => {
  test('the sweep found the console, so the rules below are read off real elements', () => {
    assert.ok(buttons.length > 100, `only ${buttons.length} <Button> found — this file would prove nothing`)
    assert.ok(FILES.length > 40, `only ${FILES.length} .tsx found under ${cockpit}`)
  })

  // ── A control that acts is a button; one that navigates is an anchor ────────

  /**
   * The elements a browser gives a role, a tab stop and a keyboard to for free.
   * Everything else with an `onClick` is a control only a mouse can find.
   */
  const INTERACTIVE = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary', 'label', 'option'])

  /**
   * One exemption, named rather than pattern-matched.
   *
   * `components/ui/input-group.tsx` is stock shadcn: the addon forwards a click
   * on the padding around an input to the input itself. It performs no action a
   * keyboard user cannot already perform — the input is one Tab away and the
   * handler explicitly ignores clicks that land on a real button — so it is a
   * hit area, not a control. It is listed here so that the next `<div onClick>`
   * has to be argued for in this file rather than absorbed by a loose selector.
   */
  const CLICKABLE_NON_CONTROLS = new Set(['components/ui/input-group.tsx'])

  test('no div carries onClick — a control that acts is a button', () => {
    const found = []
    for (const file of FILES) {
      if (CLICKABLE_NON_CONTROLS.has(file.id)) continue
      const tags = [...new Set([...file.src.matchAll(/<([a-z][\w-]*)(?=[\s/>])/g)].map((match) => match[1]))]
      for (const name of tags) {
        if (INTERACTIVE.has(name)) continue
        for (const element of elements(file.src, name)) {
          if (/\bonClick=/.test(element.tag)) found.push(`${at(file, element)} <${name} onClick=…>`)
        }
      }
    }
    assert.deepEqual(
      found,
      [],
      `a click handler on a non-interactive element is invisible to a keyboard:\n${found.join('\n')}`,
    )
  })

  /**
   * The two places the document is handed to somewhere else, and why neither is
   * an anchor.
   *
   * `sign-out` runs `ck.identity.logout()` first and redirects with what comes
   * back: the navigation is the *result* of a mutation, which is a button by
   * §2's own definition. `sign-in` leaves the SPA for the identity provider —
   * a document handoff rather than a route, and the one case here that could
   * honestly become an `<a href>`; it is named rather than matched so that
   * making it one is a deliberate edit to this list, and a third entry has to be
   * argued for.
   *
   * `window.open` is on nobody's list. Opening a page in a new tab is the plain
   * meaning of a link, and a button that does it has no href to middle-click, no
   * URL to copy and nothing to say to a reader that goes looking for the links.
   */
  const DOCUMENT_HANDOFF = new Set(['app/shell.tsx', 'components/session-gate.tsx'])

  test('navigation is an anchor, never a click handler that opens a window', () => {
    const found = []
    for (const file of FILES) {
      const pattern = DOCUMENT_HANDOFF.has(file.id)
        ? /window\.open\(/g
        : /window\.open\(|location\.href\s*=|location\.assign\(/g
      for (const call of file.src.matchAll(pattern)) {
        found.push(`${file.id}:${file.src.slice(0, call.index).split('\n').length} ${call[0]}`)
      }
    }
    assert.deepEqual(
      found,
      [],
      `navigating from a click handler is a link with no href — nothing to middle-click, copy or read as a link:\n${found.join('\n')}`,
    )
  })

  // ── Link means the URL changes; nothing else may look like one ──────────────

  test('a link-styled control navigates, and nothing else wears the style', () => {
    const found = []
    for (const { file, element } of buttons) {
      if (variant(element.tag) !== 'link') continue
      const wrapsAnchor = /\basChild\b/.test(element.tag) && /<(a|AppLink|Link)(?=[\s/>])/.test(element.body)
      if (!wrapsAnchor) {
        found.push(`${at(file, element)} ${testid(element.tag)} is styled as a link but wraps no anchor`)
      }
      if (/\bonClick=/.test(element.tag)) {
        found.push(
          `${at(file, element)} ${testid(element.tag)} is styled as a link and handles a click instead of navigating`,
        )
      }
    }
    assert.deepEqual(
      found,
      [],
      `variant="link" promises a URL: a dialog, an accordion or a mutation behind one is a destination that does not exist:\n${found.join('\n')}`,
    )
  })

  /**
   * The three row controls that reveal a record without leaving the page share
   * one grammar, and it is not the link's. `ghost` plus `aria-expanded` says
   * "there is more of this row here" in a way a screen reader can also read; the
   * label pair Details/Hide is the state, not a rewrite.
   */
  test('an in-place disclosure is ghost and says which state it is in', () => {
    const disclosures = buttons.filter(({ element }) => /'Hide'\s*:\s*'Details'/.test(element.body))
    assert.ok(disclosures.length >= 3, `only ${disclosures.length} Details/Hide controls found`)
    const wrong = []
    for (const { file, element } of disclosures) {
      if (variant(element.tag) !== 'ghost') wrong.push(`${at(file, element)} is ${variant(element.tag)}, not ghost`)
      if (!/aria-expanded=/.test(element.tag)) wrong.push(`${at(file, element)} does not say whether it is open`)
    }
    assert.deepEqual(
      wrong,
      [],
      `Details reveals a row; it is one control everywhere or it is not a grammar:\n${wrong.join('\n')}`,
    )
  })

  // ── destructive means irreversible, and the console already knows which ─────

  /**
   * `<Confirm destructive>` is the console's own declaration that an act cannot
   * be undone — it is what turns the dialog's accept button red and what the
   * copy beside it says in words. The trigger is the control the operator
   * decides on *before* any dialog exists, so it carries the same claim.
   *
   * Twelve of the sixteen did not: eleven `ghost` and one `outline`, which made
   * `release-delete` and `release-expand` the same control to look at.
   */
  test('every trigger of an irreversible confirmation is a destructive button', () => {
    const wrong = []
    let checked = 0
    for (const file of FILES) {
      for (const confirm of elements(file.src, 'Confirm')) {
        if (!/^\s*destructive\s*$/m.test(confirm.tag)) continue
        const trigger = elements(confirm.body, 'Button')[0]
        if (!trigger) continue
        checked += 1
        if (variant(trigger.tag) !== 'destructive') {
          wrong.push(`${at(file, confirm)} ${testid(trigger.tag)} is ${variant(trigger.tag)}`)
        }
      }
    }
    assert.ok(checked >= 15, `only ${checked} destructive confirmations found — the console had sixteen`)
    assert.deepEqual(
      wrong,
      [],
      `the dialog calls this irreversible; the button that opens it says the same:\n${wrong.join('\n')}`,
    )
  })

  // ── One primary action per surface ─────────────────────────────────────────

  /**
   * A page module gets one filled button: the thing the page exists for.
   *
   * Scoped to `pages/` on purpose. A dialog is its own surface and owns its own
   * primary — `forms/site/wizard.tsx` has two `default` buttons that are the two
   * halves of one step gate (`Next` until the summary, then `Create site`) and
   * are never on screen together, and `forms/audience/groups.tsx` has one per
   * dialog. Counting those as violations would push the console's submit buttons
   * to `outline` and leave every form without a primary at all.
   */
  test('one filled button per page — the default variant is what the page is for', () => {
    const wrong = []
    let pages = 0
    for (const file of FILES) {
      if (!file.id.startsWith('pages/')) continue
      pages += 1
      const filled = elements(file.src, 'Button').filter((element) => {
        const kind = variant(element.tag)
        return kind === 'default' || (kind === 'dynamic' && /variant=\{[^}]*['"]default['"]/.test(element.tag))
      })
      if (filled.length > 1) {
        wrong.push(`${file.id}: ${filled.length} — ${filled.map((element) => testid(element.tag)).join(', ')}`)
      }
    }
    assert.ok(pages >= 10, `only ${pages} page modules found`)
    assert.deepEqual(
      wrong,
      [],
      `two filled buttons ask the reader to choose without saying which is which:\n${wrong.join('\n')}`,
    )
  })

  // ── A button keeps its label while it works ────────────────────────────────

  /**
   * The label is the promise; the spinner is the state.
   *
   * `{save.isPending ? 'Saving…' : 'Save'}` fails three ways at once: the
   * control changes width under the pointer, the noun that said *what* was being
   * saved is gone at the moment the operator looks for it, and a screen reader
   * announces a new accessible name for a control that never moved.
   * `components/ui/spinner.tsx` was built for this and documents the shape:
   * `disabled` plus `<Spinner data-icon="inline-start" />`, label untouched.
   *
   * A ternary on something that is not a pending flag is left alone —
   * `{editing ? 'Save rule' : 'Create rule'}` and `{open ? 'Hide' : 'Details'}`
   * are two different controls and two different acts, not one control changing
   * its mind mid-request.
   */
  const IN_FLIGHT =
    /\b[\w.]*(?:isPending|isSaving|isBuilding|isLoading|isFetching|isSubmitting|isRunning)\b\s*\?\s*['"`]/

  test('no button rewrites its own label while it works', () => {
    const found = []
    for (const { file, element } of buttons) {
      const swap = IN_FLIGHT.exec(element.body) ?? IN_FLIGHT.exec(element.tag)
      if (swap) found.push(`${at(file, element)} ${testid(element.tag)}: ${swap[0].trim()}…`)
    }
    assert.deepEqual(
      found,
      [],
      `Spinner + disabled, and the label stays — the button the reader aimed at must still be there when they arrive:\n${found.join('\n')}`,
    )
  })

  /**
   * The other half of that rule, and the reason the first half is safe: a button
   * that hides its pending state entirely is not an improvement on one that
   * announces it in the wrong place. Deleting `'Saving…'` and putting nothing in
   * its place would pass the test above and leave the operator with a control
   * that has gone dead for no stated reason.
   *
   * Only the button that *starts* the request is asked to answer for it, and
   * that is read off the code rather than guessed: `disabled={save.isPending}`
   * next to an `onClick` that mentions `save` is the submit. The Cancel beside
   * it is disabled by the same flag and is not the thing in flight — it has
   * nothing to spin about, and a spinner on it would claim it was working.
   */
  test('the button that starts a request shows that it is running', () => {
    const found = []
    let checked = 0
    for (const { file, element } of buttons) {
      const disabled = attribute(element.tag, 'disabled')
      if (!disabled) continue
      const flag = /\b(\w+)\.(?:isPending|isLoading)\b/.exec(disabled)
      if (!flag) continue
      const click = attribute(element.tag, 'onClick')
      if (!click || !new RegExp(`\\b${flag[1]}\\.`).test(click)) continue
      checked += 1
      if (!element.body.includes('<Spinner')) {
        found.push(`${at(file, element)} ${testid(element.tag)} runs ${flag[1]} and says nothing while it does`)
      }
    }
    assert.ok(checked >= 5, `only ${checked} self-disabling submits found — this rule would prove nothing`)
    assert.deepEqual(
      found,
      [],
      `a control that has gone dead with no explanation reads as broken:\n${found.join('\n')}`,
    )
  })
})
