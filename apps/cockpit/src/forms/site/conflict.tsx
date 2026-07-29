import { useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/primitives'

export interface SettingsConflict {
  /** The object the form was seeded from. */
  baseline: Record<string, unknown>
  /** What the server holds now, read immediately before the save. */
  current: Record<string, unknown>
}

/**
 * Someone else wrote the settings while this form was open.
 *
 * `PATCH` replaces the object in full, so continuing would delete their change
 * without either of them ever seeing it. The dialog therefore has three answers
 * and no default: take theirs and lose the edits on screen, keep the edits and
 * overwrite theirs, or look at what actually differs first. Nothing here decides
 * on the operator's behalf.
 */
export function ConflictDialog({
  conflict,
  isSaving,
  onReload,
  onOverwrite,
  onCancel,
}: {
  conflict: SettingsConflict
  isSaving: boolean
  onReload: () => void
  onOverwrite: () => void
  onCancel: () => void
}) {
  const [showDiff, setShowDiff] = useState(false)
  const changes = diffPaths(conflict.baseline, conflict.current)

  return (
    <Dialog
      open
      size="lg"
      data-testid="ck-site-conflict"
      title="The site changed while you were editing"
      description={`${changes.length === 1 ? 'One key' : `${changes.length} keys`} were written by someone else since this form was loaded.`}
      busy={isSaving}
      onClose={onCancel}
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            data-testid="ck-site-conflict-diff"
            onClick={() => setShowDiff((open) => !open)}
          >
            {showDiff ? 'Hide differences' : 'Show differences'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="ck-site-conflict-reload"
            disabled={isSaving}
            onClick={onReload}
          >
            Reload theirs
          </Button>
          <Button
            variant="destructive"
            size="sm"
            data-testid="ck-site-conflict-overwrite"
            disabled={isSaving}
            onClick={onOverwrite}
          >
            {isSaving ? 'Saving…' : 'Overwrite with mine'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Reloading discards everything unsaved on this page. Overwriting keeps this page and removes their change.
      </p>
      {showDiff ? (
        <ul data-testid="ck-site-conflict-list" className="mt-4 flex flex-col gap-1">
          {changes.map((change) => (
            <li key={change.path} className="rounded-lg border border-border p-2 text-xs">
              <div className="font-mono text-muted-foreground">{change.path}</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                <span className="truncate" title={change.mine}>
                  <span className="text-muted-foreground">loaded: </span>
                  {change.mine}
                </span>
                <span className="truncate" title={change.theirs}>
                  <span className="text-muted-foreground">now: </span>
                  {change.theirs}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  )
}

/**
 * Every leaf that differs, by dotted path. A whole-object dump would answer the
 * wrong question — the operator needs to know whether the other write touched
 * what they were editing, and that is a list of paths, not a wall of JSON.
 */
export function diffPaths(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
): { path: string; mine: string; theirs: string }[] {
  const changes: { path: string; mine: string; theirs: string }[] = []
  const walk = (a: unknown, b: unknown, path: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return
    if (isObject(a) && isObject(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        walk(a[key], b[key], path ? `${path}.${key}` : key)
      }
      return
    }
    changes.push({ path: path || '(root)', mine: describe(a), theirs: describe(b) })
  }
  walk(baseline, current, '')
  return changes
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function describe(value: unknown) {
  if (value === undefined) return 'not set'
  if (Array.isArray(value)) return `${value.length} item(s)`
  if (value && typeof value === 'object') return `${Object.keys(value).length} key(s)`
  return String(value)
}
