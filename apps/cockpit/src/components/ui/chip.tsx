import { XIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from './badge'

/**
 * A selected value that can be taken back out.
 *
 * It used to build its own pill — a border, a radius and a background of its own
 * — beside `Badge`, which builds one too, so a chip and a status badge on the
 * same row did not match and the invalid state was painted in a chart series.
 * The surface is `Badge`'s now and the only thing left here is the part `Badge`
 * has no opinion about: the remove control, and what "invalid" means. The
 * severity is `Badge`'s `destructive` variant plus `aria-invalid`, so a chip
 * whose value the form rejected says so to a reader as well as to the eye.
 */
export function Chip({
  onRemove,
  removeLabel,
  invalid,
  className,
  children,
  'data-testid': testId,
  ...props
}: ComponentProps<'span'> & {
  onRemove?: () => void
  removeLabel?: string
  invalid?: boolean
  'data-testid'?: string
}) {
  return (
    <Badge
      variant={invalid ? 'destructive' : 'secondary'}
      aria-invalid={invalid || undefined}
      className={cn('max-w-full', className)}
      data-testid={testId}
      {...props}
    >
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          // The chip's own testid lands on the badge; the remove control is a
          // separate target and derives its own so a test can click it.
          data-testid={testId ? `${testId}-remove` : undefined}
          aria-label={removeLabel ?? 'Remove'}
          onClick={onRemove}
          className="-mr-0.5 shrink-0 rounded opacity-70 hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </Badge>
  )
}
