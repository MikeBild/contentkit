import { Inbox, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * Every list in the console has the same four states, and conflating them is
 * how "empty" ends up looking identical to "failed". They are spelled out once
 * here so no page can quietly skip one.
 *
 * Carried over from the hand-rolled `ui/primitives.tsx` rather than reinvented
 * — the four-state discipline is the point of it — but rebuilt on the real
 * components: shadcn's `Table` parts, `Skeleton` for the placeholder rows,
 * `Alert variant="destructive"` for the failure and `Empty` for the empty
 * result. The four branches are four different components on purpose, so no two
 * of them can be mistaken for each other on screen. The test ids are unchanged;
 * `table-state-loading` and `table-retry` are driven by existing automation.
 *
 * It lives under `forms/` rather than `components/ui/` because it is
 * ContentKit's own composition and not a shadcn component: `shadcn add
 * table-state` has nothing to answer with.
 */
export function TableState({
  columns,
  isLoading,
  error,
  isEmpty,
  onRetry,
  emptyTitle,
  emptyMessage = 'Nothing here yet.',
  children,
}: {
  columns: number
  isLoading: boolean
  error: unknown
  isEmpty: boolean
  onRetry?: () => void
  /**
   * The empty state's heading, when "nothing here" and "nothing matches these
   * filters" are different situations. Without it the message is the heading.
   */
  emptyTitle?: string
  emptyMessage?: string
  children: ReactNode
}) {
  // Shape-preserving rows rather than one centred word: the header is already on
  // screen, so a single "Loading…" cell collapses the table to one line and then
  // shoves it open when the data lands. One announcement for the whole block, on
  // its first cell — fourteen rectangles announced one by one is worse than
  // silence — and every rectangle after that is `aria-hidden`.
  if (isLoading)
    return (
      <>
        {Array.from({ length: 5 }, (_unused, row) => (
          <TableRow key={row} data-testid={row === 0 ? 'table-state-loading' : undefined}>
            {Array.from({ length: columns }, (_column, column) => (
              <TableCell key={column}>
                {row === 0 && column === 0 ? <span className="sr-only">Loading…</span> : null}
                <Skeleton aria-hidden="true" className={cn('h-4', column === 0 ? 'w-40' : 'w-16')} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </>
    )

  // A failure is an `Alert`, an empty result is an `Empty`. Both were `Empty`
  // once, differing only in wording inside the same dashed frame — which is the
  // conflation this component exists to prevent, drawn by the component itself.
  // `Alert` is a solid-bordered callout that carries `role="alert"`, so the
  // failure is announced as well as visibly a different thing.
  if (error)
    return (
      <TableRow>
        <TableCell colSpan={columns}>
          <Alert variant="destructive" data-testid="table-state-error">
            {/* Direct child of Alert, before the title: the CVA switches to a
                two-column grid on `has-[>svg]`, and an icon in a wrapper breaks it. */}
            <TriangleAlert />
            <AlertTitle>This list could not be read</AlertTitle>
            <AlertDescription data-testid="table-state-error-message">
              {error instanceof Error ? error.message : 'Request failed'}
            </AlertDescription>
            {onRetry ? (
              <AlertAction>
                <Button data-testid="table-retry" size="sm" variant="outline" onClick={onRetry}>
                  Retry
                </Button>
              </AlertAction>
            ) : null}
          </Alert>
        </TableCell>
      </TableRow>
    )

  if (isEmpty)
    return (
      <TableRow>
        <TableCell colSpan={columns}>
          {/* `Empty` sets `border-dashed` with no border width, so the frame is
              asked for here. The dashed frame and the icon are what say "there is
              a list, it just has nothing in it" at a glance. */}
          <Empty className="border" data-testid="table-state-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle>{emptyTitle ?? emptyMessage}</EmptyTitle>
              {emptyTitle ? <EmptyDescription>{emptyMessage}</EmptyDescription> : null}
            </EmptyHeader>
          </Empty>
        </TableCell>
      </TableRow>
    )

  return <>{children}</>
}
