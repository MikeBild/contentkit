import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TabDefinition<T extends string> {
  id: T
  label: ReactNode
  /** A count, a status dot — whatever the tab wants to say without being opened. */
  badge?: ReactNode
  disabled?: boolean
}

/**
 * The tab strip only. It deliberately does not own the panels: the console's
 * detail pages keep every section mounted and hide the inactive ones, so that
 * editor state and scroll position survive a tab switch. A Tabs component that
 * renders `{active === id && <Panel/>}` would take that away.
 *
 * ←/→ move between tabs, which is what the WAI-ARIA tab pattern promises and
 * what a `<div>` strip never delivers.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onValueChange,
  className,
  'data-testid': testId = 'ck-tabs',
}: {
  tabs: readonly TabDefinition<T>[]
  value: T
  onValueChange: (value: T) => void
  className?: string
  'data-testid'?: string
}) {
  const group = useId()
  const enabled = tabs.filter((tab) => !tab.disabled)

  function step(direction: 1 | -1) {
    if (enabled.length === 0) return
    const at = enabled.findIndex((tab) => tab.id === value)
    const next = enabled[(at + direction + enabled.length) % enabled.length]
    if (next) onValueChange(next.id)
  }

  return (
    <div
      role="tablist"
      data-testid={testId}
      className={cn('flex gap-1 border-b border-border', className)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') step(1)
        else if (event.key === 'ArrowLeft') step(-1)
        else return
        event.preventDefault()
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${group}-${tab.id}`}
            aria-selected={active}
            aria-controls={`${group}-${tab.id}-panel`}
            tabIndex={active ? 0 : -1}
            disabled={tab.disabled}
            data-testid={`${testId}-${tab.id}`}
            onClick={() => onValueChange(tab.id)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
              active
                ? 'border-accent font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.badge}
          </button>
        )
      })}
    </div>
  )
}

/** Pairs with `Tabs`: stays mounted, hidden when inactive. */
export function TabPanel({
  active,
  children,
  className,
  'data-testid': testId,
}: {
  active: boolean
  children: ReactNode
  className?: string
  'data-testid'?: string
}) {
  return (
    <div role="tabpanel" hidden={!active} data-testid={testId} className={className}>
      {children}
    </div>
  )
}
