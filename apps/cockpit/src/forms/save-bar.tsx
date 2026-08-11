import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n-context'
import { StatusBadge } from './status-badge'
import type { SectionStatus, SectionTone } from './use-form'

/**
 * The state of the work, not just a button.
 *
 * It says three things at once: whether there is anything to save, why the save
 * is unavailable if it is, and how to get back to where the form started. The
 * reason is written out rather than hidden in a disabled button's tooltip — a
 * disabled control with no explanation is the single most common way a console
 * makes someone give up.
 */
export function SaveBar({
  dirty,
  canSave,
  isSaving,
  errorCount,
  onSave,
  onReset,
  extra,
  className,
  'data-testid': testId = 'ck-save-bar',
}: {
  dirty: boolean
  canSave: boolean
  isSaving: boolean
  errorCount: number
  onSave: () => void
  onReset: () => void
  /** Anything the page wants beside the buttons — a publish toggle, a preview link. */
  extra?: ReactNode
  className?: string
  'data-testid'?: string
}) {
  const { t } = useI18n()
  return (
    <div data-testid={testId} className={cn('flex items-center gap-3', className)}>
      {extra}
      <span data-testid={`${testId}-state`} className="text-xs text-muted-foreground">
        {errorCount > 0
          ? t(errorCount === 1 ? 'save.problem' : 'save.problemsMany', { count: errorCount })
          : isSaving
            ? t('save.saving')
            : dirty
              ? t('save.unsavedChanges')
              : t('save.allSaved')}
      </span>
      <Button variant="outline" size="sm" data-testid={`${testId}-reset`} disabled={!dirty || isSaving} onClick={onReset}>
        {t('save.discard')}
      </Button>
      {/* `Button` has no `isPending`: the spinner is composed, `data-icon` earns
          it the leading padding, and `disabled` is what actually stops a second
          submit. */}
      <Button size="sm" data-testid={`${testId}-save`} disabled={!canSave} onClick={onSave}>
        {isSaving ? <Spinner data-icon="inline-start" /> : null}
        {t('save.save')}
      </Button>
    </div>
  )
}

/** A compact "there is unsaved work here" marker for a header or a tab. */
export function UnsavedPill({
  dirty,
  className,
  'data-testid': testId = 'ck-unsaved-pill',
}: {
  dirty: boolean
  className?: string
  'data-testid'?: string
}) {
  const { t } = useI18n()
  if (!dirty) return null
  // `StatusBadge` already draws the warning icon for this tone, so nothing here
  // names a colour or a size.
  return (
    <StatusBadge tone="warning" data-testid={testId} className={className}>
      {t('save.unsaved')}
    </StatusBadge>
  )
}

const toneDot: Record<SectionTone, string> = {
  neutral: 'bg-muted-foreground/40',
  ok: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-destructive',
}

/**
 * The section strip of a detail page.
 *
 * Each entry carries its own status and, crucially, the words that go with it.
 * A red dot alone makes the operator open all nine sections to find the one
 * that is wrong; "Endpoint missing" makes it one click.
 */
export function SectionNav<T extends string>({
  sections,
  value,
  onChange,
  status,
  className,
  'data-testid': testId = 'ck-section-nav',
}: {
  sections: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  status: (id: T) => SectionStatus
  className?: string
  'data-testid'?: string
}) {
  return (
    <nav
      data-testid={testId}
      className={cn('grid gap-2 sm:grid-cols-2 xl:grid-cols-3', className)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        const at = sections.findIndex((section) => section.id === value)
        const next = sections[(at + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length]
        if (next) {
          event.preventDefault()
          onChange(next.id)
        }
      }}
    >
      {sections.map((section) => {
        const state = status(section.id)
        const active = section.id === value
        return (
          <button
            key={section.id}
            type="button"
            aria-current={active}
            data-testid={`${testId}-${section.id}`}
            onClick={() => onChange(section.id)}
            className={cn(
              'flex min-w-0 flex-col gap-1 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              active ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted/60',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className={cn('h-1.5 w-1.5 rounded-full', toneDot[state.tone])} />
              {section.label}
            </span>
            <span
              className={cn(
                'truncate text-xs',
                state.tone === 'error'
                  ? 'text-destructive'
                  : state.tone === 'warning'
                    ? 'text-warning'
                    : 'text-muted-foreground',
              )}
            >
              {state.text || '—'}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

/** The inline "saved" acknowledgement, for the moment after a successful write. */
export function SavedNote({ className }: { className?: string }) {
  const { t } = useI18n()
  return (
    <StatusBadge tone="success" className={className}>
      <Check data-icon="inline-start" />
      {t('save.saved')}
    </StatusBadge>
  )
}
