import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { TD, TR } from './primitives'

/**
 * A placeholder shaped like the thing that is coming.
 *
 * The content editor rendered the literal word "Loading…" where a form of forty
 * fields was about to appear, so the pane was one line high and then a page
 * high: every control the operator was already reaching for moved out from under
 * the pointer. A placeholder the size of the missing content costs the same one
 * request and holds the layout still.
 *
 * The shapes are `aria-hidden` and the group says "loading" exactly once.
 * Fourteen grey rectangles announced one by one is worse than silence, and a
 * screen-reader user needs the fact, not the geometry.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  )
}

/**
 * The announced wrapper. Every skeleton in the console goes through it, so a
 * placeholder cannot end up being a silent one.
 */
export function SkeletonGroup({
  label = 'Loading…',
  className,
  children,
  'data-testid': testId = 'ck-skeleton',
}: {
  label?: string
  className?: string
  children: ReactNode
  'data-testid'?: string
}) {
  return (
    <div role="status" aria-busy="true" data-testid={testId} className={cn('flex flex-col gap-2', className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/**
 * Lines of prose. The last one is short because real text ends mid-line, and a
 * block of equal bars reads as a table that is about to arrive rather than a
 * paragraph.
 */
export function SkeletonText({
  lines = 3,
  className,
  label,
  'data-testid': testId = 'ck-skeleton-text',
}: {
  lines?: number
  className?: string
  label?: string
  'data-testid'?: string
}) {
  return (
    <SkeletonGroup label={label} className={className} data-testid={testId}>
      {Array.from({ length: Math.max(1, lines) }, (_unused, line) => (
        <Skeleton key={line} className={cn('h-4', line === lines - 1 && lines > 1 ? 'w-2/5' : 'w-full')} />
      ))}
    </SkeletonGroup>
  )
}

/**
 * Label-and-control pairs, which is the shape of every form in the console —
 * `FieldShell` renders exactly this and at exactly these heights, so the form
 * that lands does not shift what the placeholder promised.
 */
export function SkeletonFields({
  fields = 4,
  className,
  label = 'Loading the form…',
  'data-testid': testId = 'ck-skeleton-fields',
}: {
  fields?: number
  className?: string
  label?: string
  'data-testid'?: string
}) {
  return (
    <SkeletonGroup label={label} className={cn('gap-4', className)} data-testid={testId}>
      {Array.from({ length: Math.max(1, fields) }, (_unused, field) => (
        <div key={field} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </SkeletonGroup>
  )
}

/**
 * Table rows, for a list whose header is already on screen.
 *
 * `TableState` in primitives.tsx renders one centred "Loading…" cell instead,
 * which collapses the table to a single row and then expands it — the same jump
 * as the editor's, in a place where the operator is aiming at a row action.
 */
export function SkeletonRows({
  rows = 5,
  columns,
  'data-testid': testId = 'ck-skeleton-rows',
}: {
  rows?: number
  columns: number
  'data-testid'?: string
}) {
  return (
    <>
      {Array.from({ length: Math.max(1, rows) }, (_unused, row) => (
        <TR key={row} data-testid={row === 0 ? testId : undefined}>
          {Array.from({ length: Math.max(1, columns) }, (_column, column) => (
            <TD key={column}>
              {/* One announcement for the whole block, on its first cell. */}
              {row === 0 && column === 0 ? <span className="sr-only">Loading…</span> : null}
              <Skeleton className={cn('h-4', column === 0 ? 'w-40' : 'w-16')} />
            </TD>
          ))}
        </TR>
      ))}
    </>
  )
}
