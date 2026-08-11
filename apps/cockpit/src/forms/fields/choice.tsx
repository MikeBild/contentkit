import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/lib/i18n-context'
import { FieldShell, type ControlProps, type FieldShellProps } from './field'
import type { ValueProps } from './text'

/** Every closed-set field takes its options in this shape. */
export interface Choice<T extends string> {
  value: T
  label: string
  /** One sentence naming the consequence of choosing this. */
  description?: string
  disabled?: boolean
  disabledReason?: string
}

export function choices<T extends string>(values: readonly T[], label?: (value: T) => string): Choice<T>[] {
  return values.map((value) => ({ value, label: label ? label(value) : value }))
}

/**
 * Radix's Select has no value for "nothing chosen" — an empty string is how it
 * spells *deselected*, and an item may not carry one. So absence travels under
 * its own name inside the component and is translated back at both edges; no
 * caller ever sees it, and no enum this console has could collide with it.
 */
const UNSET = '__ck_unset__'

/**
 * A closed set, straight from `contracts/enums.generated.ts`.
 *
 * `options` is typed against the member union rather than `string`, so a page
 * that offers a value the server would reject does not compile.
 */
export function EnumSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  allowEmpty,
  ...shell
}: FieldShellProps &
  ValueProps<T | ''> & {
    options: readonly Choice<T>[]
    /** The label for "not set", when absence is a legal value. */
    placeholder?: string
    allowEmpty?: boolean
  }) {
  const empty = placeholder ?? '—'
  return (
    <FieldShell {...shell}>
      {(control) => (
        <Select
          value={value === '' ? UNSET : value}
          disabled={control.disabled}
          onValueChange={(next) => onChange(next === UNSET ? '' : (next as T))}
        >
          <SelectTrigger
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            data-testid={control['data-testid']}
            className="w-full"
          >
            <SelectValue placeholder={empty} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {allowEmpty || !value ? (
                <SelectItem value={UNSET} data-testid={`${control['data-testid']}-unset`}>
                  {empty}
                </SelectItem>
              ) : null}
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  data-testid={`${control['data-testid']}-${option.value}`}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    </FieldShell>
  )
}

/**
 * The one shape every visible closed set renders as.
 *
 * It used to be three: a `Segmented` radiogroup, a loop of `<button role="radio"
 * aria-checked>` cards, and the tri-state switch — each hand-rolling the pressed
 * state, the roving focus and the disabled reason, and each getting a different
 * subset of them right. `ToggleGroup` owns all three, so what is left here is
 * the mapping from a `Choice` to an item.
 *
 * Two deliberate departures from the obvious:
 *
 *  - an unavailable option is `aria-disabled`, not `disabled`. A disabled button
 *    takes neither hover nor focus, so the sentence saying *why* it is
 *    unavailable would be the one sentence nobody can reach. It stays operable
 *    to the keyboard and inert to the group instead.
 *  - the option's own sentence — its consequence, or the reason it is closed —
 *    is a tooltip on the item rather than a line beneath it. Six options with a
 *    line each is six lines of prose to choose between two of them.
 */
function OptionToggle<T extends string>({
  control,
  label,
  value,
  onChange,
  options,
  orientation = 'horizontal',
}: {
  control: ControlProps
  label: string
  value: T
  onChange: (value: T) => void
  options: readonly Choice<T>[]
  orientation?: 'horizontal' | 'vertical'
}) {
  return (
    <TooltipProvider>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        orientation={orientation}
        id={control.id}
        aria-label={label}
        aria-describedby={control['aria-describedby']}
        disabled={control.disabled}
        value={value}
        onValueChange={(next) => {
          if (!next) return
          if (options.find((option) => option.value === next)?.disabled) return
          onChange(next as T)
        }}
        data-testid={control['data-testid']}
        className={orientation === 'vertical' ? 'w-full' : undefined}
      >
        {options.map((option) => {
          const aside = option.disabled ? option.disabledReason : option.description
          return aside ? (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <ToggleGroupItem
                  value={option.value}
                  aria-disabled={option.disabled || undefined}
                  // `aria-invalid` is not allowed on `role="group"`, and the
                  // refusal is about the choice rather than any one option, so
                  // every item carries it — whichever one the operator lands on
                  // says the answer is not accepted yet.
                  aria-invalid={control['aria-invalid']}
                  data-testid={`${control['data-testid']}-${option.value}`}
                  className={orientation === 'vertical' ? 'justify-start' : undefined}
                >
                  {option.label}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{aside}</TooltipContent>
            </Tooltip>
          ) : (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              aria-disabled={option.disabled || undefined}
              aria-invalid={control['aria-invalid']}
              data-testid={`${control['data-testid']}-${option.value}`}
              className={orientation === 'vertical' ? 'justify-start' : undefined}
            >
              {option.label}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
    </TooltipProvider>
  )
}

/** Two or three options that deserve to stay visible. */
export function SegmentedField<T extends string>({
  value,
  onChange,
  options,
  ...shell
}: FieldShellProps & ValueProps<T> & { options: readonly Choice<T>[] }) {
  return (
    <FieldShell {...shell}>
      {(control) => (
        <OptionToggle control={control} label={shell.label} value={value} onChange={onChange} options={options} />
      )}
    </FieldShell>
  )
}

/**
 * A choice whose options differ in consequence rather than in degree — role
 * versus explicit scopes, opt-in versus opt-out. Each option states its
 * consequence in one sentence, because the difference between them is exactly
 * the thing a dropdown hides; the sentence is one hover or one focus away
 * rather than stacked under every option at once.
 */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  ...shell
}: FieldShellProps & ValueProps<T> & { options: readonly Choice<T>[] }) {
  return (
    <FieldShell {...shell}>
      {(control) => (
        <OptionToggle
          control={control}
          label={shell.label}
          value={value}
          onChange={onChange}
          options={options}
          orientation="vertical"
        />
      )}
    </FieldShell>
  )
}

/**
 * A real boolean, where absence is indistinguishable from false. Use `TriToggle`
 * when the server treats an absent key differently from an explicit `false`.
 */
export function SwitchField({
  value,
  onChange,
  onLabel,
  offLabel,
  ...shell
}: FieldShellProps & ValueProps<boolean> & { onLabel?: ReactNode; offLabel?: ReactNode }) {
  const { t } = useI18n()
  return (
    <FieldShell {...shell}>
      {(control) => (
        <div className="flex items-center gap-2">
          <Switch
            id={control.id}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            data-testid={control['data-testid']}
            disabled={control.disabled}
            checked={value}
            onCheckedChange={onChange}
          />
          <span className="text-sm text-muted-foreground">
            {value ? (onLabel ?? t('common.on')) : (offLabel ?? t('common.off'))}
          </span>
        </div>
      )}
    </FieldShell>
  )
}

/**
 * `true | false | undefined`, and the third one is not a nicety.
 *
 * Settings are merged, not replaced, key by key: an absent key inherits the
 * server's default and follows it if that default ever changes, while an
 * explicit `false` pins the value forever. A two-state switch cannot express
 * "leave this alone", so it silently pins every default it renders.
 */
export function TriToggle({
  value,
  onChange,
  defaultLabel,
  ...shell
}: FieldShellProps & ValueProps<boolean | undefined> & { defaultLabel?: string }) {
  const { t } = useI18n()
  const state = value === undefined ? 'default' : value ? 'on' : 'off'
  const options: readonly Choice<'default' | 'on' | 'off'>[] = [
    { value: 'default', label: t('common.default') },
    { value: 'on', label: t('common.on') },
    { value: 'off', label: t('common.off') },
  ]
  return (
    <FieldShell
      {...shell}
      fallback={shell.fallback ?? (defaultLabel ? t('choice.unsetFallback', { value: defaultLabel }) : undefined)}
    >
      {(control) => (
        <OptionToggle
          control={control}
          label={shell.label}
          value={state}
          options={options}
          onChange={(next) => onChange(next === 'default' ? undefined : next === 'on')}
        />
      )}
    </FieldShell>
  )
}
