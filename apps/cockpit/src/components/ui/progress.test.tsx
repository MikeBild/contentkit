import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Progress } from '@/components/ui/progress'

/** When the build started. A brace, not a string literal: `<Progress>` call sites
 *  are scanned by test/unit/cockpit-primitives.test.mjs, and a bar that reports
 *  neither `value` nor `since` is decoration pulsing where a status should be. */
const BUILD_STARTED = '2026-07-30T09:00:00.000Z'

/**
 * "A bar may only draw a fraction that exists" is a claim about the accessibility
 * tree, and the accessibility tree is the one thing the source-reading suite
 * cannot read. `progressPercent` has a unit test, but `progressPercent` returning
 * `null` proves nothing about what a screen reader is told: Radix's own root emits
 * `aria-valuemin` and `aria-valuemax` unconditionally, so wiring the indeterminate
 * case through it would announce "0 of 100" for a quantity nobody measured, and
 * every existing assertion about this file would still pass.
 *
 * ARIA spells indeterminate exactly one way: `role="progressbar"` with **no**
 * `aria-valuenow`. Not `role="status"`, which is a live region and says nothing
 * about progress; not a bar at zero, which is a measurement. So that is what is
 * asserted here, in the two shapes the console actually has.
 */
describe('Progress — the release build, which reports no fraction at all', () => {
  it('exposes an indeterminate progressbar: no aria-valuenow, valuemin or valuemax', () => {
    // Exactly what a release build can supply: a name, when it started, and
    // nothing else. `docs/openapi.json`'s `Release` has no percentage, no step
    // count and no ETA.
    render(<Progress label="Building" since={BUILD_STARTED} data-testid="release-progress" />)

    const bar = screen.getByRole('progressbar', { name: 'Building' })

    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).not.toHaveAttribute('aria-valuemin')
    expect(bar).not.toHaveAttribute('aria-valuemax')
    expect(bar).not.toHaveAttribute('aria-valuetext')
    expect(bar).toHaveAttribute('data-state', 'indeterminate')
  })

  it('is a progressbar, not a status region — the role has to mean "how far along"', () => {
    render(<Progress label="Building" since={BUILD_STARTED} />)

    // A labelled progressbar with no value is ARIA's own spelling of
    // "indeterminate". `role="status"` is a live region: it announces whatever
    // text lands in it and makes no claim about progress at all, so swapping one
    // for the other loses the honesty contract rather than expressing it.
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('never puts a percentage in front of the operator for work with no fraction', () => {
    render(<Progress label="Building" since={BUILD_STARTED} data-testid="release-progress" />)

    // The readout beside an indeterminate bar is elapsed time, never "0%" and
    // never blank: a hundred-second build has to look like a running one.
    expect(screen.getByTestId('release-progress')).not.toHaveTextContent('%')
    expect(screen.getByTestId('release-progress-value')).toBeInTheDocument()
  })
})

describe('Progress — the audio budget, which reports a real fraction', () => {
  it('exposes the fraction the API sent, with the full value triple', () => {
    render(
      <Progress
        aria-label="Characters used this month"
        // The page hands over a percentage computed from `chars_this_month` and
        // `monthly_char_budget`, because Radix's indicator is a translate.
        value={40}
        max={100}
        getValueLabel={(percent) => `${percent}% of the monthly character budget`}
      />,
    )

    const bar = screen.getByRole('progressbar', { name: 'Characters used this month' })

    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuetext', '40% of the monthly character budget')
    // Radix owns the bar's own `data-state` vocabulary (loading/complete); the
    // wrapper is where this component records which of its two branches drew.
    expect(screen.getByTestId('ck-progress')).toHaveAttribute('data-state', 'determinate')
  })

  it('keeps the geometry out of `max`: 400k of 1M is 40 per cent, not a bar off the end', () => {
    render(<Progress aria-label="Characters used this month" value={400_000} max={1_000_000} />)

    const bar = screen.getByRole('progressbar', { name: 'Characters used this month' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('treats a site with no configured budget as indeterminate, not as zero', () => {
    // `monthly_char_budget` is null for most sites. A denominator that does not
    // exist cannot be drawn — and must not be announced as a maximum either.
    render(<Progress aria-label="Characters used this month" value={812_000} max={null} />)

    const bar = screen.getByRole('progressbar', { name: 'Characters used this month' })
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).not.toHaveAttribute('aria-valuemax')
    expect(screen.getByTestId('ck-progress')).toHaveAttribute('data-state', 'indeterminate')
  })

  it('announces zero, because zero is a measurement', () => {
    render(<Progress aria-label="Characters used this month" value={0} max={1_000_000} />)

    const bar = screen.getByRole('progressbar', { name: 'Characters used this month' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByTestId('ck-progress')).toHaveAttribute('data-state', 'determinate')
  })

  it('clamps the picture at 100 while the words keep the overshoot', () => {
    render(
      <Progress
        aria-label="Characters used this month"
        value={140}
        max={100}
        valueLabel="1,400,000 of 1,000,000 · 0 left"
      />,
    )

    const bar = screen.getByRole('progressbar', { name: 'Characters used this month' })
    // A bar cannot draw 140 %, so it says 100 and the sentence beside it carries
    // the fact that the budget is spent.
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByTestId('ck-progress-value')).toHaveTextContent('1,400,000 of 1,000,000 · 0 left')
  })
})
