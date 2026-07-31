import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * The console's own overlay is gone; this is what replaced it, graded by what a
 * DOM does rather than by which strings the file contains.
 *
 * `ui/dialog.tsx` used to be a `role="dialog"` div under thirteen modules: a
 * backdrop that closed on any `mousedown` reaching it, `aria-modal="true"`
 * written on by hand with nothing enforcing it, a Tab cycle over a maintained
 * selector list, and a `busy` prop that only disabled two buttons. Every one of
 * those failures is invisible to a source-reading test — "the string
 * `DialogTitle` is present" is exactly what the review called the branch's
 * instruments certifying the thing that was wrong with it.
 *
 * So the four claims below are asked of the rendered tree:
 *
 *  1. it is a real modal — `role="dialog"`, an accessible name that comes from
 *     `DialogTitle` rather than from a prop, and the page underneath actually
 *     hidden rather than an `aria-modal` written on to say so;
 *  2. **a mutation in flight cannot be dismissed out from under itself** —
 *     not by Escape, not by a click on the backdrop, not by the `X`;
 *  3. once the mutation answers, all three work again — a guard that never
 *     lifts is a trap, not a guard;
 *  4. focus returns to the control that opened it.
 *
 * The busy dialog here is the shape every converted call site has: `open` held
 * by the caller, `onOpenChange` returning early while the request is in the air,
 * and `onEscapeKeyDown`/`onPointerDownOutside` refusing the two paths Radix
 * decides before it ever reaches `onOpenChange`.
 */
function BusyDialog({ busy }: { busy: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <Button data-testid="ck-test-open" onClick={() => setOpen(true)}>
        Open
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return
          if (!next) setOpen(false)
        }}
      >
        <DialogContent
          data-testid="ck-test-dialog"
          closeDisabled={busy}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>Replace membership</DialogTitle>
            <DialogDescription>This list replaces the group's membership exactly as shown.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button data-testid="ck-test-submit" disabled={busy}>
              Replace membership
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Opens the dialog and hands back the trigger, which is what focus must return to. */
async function open(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByTestId('ck-test-open')
  await user.click(trigger)
  await screen.findByTestId('ck-test-dialog')
  return trigger
}

describe('Dialog — the vendored Radix one, not a div wearing the word modal', () => {
  it('is a real modal: the rest of the document is hidden while it is open', async () => {
    const user = userEvent.setup()
    const { container } = render(<BusyDialog busy={false} />)
    await open(user)

    // `getByRole` reads the accessibility tree, so this fails if the title is
    // rendered but not wired: the old overlay's `aria-labelledby` pointed at an
    // `<h2>` it built from a `title` prop, and nothing checked the link held.
    const panel = screen.getByRole('dialog', { name: 'Replace membership' })
    expect(panel).toHaveAttribute('data-testid', 'ck-test-dialog')

    // And this is the claim the hand-rolled overlay faked. It wrote
    // `aria-modal="true"` on its own panel and left the whole page underneath
    // fully readable to a screen reader. Radix does not write `aria-modal` at
    // all — it hides the siblings instead, which is the thing `aria-modal` is
    // supposed to mean. So the assertion is over the page, not over the panel.
    expect(container).toHaveAttribute('aria-hidden', 'true')
    expect(panel.closest('[aria-hidden="true"]')).toBeNull()

    // The close control every dialog in the console has in common, addressable
    // by a name derived from the panel's own.
    expect(screen.getByTestId('ck-test-dialog-close')).toBeInTheDocument()
  })

  it('a mutation in flight cannot be dismissed — not by Escape, the backdrop or the X', async () => {
    // `pointerEventsCheck: 0` because Radix's modal layer sets
    // `pointer-events: none` on everything outside the panel, which is a real
    // guard and not the one under test — user-event would refuse to synthesise
    // the click before the dialog ever saw it.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const view = render(<BusyDialog busy={false} />)
    await open(user)
    // Busy only after it is on screen: this is a request sent from inside the
    // dialog, not a dialog that opened busy.
    view.rerender(<BusyDialog busy />)

    await user.keyboard('{Escape}')
    expect(screen.getByTestId('ck-test-dialog')).toBeInTheDocument()

    // The behaviour the hand-rolled overlay had and this deliberately removes:
    // its backdrop closed on any `mousedown` whose target was the backdrop
    // itself, including one that began as a drag inside the panel.
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()
    await user.click(overlay as HTMLElement)
    expect(screen.getByTestId('ck-test-dialog')).toBeInTheDocument()

    const close = screen.getByTestId('ck-test-dialog-close')
    expect(close).toBeDisabled()
    await user.click(close)
    expect(screen.getByTestId('ck-test-dialog')).toBeInTheDocument()
  })

  it('and can be dismissed again the moment the request answers', async () => {
    const user = userEvent.setup()
    const view = render(<BusyDialog busy />)
    const trigger = screen.getByTestId('ck-test-open')
    await user.click(trigger)
    // A dialog that opened while busy still opens: the guard refuses closing,
    // not opening.
    await screen.findByTestId('ck-test-dialog')

    view.rerender(<BusyDialog busy={false} />)
    expect(screen.getByTestId('ck-test-dialog-close')).toBeEnabled()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('ck-test-dialog')).not.toBeInTheDocument())
  })

  it('returns focus to the control that opened it, never to <body>', async () => {
    const user = userEvent.setup()
    render(<BusyDialog busy={false} />)
    const trigger = await open(user)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('ck-test-dialog')).not.toBeInTheDocument())
    // The failure this replaces drops a keyboard operator at the top of the
    // document, to walk the whole list again.
    expect(document.activeElement).toBe(trigger)
  })
})
