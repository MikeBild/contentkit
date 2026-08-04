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
 * The one id scheme both halves use, so that a tab and its panel can address
 * each other across the gap between them.
 *
 * They are siblings, not parent and child — see the note on `Tabs` — so there is
 * no context to carry an id through and the page has to name the pair. `group`
 * is that name: one string per strip, and `${group}-tab-compile` /
 * `${group}-panel-compile` are then derivable from either side.
 */
const tabDomId = (group: string, id: string) => `${group}-tab-${id}`
const panelDomId = (group: string, id: string) => `${group}-panel-${id}`

/**
 * The tab strip only. It deliberately does not own the panels: the console's
 * detail pages keep every section mounted and hide the inactive ones, so that
 * editor state and scroll position survive a tab switch. A Tabs component that
 * renders `{active === id && <Panel/>}` would take that away.
 *
 * ←/→ move between tabs, which is what the WAI-ARIA tab pattern promises and
 * what a `<div>` strip never delivers.
 *
 * `group` is the other half of that promise, and it is optional for one reason
 * that is a finding rather than a design: this component used to write
 * `aria-controls={`${useId()}-${tab.id}-panel`}` on every tab, and `TabPanel`
 * carried no `id` at all — so every tab in the console pointed at an element
 * that has never existed. A reference that resolves to nothing is worse than no
 * reference: "controls a panel" is announced and then there is no panel to go
 * to. So `aria-controls` is now emitted only where it can be resolved, which is
 * where the caller has named the group, and the strips that have not been
 * converted emit none rather than a broken one.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onValueChange,
  className,
  group,
  'data-testid': testId = 'ck-tabs',
}: {
  tabs: readonly TabDefinition<T>[]
  value: T
  onValueChange: (value: T) => void
  className?: string
  /** Names this strip so its `TabPanel`s can be addressed. See `tabDomId`. */
  group?: string
  'data-testid'?: string
}) {
  const auto = useId()
  const scope = group ?? auto
  const enabled = tabs.filter((tab) => !tab.disabled)

  function step(direction: 1 | -1) {
    if (enabled.length === 0) return
    const at = enabled.findIndex((tab) => tab.id === value)
    const next = enabled[(at + direction + enabled.length) % enabled.length]
    if (!next) return
    onValueChange(next.id)
    /*
      Focus follows selection, which is the other half of the arrow-key promise.
      Selection alone left the ring on the tab the reader had just left — a tab
      that now draws as unselected and carries `tabIndex={-1}`, so the strip
      looked like it had moved and the keyboard had not. Addressed by id rather
      than by a ref map because the ids are this component's own and unique to
      the strip; the node is the one currently rendered, and its id does not
      change when `value` does.
    */
    document.getElementById(tabDomId(scope, next.id))?.focus()
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
            id={tabDomId(scope, tab.id)}
            aria-selected={active}
            aria-controls={group ? panelDomId(group, tab.id) : undefined}
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

/**
 * Pairs with `Tabs`: stays mounted, hidden when inactive.
 *
 * `hidden` rather than unmounted is the whole point of this pair, and it has one
 * consequence that is not a detail — a hidden panel is out of the accessibility
 * tree. Anything rendered inside an inactive panel is on nobody's screen and in
 * nobody's ear: `role="alert"` in there interrupts no one, because a live region
 * that is not rendered does not announce. **A result the reader did not ask to
 * see does not belong in a panel.** It belongs above the strip, where it is
 * always on screen, and the strip's badge is what says which panel it came from.
 * `pages/compositions.tsx` is the worked example and
 * `pages/compositions.test.tsx` is what holds it there.
 *
 * `group` and `id` name the tab this panel belongs to, and the pair is all or
 * nothing: without them the panel keeps its role and its `hidden` and simply
 * carries no id for a tab to point at — which is the state every strip in this
 * console was in, since neither half had ever been given one.
 */
export function TabPanel({
  active,
  group,
  id,
  children,
  className,
  'data-testid': testId,
}: {
  active: boolean
  /** The `group` of the `Tabs` this panel belongs to. */
  group?: string
  /** The `TabDefinition.id` of the tab that shows this panel. */
  id?: string
  children: ReactNode
  className?: string
  'data-testid'?: string
}) {
  const named = group !== undefined && id !== undefined
  return (
    <div
      role="tabpanel"
      id={named ? panelDomId(group, id) : undefined}
      aria-labelledby={named ? tabDomId(group, id) : undefined}
      hidden={!active}
      data-testid={testId}
      className={className}
    >
      {children}
    </div>
  )
}
