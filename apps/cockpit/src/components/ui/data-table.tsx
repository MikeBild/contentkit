import { useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from 'lucide-react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TableState } from '@/forms/table-state'
import { firstPage, type CursorPage } from '@/lib/cursor'
import {
  clampPage,
  decodeSort,
  decodeVisible,
  defaultVisible,
  encodeSort,
  encodeVisible,
  isOfferable,
  nextSort,
  reconcileSort,
  sortReach,
  toggleVisible,
  windowOf,
  type ColumnCapability,
  type Paging,
  type SortState,
} from '@/lib/table-view'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n-context'
import { Button } from './button'
import { Card } from './card'
import { Checkbox } from './checkbox'
import { Pagination } from './pagination'
import { SkeletonRows } from './skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

/**
 * The console's lists, on the shared Table rather than instead of it.
 *
 * `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` from
 * `./table` stay the markup and `TableState` from `@/forms/table-state` stays
 * the four-state discipline; this adds the three things every list in the
 * console was missing and nothing else: a window over the rows, a header that
 * can reorder them, and a way to put a column away.
 *
 * All three are capability-driven, from `@/lib/table-view`. A sort control is
 * rendered only where a sort would actually cover the whole result — see
 * `sortReach` — because a header arrow that quietly reorders one page of forty is
 * indistinguishable from a sorted list and is not one. The window is a cursor
 * either way: an opaque one from the endpoint when it pages, a row offset minted
 * client-side when the endpoint answers the list whole, so both shapes drive the
 * same reducer and the same `Pagination`.
 *
 * The four states are still four. Loading is `SkeletonRows` — the header is
 * already on screen and a single centred "Loading…" cell collapses the table to
 * one row and then expands it, under a pointer already aimed at a row action —
 * and error, empty and rows remain `TableState`'s, so an empty result and a
 * failed request cannot end up looking the same.
 */

export interface DataColumn<Row> extends Omit<ColumnCapability, 'comparable'> {
  label: string
  cell: (row: Row, rowIndex: number) => ReactNode
  /** Responsive importance. Detail columns move out before identity and actions. */
  priority?: 'essential' | 'supporting' | 'detail'
  /** Semantic role used by layout checks and future column policies. */
  kind?: 'identity' | 'status' | 'meta' | 'actions'
  /**
   * Presence is the capability: a column with a comparator can be ordered by the
   * console, one without it cannot be ordered at all.
   */
  compare?: (left: Row, right: Row) => number
  className?: string
  /** For a column whose header is deliberately blank, such as row actions. */
  headerHidden?: boolean
}

export interface TableView {
  visible: readonly string[]
  sort: SortState | null
}

function capabilities<Row>(columns: readonly DataColumn<Row>[]): ColumnCapability[] {
  return columns.map((column) => ({
    id: column.id,
    comparable: Boolean(column.compare),
    server: column.server,
    required: column.required,
    hiddenByDefault: column.hiddenByDefault,
    descFirst: column.descFirst,
  }))
}

/**
 * Where a list's column choice and order live: in the URL, with the last choice
 * remembered as the opening guess.
 *
 * This is the pattern `?site=` already established in lib/site.tsx, for the same
 * reason. A view that exists only in React state makes every link mean something
 * different for the person who receives it — "look at this list" arrives sorted
 * and trimmed some other way, or not at all. The search param is the truth.
 *
 * localStorage is not a second truth, only the guess for a URL that names no
 * view: the console's own links carry `?site=` and nothing else (see AppLink), so
 * leaving /content for /releases and coming back drops the parameter. The stored
 * value is adopted once, with `replace`, which puts it back in the URL where the
 * rest of the session can see it — and never overrides a view the URL did name.
 *
 * Parameters are prefixed with the list's id, so two lists cannot read each
 * other's column ids, and `to: '.'` rewrites the current route's search rather
 * than navigating, so choosing a column never leaves the page.
 */
export function useTableView<Row>(listId: string, columns: readonly DataColumn<Row>[], paging: Paging = 'whole') {
  const specs = useMemo(() => capabilities(columns), [columns])
  const columnsKey = `${listId}.cols`
  const sortKey = `${listId}.sort`
  const storageKey = `ck-cockpit-view:${listId}`
  // strict: false — RootSearch types only `site`, and the router is not in strict
  // search mode, so unrecognised keys survive both the URL and this read. Same
  // escape hatch SiteProvider uses.
  const search = useSearch({ strict: false }) as Record<string, unknown>
  const navigate = useNavigate()

  const rawColumns = typeof search[columnsKey] === 'string' ? (search[columnsKey] as string) : undefined
  const rawSort = typeof search[sortKey] === 'string' ? (search[sortKey] as string) : undefined

  // The URL wins whenever it says anything at all, so a link that deliberately
  // names the default view is not overruled by what this browser last chose.
  const named = rawColumns !== undefined || rawSort !== undefined
  const remembered = useMemo(() => (named ? null : readStored(storageKey)), [named, storageKey])
  const visible = useMemo(
    () => decodeVisible(specs, rawColumns ?? remembered?.cols),
    [specs, rawColumns, remembered?.cols],
  )
  const sort = useMemo(
    () => reconcileSort(specs, paging, visible, decodeSort(specs, paging, rawSort ?? remembered?.sort)),
    [specs, paging, visible, rawSort, remembered?.sort],
  )

  const write = useCallback(
    (next: TableView, replace: boolean) => {
      const cols = encodeVisible(specs, next.visible)
      const order = encodeSort(reconcileSort(specs, paging, next.visible, next.sort))
      try {
        // Only a deliberate view is remembered; the default view stores nothing,
        // so a later release that adds a column is not overruled by an old guess.
        if (cols === undefined && order === undefined) localStorage.removeItem(storageKey)
        else localStorage.setItem(storageKey, JSON.stringify({ cols, sort: order }))
      } catch {
        // A console in private mode still works; it just forgets between visits.
      }
      void navigate({
        to: '.',
        search: ((previous: Record<string, unknown>) => ({
          ...previous,
          [columnsKey]: cols,
          [sortKey]: order,
        })) as never,
        replace,
      })
    },
    [specs, paging, navigate, columnsKey, sortKey, storageKey],
  )

  const setView = useCallback((next: TableView) => write(next, false), [write])

  // The remembered view is put back into the URL rather than merely applied, so a
  // link copied after the adoption carries it. `replace`, so Back does not walk
  // into the URL the operator never chose.
  const adopted = remembered !== null && (remembered.cols !== undefined || remembered.sort !== undefined)
  useAdopt(adopted, () => write({ visible, sort }, true))

  return { view: { visible, sort } as TableView, setView }
}

function readStored(key: string): { cols?: string; sort?: string } | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    return {
      cols: typeof record.cols === 'string' ? record.cols : undefined,
      sort: typeof record.sort === 'string' ? record.sort : undefined,
    }
  } catch {
    return null
  }
}

/**
 * One navigation, on the render that first found a stored view and no URL view.
 *
 * `run` is held in a ref rather than listed as a dependency: it closes over the
 * view it is about to write, so depending on its identity would navigate on every
 * render, and leaving it out of the array would freeze the first closure.
 */
function useAdopt(active: boolean, run: () => void) {
  const latest = useRef(run)
  latest.current = run
  const fired = useRef(false)
  useEffect(() => {
    if (!active || fired.current) return
    fired.current = true
    latest.current()
  }, [active])
}

export function DataTable<Row>({
  testId,
  columns,
  rows,
  rowKey,
  rowTestId,
  expandedRowTestId,
  rowAttributes,
  isLoading,
  error,
  onRetry,
  emptyMessage,
  view,
  onViewChange,
  page,
  onPageChange,
  pageSize = 25,
  paging = 'whole',
  nextCursor,
  unit,
  toolbar,
  renderMobileRow,
  renderExpandedRow,
}: {
  testId: string
  columns: readonly DataColumn<Row>[]
  /** Every row for `'whole'`, the current page's rows for `'cursor'`. */
  rows: readonly Row[]
  rowKey: (row: Row) => string
  /** Readable selector base; the visible row position is appended automatically. */
  rowTestId?: string
  /** Readable selector base; the visible row position is appended automatically. */
  expandedRowTestId?: string
  rowAttributes?: (row: Row) => Record<string, string>
  isLoading: boolean
  error: unknown
  onRetry?: () => void
  emptyMessage?: string
  view: TableView
  onViewChange: (view: TableView) => void
  page: CursorPage
  onPageChange: (page: CursorPage) => void
  pageSize?: number
  paging?: Paging
  /** `next_cursor` from the response. Ignored — and not needed — when `'whole'`. */
  nextCursor?: string | null
  unit?: string
  /** Filters and other controls that belong beside the column chooser. */
  toolbar?: ReactNode
  /** A compact, fully readable row used below the `md` breakpoint. */
  renderMobileRow?: (row: Row, rowIndex: number) => ReactNode
  /** Optional evidence/details rendered directly after their owning row. */
  renderExpandedRow?: (row: Row) => ReactNode
}) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<'wide' | 'medium' | 'narrow'>('wide')
  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const update = (width: number) => setLayout(width < 640 ? 'narrow' : width < 960 ? 'medium' : 'wide')
    update(node.clientWidth)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const unitLabel = unit ?? t('common.items')
  const specs = useMemo(() => capabilities(columns), [columns])
  const shown = useMemo(() => columns.filter((column) => view.visible.includes(column.id)), [columns, view.visible])
  const responsiveColumns = useMemo(
    () => layout === 'medium' ? shown.filter((column) => column.priority !== 'detail') : shown,
    [layout, shown],
  )
  const sort = reconcileSort(specs, paging, view.visible, view.sort)

  const ordered = useMemo(() => {
    if (paging !== 'whole' || !sort) return rows
    const column = columns.find((entry) => entry.id === sort.column)
    const compare = column?.compare
    if (!compare) return rows
    // Sort a copy: the array belongs to the query cache. `sort` is stable, so
    // ties keep the order the endpoint sent them in.
    const sorted = [...rows]
    sorted.sort(sort.direction === 'asc' ? compare : (left, right) => compare(right, left))
    return sorted
  }, [paging, sort, rows, columns])

  const position = paging === 'whole' ? clampPage(page, ordered.length, pageSize) : page
  const slice = windowOf(ordered.length, position.cursor, pageSize)
  const visibleRows = paging === 'whole' ? ordered.slice(slice.start, slice.end) : ordered
  const forward = paging === 'whole' ? slice.nextCursor : (nextCursor ?? null)

  const activeReach = sort
    ? sortReach(
        specs.find((spec) => spec.id === sort.column),
        paging,
      )
    : 'none'
  const activeLabel = shown.find((column) => column.id === sort?.column)?.label

  /**
   * Whether there are rows on screen for a note to describe.
   *
   * `sort` comes from the URL and from localStorage, so it is set before the first
   * response arrives and it survives a failed one — while `ordered.length` is 0 for
   * both, because `rows` is `items.data ?? []`. Opening a sorted link cold would
   * otherwise print "across all 0 items" beside the skeleton, and a failed request
   * would print it beside the error. Neither is a total the endpoint supplied.
   *
   * The empty result is in here too: `TableState` puts the error branch ahead of
   * the empty one, so `visibleRows.length` alone would still claim a total next to
   * a message saying the request failed. All three states replace the rows, and a
   * note about rows that are not on screen describes nothing.
   */
  const describable = !isLoading && !error && visibleRows.length > 0

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      data-data-surface="true"
      data-layout={layout}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          {/* Where the order came from is only worth saying once it is not the
              endpoint's own, and only while there are rows it is true of.
              `'complete'` is the claim that needs backing: the console did the
              ordering, and it covered every row because the response did — so the
              count is the whole response and not the window on screen, which is
              what makes "across all" the right words for it. */}
          {describable && sort && activeLabel ? (
            <span data-testid={`${testId}-order-note`} className="text-xs text-muted-foreground">
              {activeReach === 'server'
                ? t('common.orderedApi', { label: activeLabel })
                : t('common.orderedLocal', { label: activeLabel, count: ordered.length, unit: unitLabel })}
            </span>
          ) : null}
          <ColumnChooser testId={testId} columns={columns} view={view} onViewChange={onViewChange} specs={specs} />
        </div>
      </div>

      {/* `Card`, not a hand-rolled `rounded-xl border bg-surface` — that div was
          a Card spelled out. `gap-0 py-0` because the two children are a table
          and its pager, and the pager draws its own `border-t`: the card's own
          padding and row gap would float that rule away from the last row. */}
      {layout === 'narrow' && describable ? (
        <Card className="gap-0 py-0" data-testid={`${testId}-records`}>
          <div className="divide-y divide-border">
            {visibleRows.map((row, rowIndex) => {
              const expanded = renderExpandedRow?.(row)
              return (
                <Fragment key={rowKey(row)}>
                  <div data-testid={rowTestId ? `${rowTestId}-${rowIndex}` : undefined} {...(rowAttributes?.(row) ?? {})} className="p-4">
                    {renderMobileRow ? (
                      renderMobileRow(row, rowIndex)
                    ) : (
                      <dl className="flex min-w-0 flex-col gap-3">
                        {shown.map((column) => (
                          <div key={column.id} className="grid min-w-0 gap-0.5">
                            {column.headerHidden ? null : (
                              <dt className="text-xs font-medium text-muted-foreground">{column.label}</dt>
                            )}
                            <dd className={cn('min-w-0 text-sm', column.kind === 'actions' && 'flex flex-wrap gap-2')}>
                              {column.cell(row, rowIndex)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                  {expanded ? (
                    <div
                      data-testid={expandedRowTestId ? `${expandedRowTestId}-${rowIndex}` : undefined}
                      {...(rowAttributes?.(row) ?? {})}
                      className="border-t border-border bg-muted/30 p-4"
                    >
                      {expanded}
                    </div>
                  ) : null}
                </Fragment>
              )
            })}
          </div>
        </Card>
      ) : null}
      {layout !== 'narrow' || !describable ? (
      <Card className="gap-0 py-0">
        <Table data-testid={`${testId}-table`} mobileLabels={responsiveColumns.map((column) => column.label)}>
          <TableHeader>
            <TableRow>
              {responsiveColumns.map((column) => {
                const reach = sortReach(
                  specs.find((spec) => spec.id === column.id),
                  paging,
                )
                const active = sort?.column === column.id ? sort.direction : null
                return (
                  <TableHead
                    key={column.id}
                    data-priority={column.priority ?? 'supporting'}
                    data-column-kind={column.kind ?? (column.headerHidden ? 'actions' : 'meta')}
                    className={column.className}
                    aria-sort={
                      !isOfferable(reach)
                        ? undefined
                        : active === 'asc'
                          ? 'ascending'
                          : active === 'desc'
                            ? 'descending'
                            : 'none'
                    }
                  >
                    {column.headerHidden ? (
                      <span className="sr-only">{column.label}</span>
                    ) : isOfferable(reach) ? (
                      <button
                        type="button"
                        data-testid={`${testId}-sort-${column.id}`}
                        onClick={() => onViewChange({ ...view, sort: nextSort(specs, paging, sort, column.id) })}
                        className="inline-flex items-center gap-1 rounded font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {column.label}
                        {active === 'asc' ? (
                          <ArrowUp className="size-3" />
                        ) : active === 'desc' ? (
                          <ArrowDown className="size-3" />
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      column.label
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonRows rows={Math.min(pageSize, 6)} columns={responsiveColumns.length} data-testid={`${testId}-skeleton`} />
            ) : (
              // Loading is handled above, so `TableState` is asked only the three
              // questions it is still the single answer to. Error, empty and rows
              // stay one implementation for every list in the console.
              <TableState
                columns={responsiveColumns.length}
                isLoading={false}
                error={error}
                isEmpty={visibleRows.length === 0}
                onRetry={onRetry}
                emptyMessage={emptyMessage}
              >
                {visibleRows.map((row, rowIndex) => {
                  const expanded = renderExpandedRow?.(row)
                  return (
                    <Fragment key={rowKey(row)}>
                      <TableRow data-testid={rowTestId ? `${rowTestId}-${rowIndex}` : undefined} {...(rowAttributes?.(row) ?? {})}>
                        {responsiveColumns.map((column) => (
                          <TableCell
                            key={column.id}
                            data-priority={column.priority ?? 'supporting'}
                            data-column-kind={column.kind ?? (column.headerHidden ? 'actions' : 'meta')}
                            className={column.className}
                          >
                            {column.cell(row, rowIndex)}
                          </TableCell>
                        ))}
                      </TableRow>
                      {expanded ? (
                        <TableRow
                          data-testid={`${expandedRowTestId ?? `${testId}-expanded-row`}-${rowIndex}`}
                          {...(rowAttributes?.(row) ?? {})}
                        >
                          <TableCell colSpan={responsiveColumns.length} className="bg-muted/30">
                            {expanded}
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  )
                })}
              </TableState>
            )}
          </TableBody>
        </Table>
        <Pagination
          data-testid={`${testId}-pagination`}
          page={position}
          nextCursor={forward}
          onChange={onPageChange}
          isLoading={isLoading}
          shown={visibleRows.length}
          // A total is printed only where the server supplied one by sending
          // every row. A cursor-paged list has no total and does not get one.
          unit={
            paging === 'whole'
              ? t('pagination.totalUnit', { total: ordered.length, unit: unitLabel })
              : unitLabel
          }
        />
      </Card>
      ) : null}
    </div>
  )
}

/**
 * Which columns are on screen.
 *
 * A native `<details>`: it opens on click and on Enter, closes the same way, and
 * needs no focus trap, no portal and no outside-click listener to be correct. It
 * sits above the table rather than inside it, because the table's own wrapper
 * scrolls horizontally and would clip the panel.
 */
function ColumnChooser<Row>({
  testId,
  columns,
  specs,
  view,
  onViewChange,
}: {
  testId: string
  columns: readonly DataColumn<Row>[]
  specs: readonly ColumnCapability[]
  view: TableView
  onViewChange: (view: TableView) => void
}) {
  const { t } = useI18n()
  const hidden = columns.filter((column) => !view.visible.includes(column.id)).length
  return (
    <details className="relative" data-testid={`${testId}-columns`}>
      <summary
        data-testid={`${testId}-columns-toggle`}
        className="inline-flex h-8 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden"
      >
        <Columns3 className="size-3.5" />
        {t('common.columns')}
        {/* The count is an exception, so it is the only thing printed: a chooser
            with nothing hidden has nothing to report. */}
        {hidden ? <span className="text-muted-foreground">{t('common.hidden', { count: hidden })}</span> : null}
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-60 rounded-lg border border-border bg-surface p-2 shadow-lg">
        {columns.map((column) => {
          const on = view.visible.includes(column.id)
          return (
            <label
              key={column.id}
              data-testid={`${testId}-columns-option-${column.id}`}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1.5 text-xs',
                column.required ? 'opacity-60' : 'cursor-pointer hover:bg-muted',
              )}
            >
              <Checkbox
                data-testid={`${testId}-columns-checkbox-${column.id}`}
                checked={on}
                disabled={column.required}
                onCheckedChange={() =>
                  onViewChange({ ...view, visible: toggleVisible(specs, view.visible, column.id) })
                }
              />
              <span>{column.label || column.id}</span>
              {column.required ? <span className="ml-auto text-muted-foreground">{t('common.always')}</span> : null}
            </label>
          )
        })}
        <Button
          data-testid={`${testId}-columns-reset`}
          variant="ghost"
          size="sm"
          className="mt-1 w-full justify-start"
          onClick={() => onViewChange({ visible: defaultVisible(specs), sort: view.sort })}
        >
          {t('common.resetColumns')}
        </Button>
      </div>
    </details>
  )
}

/** The first page, re-exported so a page needs one import for its list state. */
export { firstPage }
