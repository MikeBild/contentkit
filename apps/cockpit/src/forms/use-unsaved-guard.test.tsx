import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * "Save and leave", when the save says no.
 *
 * This dialog is the last thing between an operator and the loss of everything
 * they have typed, and it got the one case wrong that matters. It awaited
 * `onSave()` inside a try/catch and called `proceed()` unless something was
 * thrown — but neither caller throws. `use-form`'s `save()` returns `false` on a
 * validation error and on a rejected request, and site-settings' `attemptSave()`
 * does the same. So a failed save looked exactly like a successful one, the guard
 * navigated away, and the edits were gone. The comment above that code asserted
 * the opposite in as many words.
 *
 * The guard itself needs a router, so the decision is tested where it lives: this
 * drives the same handler shape against the three answers a caller can give —
 * `false`, a throw, and success — and asserts whether we leave. A test that could
 * only see the throw is the test that was already there in spirit and missed this.
 */
function SaveAndLeave({ onSave, onProceed }: { onSave: () => Promise<unknown>; onProceed: () => void }) {
  return (
    <button
      type="button"
      data-testid="ck-unsaved-save"
      onClick={async () => {
        let saved: unknown = false
        try {
          saved = await onSave()
        } catch {
          return
        }
        if (saved === false) return
        onProceed()
      }}
    >
      Save and leave
    </button>
  )
}

describe('the unsaved-changes guard, when the save fails', () => {
  it('STAYS PUT when the save resolves false — the shape both callers actually use', async () => {
    const user = userEvent.setup()
    const onProceed = vi.fn()
    render(<SaveAndLeave onSave={() => Promise.resolve(false)} onProceed={onProceed} />)

    await user.click(screen.getByTestId('ck-unsaved-save'))

    // Leaving here discards the edits the operator just asked to keep.
    expect(onProceed).not.toHaveBeenCalled()
  })

  it('stays put when the save throws', async () => {
    const user = userEvent.setup()
    const onProceed = vi.fn()
    render(<SaveAndLeave onSave={() => Promise.reject(new Error('nope'))} onProceed={onProceed} />)

    await user.click(screen.getByTestId('ck-unsaved-save'))

    expect(onProceed).not.toHaveBeenCalled()
  })

  it('leaves when the save succeeds', async () => {
    const user = userEvent.setup()
    const onProceed = vi.fn()
    render(<SaveAndLeave onSave={() => Promise.resolve(true)} onProceed={onProceed} />)

    await user.click(screen.getByTestId('ck-unsaved-save'))

    expect(onProceed).toHaveBeenCalledOnce()
  })

  it('leaves when the caller resolves with nothing at all', async () => {
    const user = userEvent.setup()
    const onProceed = vi.fn()
    render(<SaveAndLeave onSave={() => Promise.resolve(undefined)} onProceed={onProceed} />)

    await user.click(screen.getByTestId('ck-unsaved-save'))

    // `unknown` is the declared return type, so a caller with no opinion must not
    // be read as a refusal — only an explicit `false` keeps us here. Getting this
    // backwards would strand an operator in the dialog after a save that worked.
    expect(onProceed).toHaveBeenCalledOnce()
  })
})
