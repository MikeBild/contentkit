import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
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
 * So a fraction is drawn only when one exists. `value` absent, or `max` absent,
 * zero or null — which is exactly what a site with no budget configured reports —
 * means indeterminate: a pulsing track, `role="progressbar"` with **no**
 * `aria-valuenow` at all, so a screen reader is told "busy" instead of "90%".
 * `since` then supplies the one fact that is available for unknown-duration work,
 * how long it has been running, which is what keeps a hundred-second build from
 * reading as a hung one.
 */
export function Progress({
  value,
  max = 1,
  label,
  valueLabel,
  tone = 'accent',
  since,
  className,
  'data-testid': testId = 'ck-progress',
}: {
  /** Absent means unknown. It is never coerced to zero: zero is a measurement. */
  value?: number | null
  /** The denominator. Absent, null or zero is not one, and no fraction is drawn. */
  max?: number | null
  label: string
  /** The numbers in the caller's own words — "812 000 of 1 000 000 characters". */
  valueLabel?: ReactNode
  tone?: keyof typeof TONES
  /** When unknown-duration work started, so an indeterminate bar can still age. */
  since?: string | number | Date | null
  className?: string
  'data-testid'?: string
}) {
  const fraction =
    value === null || value === undefined || !Number.isFinite(value) || max === null || max === undefined || !(max > 0)
      ? null
      : Math.min(Math.max(value / max, 0), 1)

  return (
    <div
      data-testid={testId}
      data-state={fraction === null ? 'indeterminate' : 'determinate'}
      className={cn('flex flex-col gap-1', className)}
    >
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        {/* The readout is the caller's sentence, or the percentage, or — for work
            with no fraction — how long it has been going. Never a percentage of
            an unknown total, and never nothing at all. */}
        <span data-testid={`${testId}-value`} className="tabular-nums text-muted-foreground">
          {valueLabel ?? (fraction === null ? <RelativeTime value={since ?? null} /> : `${Math.round(fraction * 100)}%`)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={fraction === null ? undefined : 0}
        aria-valuemax={fraction === null ? undefined : 100}
        aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          data-testid={`${testId}-bar`}
          // Indeterminate is a full-width pulse rather than a segment sliding
          // left to right: that needs a keyframe in index.css, and a bar drawn at
          // some fixed width would still be a position the work does not have.
          className={cn(
            'h-full rounded-full transition-[width]',
            TONES[tone],
            fraction === null && 'animate-pulse motion-reduce:animate-none',
          )}
          style={{ width: fraction === null ? '100%' : `${fraction * 100}%` }}
        />
      </div>
    </div>
  )
}
