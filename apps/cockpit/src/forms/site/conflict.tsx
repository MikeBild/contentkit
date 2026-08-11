import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/lib/i18n-context'

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
  const { t } = useI18n()
  const [showDiff, setShowDiff] = useState(false)
  const changes = diffPaths(conflict.baseline, conflict.current, {
    notSet: t('conflict.notSet'),
    items: (count) => t('conflict.items', { count }),
    keys: (count) => t('conflict.keysValue', { count }),
  })

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // The overwrite is a full PATCH of someone else's settings. While it is
        // in the air neither answer has landed, so nothing dismisses this.
        if (isSaving) return
        if (!next) onCancel()
      }}
    >
      <DialogContent
        data-testid="ck-site-conflict"
        className="sm:max-w-2xl"
        closeDisabled={isSaving}
        onEscapeKeyDown={(event) => {
          if (isSaving) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (isSaving) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('conflict.title')}</DialogTitle>
          <DialogDescription>
            {t(changes.length === 1 ? 'conflict.oneKey' : 'conflict.keys', { count: changes.length })}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-thin overflow-y-auto">
          {/* Two answers with opposite, irreversible consequences: an Alert, not a
              grey line above the buttons. */}
          <Alert data-testid="ck-site-conflict-consequences">
            <TriangleAlert />
            <AlertTitle>{t('conflict.consequencesTitle')}</AlertTitle>
            <AlertDescription>{t('conflict.consequences')}</AlertDescription>
          </Alert>
          {showDiff ? (
            <ul data-testid="ck-site-conflict-list" className="mt-4 flex flex-col gap-1">
              {changes.map((change) => (
                <li key={change.path} className="rounded-lg border border-border p-2 text-xs">
                  <div className="font-mono text-muted-foreground">{change.path}</div>
                  {/* The two values are truncated to keep the row one line, so the
                      full value has to be reachable — and a native `title` is neither
                      keyboard- nor touch-reachable. */}
                  <TooltipProvider>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="truncate" data-testid={`ck-site-conflict-mine-${change.path}`}>
                            <span className="text-muted-foreground">{t('conflict.loaded')} </span>
                            {change.mine}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{change.mine}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="truncate" data-testid={`ck-site-conflict-theirs-${change.path}`}>
                            <span className="text-muted-foreground">{t('conflict.now')} </span>
                            {change.theirs}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{change.theirs}</TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            data-testid="ck-site-conflict-diff"
            onClick={() => setShowDiff((open) => !open)}
          >
            {t(showDiff ? 'conflict.hide' : 'conflict.show')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="ck-site-conflict-reload"
            disabled={isSaving}
            onClick={onReload}
          >
            {t('conflict.reload')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            data-testid="ck-site-conflict-overwrite"
            disabled={isSaving}
            onClick={onOverwrite}
          >
            {isSaving ? <Spinner data-icon="inline-start" /> : null}
            {t('conflict.overwrite')}
          </Button>
        </DialogFooter>
      </DialogContent>
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
  labels: {
    notSet: string
    items: (count: number) => string
    keys: (count: number) => string
  } = {
    notSet: 'not set',
    items: (count) => `${count} item(s)`,
    keys: (count) => `${count} key(s)`,
  },
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
    changes.push({ path: path || '(root)', mine: describe(a, labels), theirs: describe(b, labels) })
  }
  walk(baseline, current, '')
  return changes
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function describe(
  value: unknown,
  labels: { notSet: string; items: (count: number) => string; keys: (count: number) => string },
) {
  if (value === undefined) return labels.notSet
  if (Array.isArray(value)) return labels.items(value.length)
  if (value && typeof value === 'object') return labels.keys(Object.keys(value).length)
  return String(value)
}
