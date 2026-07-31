import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ck, type Revision } from '@/api/ck'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { keys } from '@/lib/query'
import { cn, formatDate } from '@/lib/utils'

/**
 * The revision list, and the two things it is for.
 *
 * A revision is immutable, so "restore" cannot mean "go back": it means load an
 * older source into the editor and save it as a new revision, which leaves the
 * history intact and is the only honest way to undo in an append-only store.
 * The diff exists so that decision is made against what actually changed rather
 * than against a timestamp.
 */
export function Revisions({
  item,
  canWrite,
  onOpen,
  'data-testid': testId = 'ck-revisions',
}: {
  item: string
  canWrite: boolean
  /** Loads this revision's source into the editor as an unsaved draft. */
  onOpen: (revision: Revision) => void
  'data-testid'?: string
}) {
  const [compared, setCompared] = useState<{ newer: Revision; older: Revision | null } | null>(null)
  const query = useQuery({ queryKey: keys.content.revisions(item), queryFn: () => ck.content.revisions(item) })
  const rows = query.data ?? []

  return (
    <div data-testid={testId} className="rounded-xl border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Slug</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Published</TableHead>
            <TableHead>Source hash</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableState
            columns={6}
            isLoading={query.isPending}
            error={query.error}
            isEmpty={rows.length === 0}
            onRetry={() => query.refetch()}
            emptyMessage="No revisions yet."
          >
            {rows.map((revision, index) => (
              <TableRow key={revision.id} data-testid={`${testId}-row`} data-revision={revision.id}>
                <TableCell>
                  <StatusBadge tone={revision.status === 'published' ? 'success' : 'neutral'}>{revision.status}</StatusBadge>
                </TableCell>
                <TableCell className="text-muted-foreground">{revision.slug}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(revision.created_at)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(revision.published_at)}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{revision.source_sha256?.slice(0, 12)}</TableCell>
                <TableCell className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`${testId}-diff-${revision.id}`}
                    disabled={!revision.markdown}
                    onClick={() => setCompared({ newer: revision, older: rows[index + 1] ?? null })}
                  >
                    Diff
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid={`${testId}-open-${revision.id}`}
                    disabled={!canWrite || !revision.markdown}
                    onClick={() => onOpen(revision)}
                  >
                    {index === 0 ? 'Open' : 'Restore into the editor'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableState>
        </TableBody>
      </Table>

      {compared ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setCompared(null)
          }}
        >
          {/* Nothing is in flight here — this reads two revisions that are
              already stored — so there is no busy guard and Escape, the
              backdrop and the X all close it. */}
          <DialogContent data-testid={`${testId}-diff`} className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>What changed</DialogTitle>
              <DialogDescription>
                {compared.older
                  ? `Against the revision from ${formatDate(compared.older.created_at)}.`
                  : 'This is the first revision, so everything in it is new.'}
              </DialogDescription>
            </DialogHeader>
            <div className="scrollbar-thin overflow-y-auto">
              <DiffList before={compared.older?.markdown ?? ''} after={compared.newer.markdown ?? ''} />
            </div>
            <DialogFooter>
              <Button
                size="sm"
                variant="outline"
                data-testid={`${testId}-diff-close`}
                onClick={() => setCompared(null)}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

/**
 * A line diff with the unchanged middle left out.
 *
 * Trimming the common prefix and suffix and showing the rest is not a minimal
 * edit script, and it does not claim to be — it answers "which lines are not the
 * same" exactly, which is the question, and it never invents a pairing between
 * two lines that happen to look alike.
 */
export function DiffList({ before, after }: { before: string; after: string }) {
  const rows = lineDiff(before, after)
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">The source is byte-identical.</p>
  }
  return (
    <ul data-testid="ck-diff-list" className="flex flex-col font-mono text-xs">
      {rows.map((row, index) => (
        <li
          key={index}
          className={cn(
            'flex gap-2 whitespace-pre-wrap break-words px-2 py-0.5',
            row.type === 'add' && 'bg-chart-2/10 text-chart-2',
            row.type === 'remove' && 'bg-chart-5/10 text-chart-5',
            row.type === 'context' && 'text-muted-foreground',
          )}
        >
          <span className="w-10 shrink-0 select-none text-right tabular-nums opacity-60">{row.line}</span>
          <span className="w-3 shrink-0 select-none">
            {row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '}
          </span>
          <span className="min-w-0">{row.text || ' '}</span>
        </li>
      ))}
    </ul>
  )
}

interface DiffRow {
  type: 'add' | 'remove' | 'context'
  text: string
  line: number
}

export function lineDiff(before: string, after: string): DiffRow[] {
  const a = before.split('\n')
  const b = after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail += 1
  }
  const removed = a.slice(head, a.length - tail)
  const added = b.slice(head, b.length - tail)
  if (removed.length === 0 && added.length === 0) return []

  const rows: DiffRow[] = []
  // One line of context on each side: enough to place the change, not enough to
  // turn a two-line edit into a page of unchanged text.
  if (head > 0) rows.push({ type: 'context', text: a[head - 1]!, line: head })
  removed.forEach((text, index) => rows.push({ type: 'remove', text, line: head + index + 1 }))
  added.forEach((text, index) => rows.push({ type: 'add', text, line: head + index + 1 }))
  if (tail > 0) rows.push({ type: 'context', text: a[a.length - tail]!, line: a.length - tail + 1 })
  return rows
}
