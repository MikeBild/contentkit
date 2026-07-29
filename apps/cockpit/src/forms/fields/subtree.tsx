import { useRef, type ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/**
 * A whole settings subtree that may be absent.
 *
 * Absent and present-but-empty are different on the wire and behave
 * differently: `settings.reports` missing means the site has no report series,
 * `settings.reports: {}` means it has an empty configuration that will be
 * validated on every write. Nesting a form inside a switch is what makes the
 * distinction visible and reversible — turning it off restores absence, it does
 * not write a tree of nulls.
 *
 * The last value is kept while it is off, so an accidental toggle does not cost
 * ten fields of work; nothing of it reaches the wire until it is on again.
 */
export function OptionalSubtree<T>({
  label,
  description,
  value,
  onChange,
  create,
  children,
  className,
  disabled,
  'data-testid': testId,
}: {
  label: string
  description?: ReactNode
  value: T | undefined
  onChange: (value: T | undefined) => void
  /** The subtree a fresh "on" produces. Should be the server's own defaults. */
  create: () => T
  children: (value: T) => ReactNode
  className?: string
  disabled?: boolean
  'data-testid': string
}) {
  const present = value !== undefined
  const lastPresent = useRef<T | undefined>(value)
  if (present) lastPresent.current = value

  return (
    <section data-testid={testId} className={cn('rounded-xl border border-border', className)}>
      <header className="flex items-start justify-between gap-4 p-4">
        <div>
          <h3 className="text-sm font-medium">{label}</h3>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <Switch
          aria-label={label}
          data-testid={`${testId}-toggle`}
          disabled={disabled}
          checked={present}
          onCheckedChange={(next) => onChange(next ? (lastPresent.current ?? create()) : undefined)}
        />
      </header>
      {present ? (
        <div data-testid={`${testId}-body`} className="flex flex-col gap-4 border-t border-border p-4">
          {children(value)}
        </div>
      ) : null}
    </section>
  )
}
