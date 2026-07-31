import { useEffect, useState } from 'react'
import { formatExact, formatRelative, isoInstant, refreshAfter, relativeParts, type TimeInput } from '@/lib/relative-time'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * "vor 2 Stunden", with the exact instant still in reach.
 *
 * Both halves are the requirement. The sentence is what the operator reads at a
 * glance; the instant is what they need the moment two rows have to be put in
 * order, and an audit trail whose timestamps have been rounded into prose is not
 * a trail. So the precision is kept in two places: `datetime` on a real `<time>`,
 * for everything that reads the page as a machine, and a Tooltip for everything
 * that reads it as a person.
 *
 * The tooltip replaced a native `title`, which is the same sentence offered to a
 * pointer and to nobody else — not to a touch screen, not to a keyboard. The
 * `<time>` is therefore a tab stop: a timestamp in an audit trail is exactly the
 * kind of rounded-off fact an operator has to be able to open, and an affordance
 * that only a mouse can open is one most of the people who need it cannot.
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

  const exact = formatExact(value)
  const label = (
    <time dateTime={iso} data-testid={testId} className={cn('whitespace-nowrap', className)}>
      {formatRelative(value, now)}
    </time>
  )

  // No instant to show is no disclosure to open: a trigger that opens an empty
  // bubble is a tab stop that costs a keyboard user a keystroke and tells them
  // nothing.
  if (!exact) return label

  // The provider is opened locally as well as at the app root, because timestamps
  // are rendered inside dialogs that mount their own trees, and a missing
  // provider throws rather than degrades.
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="rounded focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent data-testid={`${testId}-exact`}>{exact}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
