import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Hover, focus and Escape — a tooltip that only answers to the mouse is a
 * tooltip half the operators never see.
 *
 * Nothing in the console clips or transforms its overflow, so the bubble is an
 * absolutely positioned sibling rather than a portal with collision detection.
 * The rule that keeps this honest: a tooltip may never be the only place a
 * constraint is written. It repeats, it does not inform.
 */
export function Tooltip({
  content,
  side = 'top',
  children,
  className,
  'data-testid': testId = 'ck-tooltip',
}: {
  content: ReactNode
  side?: 'top' | 'bottom'
  children: ReactNode
  className?: string
  'data-testid'?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && content ? (
        <span
          role="tooltip"
          id={id}
          data-testid={testId}
          className={cn(
            'pointer-events-none absolute left-1/2 z-50 w-max max-w-xs -translate-x-1/2 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground shadow-lg',
            side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  )
}
