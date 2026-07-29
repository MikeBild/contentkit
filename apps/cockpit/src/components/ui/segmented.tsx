import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  disabledReason?: string
}

/**
 * Two or three mutually exclusive options, all visible at once. A `<select>`
 * hides the alternatives behind a click, which for a set this small costs more
 * than it saves — and for a pair like "default / on / off" the whole point is
 * seeing that a third state exists.
 *
 * `radiogroup` rather than a row of buttons: arrow keys move within the group
 * and Tab leaves it, which is what a keyboard operator expects from a choice.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  disabled,
  'aria-labelledby': labelledBy,
  'data-testid': testId = 'ck-segmented',
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  disabled?: boolean
  'aria-labelledby'?: string
  'data-testid'?: string
}) {
  const enabled = options.filter((option) => !option.disabled)

  function step(direction: 1 | -1) {
    if (enabled.length === 0) return
    const at = enabled.findIndex((option) => option.value === value)
    const next = enabled[(at + direction + enabled.length) % enabled.length]
    if (next) onChange(next.value)
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      data-testid={testId}
      className={cn('inline-flex rounded-lg border border-border bg-background p-0.5', className)}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') step(1)
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') step(-1)
        else return
        event.preventDefault()
      }}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled || option.disabled}
            title={option.disabled ? option.disabledReason : undefined}
            data-testid={`${testId}-${option.value}`}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
              active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
