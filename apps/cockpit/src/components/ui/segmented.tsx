import type { ReactNode } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

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
 *
 * An option that cannot be picked says why, in a Tooltip rather than in a native
 * `title` — and it is `aria-disabled` rather than `disabled` so that there is
 * something left to hover, focus or tap. A `disabled` radio is removed from the
 * roving tabindex, so the sentence explaining it was reachable by a pointer and
 * by nothing else; the refusal itself moves into `onValueChange`, which is where
 * `forms/fields/choice.tsx` already keeps it.
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
        if (!next) return
        // `aria-disabled` announces the refusal; this enforces it.
        if (options.find((option) => option.value === next)?.disabled) return
        onChange(next as T)
      }}
      disabled={disabled}
      aria-labelledby={labelledBy}
      data-testid={testId}
      className={className}
    >
      {options.map((option) => {
        const item = (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            aria-disabled={option.disabled || undefined}
            data-testid={`${testId}-${option.value}`}
          >
            {option.label}
          </ToggleGroupItem>
        )
        // The provider is opened locally as well as at the app root: a segmented
        // control is rendered inside dialogs that mount their own trees, and a
        // missing provider throws rather than degrades.
        return option.disabled && option.disabledReason ? (
          <TooltipProvider key={option.value}>
            <Tooltip>
              <TooltipTrigger asChild>{item}</TooltipTrigger>
              <TooltipContent>{option.disabledReason}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          item
        )
      })}
    </ToggleGroup>
  )
}
