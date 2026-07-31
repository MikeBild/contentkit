import type { ReactNode } from 'react'
import { Progress as ProgressPrimitive } from 'radix-ui'
import { cn } from '@/lib/utils'
import { progressPercent } from './progress-value'
import { RelativeTime } from './relative-time'

const TONES = {
  accent: 'bg-accent',
  warning: 'bg-chart-3',
  danger: 'bg-chart-5',
}

/**
 * How far along — and, when that cannot be known, honestly that.
 *
 * Two consumers, two different truths. The audio budget is a real fraction:
 * `chars_this_month` over `settings.audio.monthly_char_budget`, both reported by
 * `GET /v1/sites/{site}/audio/jobs`. A release build is not: nothing reports
 * build progress, and a build has been measured at over a hundred seconds, so a
 * bar filling at a guessed rate would be a lie that reaches ninety per cent and
 * stops there — after which the operator cancels a build that was fine.
 *
 * Which of the two this is, is decided once, by `progress-value.ts`, before
 * anything is drawn — and absence is never coerced to a number on the way. A
 * fraction that exists is Radix's bar, whose root carries the whole value
 * vocabulary. A fraction that does not exist cannot be Radix's: its root emits a
 * minimum and a maximum unconditionally and drops only the current value, so a
 * bar nobody measured would still report a maximum for the quantity nobody
 * measured. That branch is therefore this file's own markup — a named
 * `progressbar` publishing no value at all, which is ARIA's own spelling of
 * "busy, no idea how far" — and `since` supplies the one fact unknown-duration
 * work does have, how long it has been running, which is what keeps a
 * hundred-second build from reading as a hung one.
 */
export function Progress({
  value,
  max = 100,
  label,
  valueLabel,
  tone = 'accent',
  since,
  getValueLabel,
  className,
  'aria-label': ariaLabel,
  'data-testid': testId = 'ck-progress',
}: {
  /** Absent means unknown. It is never coerced to zero: zero is a measurement. */
  value?: number | null
  /** The denominator. Absent, null or zero is not one, and no fraction is drawn. */
  max?: number | null
  label?: string
  /** The numbers in the caller's own words — "812 000 of 1 000 000 characters". */
  valueLabel?: ReactNode
  tone?: keyof typeof TONES
  /** When unknown-duration work started, so an indeterminate bar can still age. */
  since?: string | number | Date | null
  /** The sentence a reader is given in place of the bare percentage. */
  getValueLabel?: (percent: number, of: number) => string
  className?: string
  'aria-label'?: string
  'data-testid'?: string
}) {
  const percent = progressPercent(value, max)
  const name = label ?? ariaLabel
  // The readout is the caller's sentence, or the percentage, or — for work with
  // no fraction — how long it has been going. Never a percentage of an unknown
  // total, and never nothing at all.
  const readout = valueLabel ?? (percent === null ? <RelativeTime value={since ?? null} /> : `${percent}%`)

  return (
    <div
      data-testid={testId}
      // Radix owns its own bar's state vocabulary (loading/complete); this is
      // where the component records which of its two branches drew.
      data-state={percent === null ? 'indeterminate' : 'determinate'}
      className={cn('flex flex-col gap-1', className)}
    >
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span data-testid={`${testId}-value`} className="tabular-nums text-muted-foreground">
          {readout}
        </span>
      </div>
      {percent === null ? (
        <div
          role="progressbar"
          aria-label={name}
          data-state="indeterminate"
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          {/* A full-width pulse rather than a segment sliding left to right: a bar
              drawn at some fixed width would still be a position the work has not
              got. */}
          <div
            data-testid={`${testId}-bar`}
            className={cn('h-full w-full animate-pulse rounded-full motion-reduce:animate-none', TONES[tone])}
          />
        </div>
      ) : (
        <ProgressPrimitive.Root
          aria-label={name}
          value={percent}
          max={100}
          getValueLabel={getValueLabel}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <ProgressPrimitive.Indicator
            data-testid={`${testId}-bar`}
            className={cn('h-full w-full flex-1 rounded-full transition-transform', TONES[tone])}
            style={{ transform: `translateX(-${100 - percent}%)` }}
          />
        </ProgressPrimitive.Root>
      )}
    </div>
  )
}
