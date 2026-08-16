import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Confirm } from '@/components/confirm'

/**
 * The dialog every destructive operation in this console goes through.
 *
 * Its docblock makes four promises in bold — Escape cancels, focus is trapped
 * **and then given back**, the refusal is announced, nothing is dismissed
 * mid-flight — and the suite that guards it reads source text. Finding
 * `<AlertDialogContent` in a file is not evidence that focus was trapped, and it
 * is certainly not evidence that focus came back: an explicit
 * `onCloseAutoFocus={(e) => e.preventDefault()}` on this very component survived
 * a full 940-test run with nothing red.
 *
 * So these tests never look at the source. They render the component, drive it
 * with a keyboard and a pointer the way an operator does, and then ask the DOM
 * what a screen reader and a Tab key would get.
 */

/** A trigger with something focusable on either side, so "focus went back to the
 *  trigger" cannot be satisfied by accident. */
function Harness({
  onConfirm,
  disableTriggerWhileBusy = false,
}: {
  onConfirm: () => Promise<unknown> | unknown
  /** What every real call site does: `<Button disabled={mutation.isPending}>`. */
  disableTriggerWhileBusy?: boolean
}) {
  // `isPending` is the mutation's own flag, exactly as react-query supplies it:
  // true for the life of the request and false the instant it settles — which is
  // the same instant the dialog closes. That race is the call sites' real shape,
  // not an invention of this harness.
  const [isPending, setPending] = useState(false)
  const run = async () => {
    setPending(true)
    try {
      return await onConfirm()
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <button data-testid="before">Before</button>
      <Confirm
        title="Delete this site?"
        description="Everything published under it stops being served."
        confirmLabel="Delete site"
        destructive
        onConfirm={disableTriggerWhileBusy ? run : onConfirm}
      >
        {(open) => (
          <button data-testid="confirm-trigger" disabled={disableTriggerWhileBusy && isPending} onClick={open}>
            Delete site
          </button>
        )}
      </Confirm>
      <button data-testid="after">After</button>
    </div>
  )
}

describe('Confirm — the dialog every destructive operation goes through', () => {
  it('keeps localized actions and opaque identifiers inside a responsive dialog', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => {}} />)

    await user.click(screen.getByTestId('confirm-trigger'))
    const dialog = await screen.findByRole('alertdialog')
    const footer = dialog.querySelector('[data-slot="alert-dialog-footer"]')
    const description = screen.getByTestId('confirm-description')

    expect(dialog).toHaveClass('w-[calc(100%-2rem)]', 'data-[size=default]:max-w-lg', 'min-w-0')
    expect(footer).toHaveClass('sm:flex-wrap', 'min-w-0')
    expect(description).toHaveClass('[overflow-wrap:anywhere]', 'min-w-0')
  })

  it('moves focus INTO the dialog when it opens', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => {}} />)

    const trigger = screen.getByTestId('confirm-trigger')
    await user.click(trigger)

    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() => {
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    })
    // Not merely "inside": an operator arrives on a control, not on the box.
    expect(document.activeElement).not.toBe(document.body)
  })

  it('traps focus — Tab from the last control wraps to the first', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => {}} />)

    await user.click(screen.getByTestId('confirm-trigger'))
    const dialog = await screen.findByRole('alertdialog')

    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'))
    expect(controls.length).toBeGreaterThan(1)
    const first = controls[0]!
    const last = controls[controls.length - 1]!

    last.focus()
    expect(last).toHaveFocus()
    await user.tab()

    // The wrap is the trap: without it Tab lands on `after`, a control in a page
    // the operator is no longer looking at.
    expect(first).toHaveFocus()
    expect(screen.getByTestId('after')).not.toHaveFocus()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => {}} />)

    await user.click(screen.getByTestId('confirm-trigger'))
    await screen.findByRole('alertdialog')

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('RETURNS FOCUS TO THE TRIGGER when Escape cancels it', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => {}} />)

    const trigger = screen.getByTestId('confirm-trigger')
    await user.click(trigger)
    await screen.findByRole('alertdialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // The docblock's bold promise: "Focus is trapped **and then given back** to
    // the control that opened it". Focus on <body> is not the control that opened
    // it — it is the state a keyboard operator has to Tab from the top of the
    // document to escape.
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('RETURNS FOCUS TO THE TRIGGER when Cancel cancels it', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => {}} />)

    const trigger = screen.getByTestId('confirm-trigger')
    await user.click(trigger)
    await screen.findByRole('alertdialog')

    await user.click(screen.getByTestId('confirm-cancel'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('RETURNS FOCUS TO THE TRIGGER when the mutation succeeds and closes it', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => Promise.resolve('deleted')} />)

    const trigger = screen.getByTestId('confirm-trigger')
    await user.click(trigger)
    await screen.findByRole('alertdialog')

    await user.click(screen.getByTestId('confirm-accept'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // The success path is the common one: 25 call sites, every delete, every
    // credential issue, every unpublish. If focus is lost here it is lost the
    // moment the work actually happened.
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('RETURNS FOCUS TO THE TRIGGER even though the caller disabled it in flight', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => Promise.resolve('deleted')} disableTriggerWhileBusy />)

    const trigger = screen.getByTestId('confirm-trigger')
    await user.click(trigger)
    await screen.findByRole('alertdialog')
    await user.click(screen.getByTestId('confirm-accept'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // `<Button disabled={mutation.isPending}>` is the sanctioned trigger shape in
    // this console (releases.tsx, the wizard, the key panel). A disabled element
    // cannot take focus, so "give it back to the trigger" has to survive the
    // trigger being briefly untargetable — otherwise the promise holds only in a
    // harness nobody ships.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))
  })

  it('ANNOUNCES a server refusal — role and text, not a colour', async () => {
    const user = userEvent.setup()
    const refusal = new Error('release:write is not granted on this key')
    render(<Harness onConfirm={() => Promise.reject(refusal)} />)

    await user.click(screen.getByTestId('confirm-trigger'))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByTestId('confirm-accept'))

    // `getByRole('alert')` is the assertion: it is the live region a screen
    // reader speaks the moment it appears. A red `text-destructive` div is
    // findable by class and is silent.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The server refused')
    expect(alert).toHaveTextContent('release:write is not granted on this key')

    // The server's own words are inside the announced region, not beside it: a
    // reader that speaks the region must speak the reason.
    expect(alert).toContainElement(screen.getByTestId('confirm-error-message'))
    expect(screen.getByTestId('confirm-error-message')).toHaveTextContent(
      'release:write is not granted on this key',
    )
  })

  it('keeps the dialog OPEN after a refusal, with the target still on screen', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => Promise.reject(new Error('conflict: a build is already running'))} />)

    await user.click(screen.getByTestId('confirm-trigger'))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(screen.getByTestId('confirm-accept'))

    // Waits on the message rather than on `role="alert"`, so that this contract
    // and the announcement contract fail one at a time and say different things.
    await screen.findByTestId('confirm-error-message')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBe(dialog)
    // What was going to happen is still readable next to why it did not.
    expect(screen.getByTestId('confirm-description')).toHaveTextContent(
      'Everything published under it stops being served.',
    )
    // And it can still be answered — the refusal did not disable the way out.
    expect(screen.getByTestId('confirm-cancel')).toBeEnabled()
  })

  it('refuses to be dismissed while the mutation is in the air', async () => {
    const user = userEvent.setup()
    let settle: (() => void) | undefined
    const inFlight = new Promise<void>((resolve) => {
      settle = resolve
    })
    render(<Harness onConfirm={() => inFlight} />)

    await user.click(screen.getByTestId('confirm-trigger'))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(screen.getByTestId('confirm-accept'))
    await waitFor(() => expect(screen.getByTestId('confirm-accept')).toHaveAttribute('aria-busy', 'true'))

    await user.keyboard('{Escape}')
    // A request whose outcome is unknown must not leave the screen claiming to
    // have been cancelled.
    expect(dialog).toBeInTheDocument()

    settle?.()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('cannot be answered by a stray click outside it', async () => {
    const user = userEvent.setup()
    render(<Harness onConfirm={() => {}} />)

    await user.click(screen.getByTestId('confirm-trigger'))
    const dialog = await screen.findByRole('alertdialog')

    const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]')
    expect(overlay).not.toBeNull()
    await user.click(overlay as HTMLElement)

    // An alert dialog has no light-dismiss, and that is the point: a
    // confirmation a stray click can answer is not a confirmation.
    expect(dialog).toBeInTheDocument()
  })

  it('does not run the mutation when it is cancelled', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)

    await user.click(screen.getByTestId('confirm-trigger'))
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    expect(onConfirm).not.toHaveBeenCalled()
  })
})

/**
 * The two shapes in which "give focus back to the trigger" is not something the
 * component can do, because the trigger is not there to take it.
 *
 * Every test above hands focus back to a trigger that is mounted and enabled by
 * the time the dialog closes. That is the shape a harness produces; it is not
 * the shape the console produces. `sites.tsx` deletes a row: the trigger is a
 * `<Button>` inside the `<TableRow>` being removed, and `onConfirm` awaits
 * `invalidateQueries` — so the list has already re-rendered without that row
 * before the promise resolves and the dialog closes. There is no trigger left.
 * `releases.tsx` produces the other one: `<Button disabled={mutation.isPending}>`
 * where `isPending` outlives the close by a chained refetch or a toast.
 *
 * Focusing a detached node, or a disabled one, is a no-op — focus stays on
 * `<body>`, which is not a position in a list. It is no position at all: the
 * next Tab starts from the top of the document, past the whole sidebar, and the
 * operator who just deleted row three has to count their way back to row four.
 */

/** The list a deleted row is deleted *from* — the same nesting `sites.tsx` has
 *  (`Card > CardContent > Table > TableBody > TableRow > TableCell > div >
 *  Button`), written in plain tags so the assertion is about the DOM shape and
 *  not about which shadcn wrapper happened to render it. */
function RowHarness() {
  const [rows, setRows] = useState(['alpha', 'beta'])

  return (
    <div>
      <button data-testid="before">Before</button>
      {/* A nameless container between the row and the list, so "focus went to
          the list" cannot be satisfied by grabbing the nearest surviving
          ancestor. */}
      <div data-testid="card">
        <table data-testid="sites-table">
          <tbody>
            {rows.map((slug) => (
              <tr key={slug} data-testid={`row-${slug}`}>
                <td>{slug}</td>
                <td>
                  <div>
                    <Confirm
                      title={`Delete ${slug}?`}
                      description="The site row, its content and its releases are removed."
                      confirmLabel="Delete site"
                      destructive
                      onConfirm={async () => {
                        // What `sites.tsx` does: the delete is awaited and so is
                        // the invalidation behind it, so the row is gone before
                        // this promise resolves and the dialog closes.
                        await Promise.resolve()
                        setRows((current) => current.filter((entry) => entry !== slug))
                      }}
                    >
                      {(open) => (
                        <button data-testid={`delete-${slug}`} onClick={open}>
                          Delete
                        </button>
                      )}
                    </Confirm>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button data-testid="after">After</button>
    </div>
  )
}

/** A trigger that survives the close and stays disabled well past it: the
 *  mutation's `isPending` is still true when the dialog is gone, and only the
 *  test says when it clears. */
function LateEnableHarness({ control }: { control: { release: () => void } }) {
  const [isPending, setPending] = useState(false)
  // Assigned in an effect rather than during render so the harness itself stays
  // a well-behaved component; the test calls it inside `act`.
  useEffect(() => {
    control.release = () => setPending(false)
  }, [control])

  return (
    <div>
      <button data-testid="before">Before</button>
      <div data-testid="card">
        <table data-testid="releases-table">
          <tbody>
            <tr>
              <td>
                <Confirm
                  title="Build and activate a release?"
                  description="The live site changes as soon as the build succeeds."
                  confirmLabel="Build and activate"
                  onConfirm={() => {
                    setPending(true)
                    return Promise.resolve('built')
                  }}
                >
                  {(open) => (
                    <button data-testid="confirm-trigger" disabled={isPending} onClick={open}>
                      New release
                    </button>
                  )}
                </Confirm>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button data-testid="after">After</button>
    </div>
  )
}

/** The other half of the console: a `Confirm` that is in no list at all — the
 *  credential panel's Revoke, the webhook's Delete — where the trigger sits in
 *  nested anonymous `<div>`s inside the page landmark. Nothing between the
 *  trigger and `<main>` announces anything, which is the case that decides
 *  whether "a meaningful target" means anything or just means "an ancestor". */
function PanelHarness() {
  const [credentials, setCredentials] = useState(['ck_live_7f2a'])

  return (
    <div>
      <button data-testid="before">Before</button>
      {/* The shell's own landmark, which every page in the console renders
          inside. */}
      <main data-testid="page-main">
        <div data-testid="card">
          <div data-testid="card-content">
            {credentials.map((credential) => (
              <div key={credential} data-testid={`credential-${credential}`}>
                <span>{credential}</span>
                <div data-testid="row-actions">
                  <Confirm
                    title={`Revoke ${credential}?`}
                    description="Anything using this key stops working immediately."
                    confirmLabel="Revoke key"
                    destructive
                    onConfirm={async () => {
                      await Promise.resolve()
                      setCredentials((current) => current.filter((entry) => entry !== credential))
                    }}
                  >
                    {(open) => (
                      <button data-testid="revoke" onClick={open}>
                        Revoke
                      </button>
                    )}
                  </Confirm>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
      <button data-testid="after">After</button>
    </div>
  )
}

describe('Confirm — where focus goes when the trigger cannot take it back', () => {
  it('PUTS FOCUS IN THE LIST when the row that owned the trigger was deleted', async () => {
    const user = userEvent.setup()
    render(<RowHarness />)

    await user.click(screen.getByTestId('delete-alpha'))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByTestId('confirm-accept'))

    // The ordinary destructive path, in order: the row goes, then the dialog.
    await waitFor(() => expect(screen.queryByTestId('row-alpha')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // Where focus goes instead of `<body>`: the structure that owned the row,
    // which is still on screen and still says where the operator is. A screen
    // reader announces it as a table, and the next Tab lands on the controls of
    // the row that took the deleted row's place.
    const list = screen.getByTestId('sites-table')
    expect(list).toBe(screen.getByRole('table'))
    await waitFor(() => expect(list).toHaveFocus())

    // `<body>` is the failure this test exists for: no position in the list, and
    // the next Tab starts from the top of the document.
    expect(document.activeElement).not.toBe(document.body)

    // Not the nearest surviving ancestor, and not the nearest thing that happens
    // to accept focus: both would pass by landing somewhere meaningless.
    expect(screen.getByTestId('card')).not.toHaveFocus()
    expect(screen.getByTestId('before')).not.toHaveFocus()
    expect(screen.getByTestId('after')).not.toHaveFocus()
    // And the surviving row's own trigger was not stolen: focus belongs to the
    // list, not to a delete button the operator never pressed.
    expect(screen.getByTestId('delete-beta')).not.toHaveFocus()
  })

  it('PUTS FOCUS IN THE LIST when the trigger is still disabled after the close, and gives it back when it re-enables', async () => {
    const user = userEvent.setup()
    const control = { release: () => {} }
    render(<LateEnableHarness control={control} />)

    const trigger = screen.getByTestId('confirm-trigger')
    await user.click(trigger)
    await screen.findByRole('alertdialog')
    await user.click(screen.getByTestId('confirm-accept'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // `isPending` has not cleared and will not clear until this test says so —
    // a chained invalidation, a slow refetch, a queued toast. A disabled element
    // refuses focus, so "give it back to the trigger" cannot be the answer here
    // and the operator must still not be left on `<body>`.
    expect(trigger).toBeDisabled()
    const list = screen.getByTestId('releases-table')
    await waitFor(() => expect(list).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)

    // The trigger is still the better answer the moment it can take focus, and
    // nothing has moved focus away from where the component parked it, so it
    // gets it back rather than leaving the operator one Tab further out than
    // they started.
    act(() => {
      control.release()
    })
    await waitFor(() => expect(trigger).toHaveFocus())
    // And the list is left as it was found: no leftover tabindex putting a
    // `<table>` into the Tab order of every later page.
    expect(list).not.toHaveAttribute('tabindex')
  })

  it('DOES NOT TAKE FOCUS BACK from an operator who has moved on', async () => {
    const user = userEvent.setup()
    const control = { release: () => {} }
    render(<LateEnableHarness control={control} />)

    await user.click(screen.getByTestId('confirm-trigger'))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByTestId('confirm-accept'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('releases-table')).toHaveFocus())

    // The operator did not wait: they moved somewhere else while the mutation
    // was still settling.
    const elsewhere = screen.getByTestId('after')
    await user.click(elsewhere)
    expect(elsewhere).toHaveFocus()

    // Now the trigger re-enables. Handing focus back here would yank a keyboard
    // operator out of the control they deliberately chose and drop them on one
    // they are no longer looking at — the exact failure this whole mechanism
    // exists to prevent, committed by the mechanism itself.
    act(() => {
      control.release()
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(elsewhere).toHaveFocus()
    expect(screen.getByTestId('confirm-trigger')).not.toHaveFocus()
  })

  it('SKIPS THE ANONYMOUS WRAPPERS and lands on something a reader announces', async () => {
    const user = userEvent.setup()
    render(<PanelHarness />)

    await user.click(screen.getByTestId('revoke'))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByTestId('confirm-accept'))

    await waitFor(() => expect(screen.queryByTestId('credential-ck_live_7f2a')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    // `card-content` and `card` both survived the delete and are both nearer to
    // the dead trigger than the landmark is. Either would satisfy "focus went to
    // an ancestor" and neither says anything at all to a screen reader: a
    // `<div>` with no role is announced as nothing, so an operator would be told
    // only that they are no longer where they were.
    const landmark = screen.getByRole('main')
    await waitFor(() => expect(landmark).toHaveFocus())
    expect(screen.getByTestId('card-content')).not.toHaveFocus()
    expect(screen.getByTestId('card')).not.toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)

    // Same clean-up as the list: the landmark does not keep a tabindex it was
    // only lent.
    act(() => {
      screen.getByTestId('before').focus()
    })
    expect(landmark).not.toHaveAttribute('tabindex')
  })
})
