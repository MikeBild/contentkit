import { useEffect, useState } from 'react'
import { formatExact, formatRelative, isoInstant, refreshAfter, relativeParts, type TimeInput } from '@/lib/relative-time'
import { cn } from '@/lib/utils'

/**
 * "vor 2 Stunden", with the exact instant still in reach.
 *
 * Both halves are the requirement. The sentence is what the operator reads at a
 * glance; the instant is what they need the moment two rows have to be put in
 * order, and an audit trail whose timestamps have been rounded into prose is not
 * a trail. So the precision is kept in two places a browser already understands:
 * `title`, for the pointer, and `datetime` on a real `<time>`, for everything
 * else that reads the page.
 *
 * The label re-renders on its own — a row that says "vor 3 Sekunden" for the next
 * ten minutes is worse than one that never claimed to be live — and the interval
 * follows the unit, so a list of year-old rows is not running a timer per second.
 *
 * The locale is the browser's. Nothing here names one.
 */
export function RelativeTime({
  value,
  className,
  'data-testid': testId = 'ck-relative-time',
}: {
  value: TimeInput
  className?: string
  'data-testid'?: string
}) {
  const iso = isoInstant(value)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!iso) return
    // Re-read the clock rather than adding the interval to it: a laptop that was
    // asleep for an hour would otherwise show a label an hour behind.
    const unit = relativeParts(new Date(iso).valueOf(), Date.now()).unit
    const timer = setInterval(() => setNow(Date.now()), refreshAfter(unit))
    return () => clearInterval(timer)
    // `now` is a dependency on purpose: crossing a unit boundary re-arms the
    // timer at the coarser interval instead of ticking every second for a year.
  }, [iso, now])

  if (!iso)
    return (
      <span data-testid={testId} className={cn('text-muted-foreground', className)}>
        —
      </span>
    )

  return (
    <time
      dateTime={iso}
      title={formatExact(value) ?? undefined}
      data-testid={testId}
      className={cn('whitespace-nowrap', className)}
    >
      {formatRelative(value, now)}
    </time>
  )
}
