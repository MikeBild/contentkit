import type { ReactNode } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  disabledReason?: string
}

/**
 * Two or three mutually exclusive options, all visible at once. A `<select>`
 * hides the alternatives behind a click, which for a set this small costs more
 * than it saves — and for a trio like "default / on / off" the whole point is
 * seeing that a third state exists.
 *
 * `ToggleGroup type="single"`, not a hand-rolled row of buttons: single mode is
 * what makes Radix emit `role="radiogroup"` with `role="radio"` items, and with
 * it come the roving tabindex, the arrow keys that move within the group and the
 * Tab that leaves it — the keyboard contract this file used to re-implement, one
 * `onKeyDown` at a time, and the pressed state it used to paint in a chart
 * colour. `spacing={0}` is the joined look: the items lose their gap and the
 * first and last take the group's radius.
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
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={value}
      // Radix clears the value when the pressed item is pressed again. A choice
      // between two or three states has no "none of them", so an empty answer
      // keeps what was already chosen rather than unsetting the setting.
      onValueChange={(next) => {
        if (next) onChange(next as T)
      }}
      disabled={disabled}
      aria-labelledby={labelledBy}
      data-testid={testId}
      className={className}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          title={option.disabled ? option.disabledReason : undefined}
          data-testid={`${testId}-${option.value}`}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
