import { X } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A selected value that can be taken back out. Distinct from `Badge`, which
 * reports state and is never interactive — a removable thing has to look
 * removable.
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
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 text-xs',
        invalid ? 'border-chart-5/40 bg-chart-5/10 text-chart-5' : 'border-border bg-muted text-foreground',
        className,
      )}
      data-testid={testId}
      {...props}
    >
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          // The chip's own testid lands on the span; the remove control is a
          // separate target and derives its own so a test can click it.
          data-testid={testId ? `${testId}-remove` : undefined}
          aria-label={removeLabel ?? 'Remove'}
          onClick={onRemove}
          className="shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  )
}
