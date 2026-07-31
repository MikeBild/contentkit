import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'

/**
 * Spinner has two forms, and which one it is cannot be seen in the source of the
 * call site: both are `<Spinner …/>`. The difference is entirely in the
 * accessibility tree — one is a picture beside words that already say it, the
 * other is the only thing on screen saying so and has to be announced — and the
 * failure mode of getting it wrong is silent in both directions: a doubled
 * announcement ("Loading Loading this page") and a mutation that is running with
 * nothing said at all.
 */
describe('Spinner — the decorative form', () => {
  it('is not in the accessibility tree at all when it stands beside words', () => {
    render(<Spinner data-icon="inline-start" />)

    // No live region, because the label next to it is the announcement. A second
    // one is the noise this split exists to prevent.
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTestId('ck-spinner')).toHaveAttribute('aria-hidden', 'true')
  })

  it('leaves a button saying what it always said', () => {
    render(
      <Button data-testid="delete">
        <Spinner data-icon="inline-start" />
        Delete site
      </Button>,
    )

    // The whole reason the label stopped being replaced by "Deleting…": the
    // control keeps its name, and the name keeps the noun. If the icon were
    // announced this would read "Loading Delete site" and the accessible name of
    // the primary destructive control would change while it was being pressed.
    expect(screen.getByTestId('delete')).toHaveAccessibleName('Delete site')
  })
})

describe('Spinner — the announced form', () => {
  it('becomes a status region carrying the sentence when it stands alone', () => {
    render(<Spinner label="Loading this page…" />)

    // `status` is a live region: what a reader speaks is its text, not a name
    // computed from it, so the text is what has to be there.
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Loading this page…')
  })

  it('accepts the same claim spelled the way the DOM spells it', () => {
    // pagination.tsx passes `aria-label`; it must not produce a silent spinner.
    render(<Spinner aria-label="Loading this page…" className="size-3" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading this page…')
  })

  it('says it once, not twice — the icon inside stays hidden', () => {
    render(<Spinner label="Loading this page…" />)

    const status = screen.getByRole('status')
    const icon = status.querySelector('[data-slot="spinner"]')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    // One announcement, exactly: the accessible name is the sentence, and the
    // icon contributes nothing to it.
    expect(status.textContent).toBe('Loading this page…')
  })
})
