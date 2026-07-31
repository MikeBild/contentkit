import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

// Past the barrel, deliberately: `cockpit-behavioural-floor.test.mjs` proves a
// module is really rendered by finding the test that imports it, directly or one
// hop away, and `@/forms/fields` is two hops from `field.tsx`. The four
// specifiers below are what makes the coverage claim checkable.
import { EnumSelect, SwitchField } from './choice'
import { ScopePicker } from './scopes'
import { TextField } from './text'

/**
 * What a screen reader gets out of a field in this console.
 *
 * `FieldShell` is the one place that labels, describes and marks-invalid every
 * control in the cockpit. Its whole contract is four attributes it hands to the
 * control — `id` matched by the label's `htmlFor`, `aria-describedby`,
 * `aria-invalid`, `disabled` — and until this file existed not one of them was
 * asserted anywhere that could see them. The suite that claimed to guard the
 * shell read its source text: it grepped `fields/field.tsx` for the *string*
 * `aria-describedby` and for the *string* `aria-invalid`, found both, and
 * declared the wiring sound. Three mutations were applied to prove the point —
 * pointing `htmlFor` at an id nothing carries, returning `undefined` for
 * `aria-describedby`, returning `undefined` for `aria-invalid` on error — and
 * all three left every string the greps look for exactly where it was, so all
 * three were green. Two edits could have unlabelled every control in the
 * console and unlinked every error message, and nothing would have gone red.
 *
 * So nothing here reads the source. Each test renders a real field component,
 * asks the DOM the questions assistive technology asks — what is this control
 * called, what does it say about itself, is it marked wrong, is it operable —
 * and never once looks up an attribute to decide which element it means.
 * `getByLabelText` is the assertion: if it finds the control, the label really
 * does address it; if the label is aimed anywhere else, the query finds nothing
 * and the test cannot proceed. `toHaveAccessibleName` and
 * `toHaveAccessibleDescription` run the full accessible-name computation, so a
 * name that happens to be right for the wrong reason still counts as a name and
 * a link that dangles does not.
 *
 * Three field shapes are driven rather than one, because the shell's contract is
 * only ever met by composition and the three compose it differently: a native
 * `<input>` takes the whole prop bag, a native `<select>` takes it too but is a
 * different labelable element, a `role="switch"` button takes the pieces one at
 * a time and had silently dropped `aria-invalid` on the floor, and a checkbox
 * group is not a labelable element at all so it has to name itself. Any of them
 * can be broken without the others noticing — which is exactly what had
 * happened.
 */

function noop() {}

/** The four fields, each in the state that makes the shell's promises checkable. */
const LABEL = {
  text: 'Site name',
  select: 'Visibility',
  toggle: 'Enable feedback',
  scopes: 'Scopes',
} as const

function renderText(props: Partial<Parameters<typeof TextField>[0]> = {}) {
  render(
    <TextField
      data-testid="ck-field-text"
      label={LABEL.text}
      value=""
      onChange={noop}
      {...(props as Record<string, never>)}
    />,
  )
  return screen.getByTestId('ck-field-text-control')
}

function renderSelect(props: Record<string, unknown> = {}) {
  render(
    <EnumSelect
      data-testid="ck-field-select"
      label={LABEL.select}
      value=""
      onChange={noop}
      options={[
        { value: 'public', label: 'Public' },
        { value: 'private', label: 'Private' },
      ]}
      {...props}
    />,
  )
  return screen.getByTestId('ck-field-select-control')
}

function renderToggle(props: Record<string, unknown> = {}) {
  render(
    <SwitchField data-testid="ck-field-toggle" label={LABEL.toggle} value={false} onChange={noop} {...props} />,
  )
  return screen.getByTestId('ck-field-toggle-control')
}

function renderScopes(props: Record<string, unknown> = {}) {
  render(
    <ScopePicker
      data-testid="ck-field-scopes"
      label={LABEL.scopes}
      value={[]}
      ceiling={['*']}
      onChange={noop}
      {...props}
    />,
  )
  return screen.getByTestId('ck-field-scopes-control')
}

describe('a field is called what its label says', () => {
  // `getByLabelText` is the whole assertion. It resolves the label the way the
  // platform does and returns the element the label addresses; a label aimed at
  // an id nothing carries returns no element and throws here, which is the only
  // way the htmlFor/id link can be checked without reading it out of the source.
  it('a text field', () => {
    const control = renderText({ help: 'Shown in the browser tab.' })
    expect(screen.getByLabelText(LABEL.text)).toBe(control)
    expect(control).toHaveAccessibleName(LABEL.text)
  })

  it('a select', () => {
    const control = renderSelect({ help: 'Who may read the site.' })
    expect(screen.getByLabelText(LABEL.select)).toBe(control)
    expect(control).toHaveAccessibleName(LABEL.select)
  })

  it('a switch', () => {
    const control = renderToggle({ help: 'Readers may leave a note.' })
    expect(screen.getByLabelText(LABEL.toggle)).toBe(control)
    expect(control).toHaveAccessibleName(LABEL.toggle)
  })

  it('a checkbox group, which is not a labelable element and must name itself', () => {
    const group = renderScopes({ help: 'What a key made here may do.' })
    expect(group).toHaveAccessibleName(LABEL.scopes)
    // A `<div>` cannot be the target of a `<label>`, so the group carries its own
    // name — but the label's `htmlFor` must still resolve to something, or the
    // shell is emitting a reference to an element that does not exist.
    expect(screen.getByLabelText(LABEL.scopes)).toBe(group)
  })

  it('clicking the label puts the caret in the control', async () => {
    // The same link from the other side: `htmlFor` is what makes a label
    // clickable, and jsdom implements the activation-behaviour forwarding.
    const control = renderText()
    await userEvent.click(screen.getByText(LABEL.text))
    expect(control).toHaveFocus()
  })
})

describe('help reaches the control as its accessible description', () => {
  it('a text field', () => {
    const control = renderText({ help: 'Shown in the browser tab.' })
    expect(control).toHaveAccessibleDescription('Shown in the browser tab.')
  })

  it('a select', () => {
    const control = renderSelect({ help: 'Who may read the site.' })
    expect(control).toHaveAccessibleDescription('Who may read the site.')
  })

  it('a switch', () => {
    const control = renderToggle({ help: 'Readers may leave a note.' })
    expect(control).toHaveAccessibleDescription('Readers may leave a note.')
  })

  it('a checkbox group', () => {
    // With a scope chosen the picker raises no error of its own, so the
    // description is the help sentence and nothing else.
    const group = renderScopes({ help: 'What a key made here may do.', value: ['content:read'] })
    expect(group).toHaveAccessibleDescription('What a key made here may do.')
  })

  it('the fallback sentence is part of the description, not decoration', () => {
    // "empty is not broken" is the whole reason `fallback` exists; a sentence
    // only sighted operators receive would not do that job.
    const control = renderText({ fallback: 'Falls back to the site name.' })
    expect(control).toHaveAccessibleDescription('Falls back to the site name.')
  })

  it('a field with nothing to say has no description at all', () => {
    // The complement of the tests above: an empty `aria-describedby`, or one
    // naming an element that was never rendered, is a dangling reference — and a
    // dangling reference reads as an empty description, which would let every
    // assertion above pass for the wrong reason if the ids were mismatched.
    const control = renderText()
    expect(control).toHaveAccessibleDescription('')
    expect(control).not.toHaveAttribute('aria-describedby', '')
  })
})

describe('an error is linked, announced, and marks the control invalid', () => {
  it('a text field', () => {
    const control = renderText({ help: 'Shown in the browser tab.', error: 'Already taken' })
    expect(control).toHaveAccessibleDescription(/Already taken/)
    expect(control).toBeInvalid()
    expect(control).toHaveAttribute('aria-invalid', 'true')
  })

  it('a select', () => {
    const control = renderSelect({ error: 'Pick one' })
    expect(control).toHaveAccessibleDescription(/Pick one/)
    expect(control).toBeInvalid()
    expect(control).toHaveAttribute('aria-invalid', 'true')
  })

  it('a switch', () => {
    // This one was wrong: the switch took `id` and `aria-describedby` from the
    // shell and never passed `aria-invalid` on, so a refused boolean was red and
    // nothing else. Nothing failed, because nothing looked.
    const control = renderToggle({ error: 'Not available on this plan' })
    expect(control).toHaveAccessibleDescription(/Not available on this plan/)
    expect(control).toHaveAttribute('aria-invalid', 'true')
  })

  it('a checkbox group marks its boxes, which is where aria-invalid is allowed', () => {
    const group = renderScopes()
    expect(group).toHaveAccessibleDescription(/Choose at least one scope/)
    expect(screen.getByTestId('ck-field-scopes-control-content:read')).toHaveAttribute('aria-invalid', 'true')
  })

  it('the error is a live region, so an operator who has moved on still hears it', () => {
    // Being the control's description is not enough on its own: a description is
    // read when the control is reached, and a save refused after the operator
    // tabbed away would be silent. `role="alert"` is what interrupts.
    renderText({ error: 'Already taken' })
    expect(screen.getByRole('alert')).toHaveTextContent('Already taken')
    expect(screen.getByTestId('ck-field-text-error')).toBe(screen.getByRole('alert'))
  })

  it('a field with no error is not marked invalid', () => {
    expect(renderText({ help: 'Shown in the browser tab.' })).not.toBeInvalid()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('two things to say at once, and neither is dropped', () => {
  it('a hint and an error survive each other', () => {
    // `maxLength` produces both at the same time and from the same fact: the
    // counter says 8/5 and the error says what to do about it. Earlier shapes of
    // this shell reused one id for both messages, which silently drops whichever
    // one loses.
    const control = renderText({ help: 'Shown in listings.', maxLength: 5, value: 'abcdefgh' })
    expect(screen.getByTestId('ck-field-text-hint')).toHaveTextContent('8/5')
    expect(control).toHaveAccessibleDescription(/3 characters over the limit/)
    expect(screen.getByRole('alert')).toHaveTextContent('3 characters over the limit')
    expect(control).toBeInvalid()
  })

  it('help and an error are both in the description, help first', () => {
    // The order is the promise the shell's own comment makes: the operator hears
    // what the field is for before hearing what is wrong with it.
    const control = renderText({ help: 'Shown in the browser tab.', error: 'Already taken' })
    expect(control).toHaveAccessibleDescription('Shown in the browser tab. Already taken')
  })

  it('a warning with no error is linked too', () => {
    const control = renderText({ warning: 'This domain is not pointed here yet' })
    expect(control).toHaveAccessibleDescription('This domain is not pointed here yet')
    expect(control).not.toBeInvalid()
  })
})

describe('a disabled field says so in the accessibility tree', () => {
  it('a text field', () => {
    renderText({ disabled: true })
    expect(screen.getByLabelText(LABEL.text)).toBeDisabled()
  })

  it('a select', () => {
    renderSelect({ disabled: true })
    expect(screen.getByLabelText(LABEL.select)).toBeDisabled()
  })

  it('a switch', () => {
    renderToggle({ disabled: true })
    expect(screen.getByLabelText(LABEL.toggle)).toBeDisabled()
  })

  it('a checkbox group disables every box in it', () => {
    renderScopes({ disabled: true })
    expect(screen.getByTestId('ck-field-scopes-control-content:read')).toBeDisabled()
  })

  it('a disabled field is not reachable by keyboard', async () => {
    // `disabled` on the element rather than a class that only looks disabled: the
    // difference is whether Tab stops there.
    renderText({ disabled: true })
    await userEvent.tab()
    expect(screen.getByLabelText(LABEL.text)).not.toHaveFocus()
  })
})

describe('every reference the shell emits resolves', () => {
  /** The general form of the two mutations above, applied to whatever is on screen. */
  function auditReferences() {
    for (const label of Array.from(document.querySelectorAll('label[for]'))) {
      const target = label.getAttribute('for') as string
      expect(document.getElementById(target), `<label for="${target}"> addresses nothing`).not.toBeNull()
    }
    for (const element of Array.from(document.querySelectorAll('[aria-describedby]'))) {
      for (const token of (element.getAttribute('aria-describedby') as string).split(/\s+/).filter(Boolean)) {
        expect(document.getElementById(token), `aria-describedby="${token}" addresses nothing`).not.toBeNull()
      }
    }
  }

  it('with everything the shell can render at once', () => {
    renderText({ help: 'Shown in the browser tab.', fallback: 'Falls back to the slug.', error: 'Already taken', required: true })
    renderSelect({ help: 'Who may read the site.', warning: 'Private sites are still built' })
    renderToggle({ help: 'Readers may leave a note.', error: 'Not available on this plan' })
    renderScopes({ help: 'What a key made here may do.' })
    auditReferences()
  })

  it('and with nothing but a label', () => {
    renderText()
    renderSelect()
    renderToggle()
    renderScopes({ value: ['content:read'] })
    auditReferences()
  })
})
