import { ChevronLeft, ChevronRight } from 'lucide-react'
import { hasNext, hasPrevious, nextPage, pageNumber, previousPage, type CursorPage } from '@/lib/cursor'
import { cn } from '@/lib/utils'
import { Button } from './primitives'
import { Spinner } from './spinner'

/**
 * Forward and back through a cursor-paged list.
 *
 * Cursors, not page numbers, because that is what the API has: the paged reads
 * take `limit` and an opaque `cursor` and answer `{ items, next_cursor }`. There
 * is no total, so this control never prints one — a "1–50 of 4 312" that was
 * counted client-side is a number the server never said. There is no cursor for
 * "page 4" either, so there are no numbered links: the position is reported as a
 * fact the operator walked to, and the only two moves are the two the endpoint
 * supports.
 *
 * It renders nothing on a list that fits on one page. A pager under a table of
 * six rows is decoration, and the console's rule is that pixels go to exceptions.
 */
export function Pagination({
  page,
  nextCursor,
  onChange,
  isLoading,
  shown,
  unit = 'rows',
  className,
  'data-testid': testId = 'ck-pagination',
}: {
  page: CursorPage
  /** `next_cursor` from the response that produced the rows on screen. */
  nextCursor: string | null | undefined
  onChange: (page: CursorPage) => void
  isLoading?: boolean
  /** How many rows this page actually holds — a count, never a total. */
  shown?: number
  unit?: string
  className?: string
  'data-testid'?: string
}) {
  const back = hasPrevious(page)
  const forward = hasNext(nextCursor)
  if (!back && !forward) return null

  return (
    <nav
      aria-label="Pagination"
      data-testid={testId}
      className={cn('flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs', className)}
    >
      <span data-testid={`${testId}-position`} className="flex items-center gap-2 text-muted-foreground">
        Page {pageNumber(page)}
        {shown === undefined ? null : ` · ${shown} ${unit}`}
        {/* The end of the list is worth saying: with no total on screen, a
            disabled Next is otherwise indistinguishable from a slow one. */}
        {forward ? null : ' · end of the list'}
        {isLoading ? <Spinner size="sm" label="Loading this page…" /> : null}
      </span>
      <span className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          data-testid={`${testId}-previous`}
          disabled={!back || isLoading}
          onClick={() => onChange(previousPage(page))}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid={`${testId}-next`}
          // Disabled while the page is in flight as well as at the end: the
          // response carries the only cursor forward, so a second click before it
          // lands would advance twice through one of them.
          disabled={!forward || isLoading}
          onClick={() => onChange(nextPage(page, nextCursor))}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </span>
    </nav>
  )
}
