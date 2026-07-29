import type { ReactNode } from 'react'
import { Select } from '@/components/ui/primitives'
import { Segmented } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { FieldShell, invalidBorder, type FieldShellProps } from './field'
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
  return (
    <FieldShell {...shell}>
      {(control) => (
        <Select
          {...control}
          value={value}
          className={cn('w-full', invalidBorder(shell.error))}
          onChange={(event) => onChange(event.target.value as T | '')}
        >
          {allowEmpty || !value ? <option value="">{placeholder ?? '—'}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </FieldShell>
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
        <Segmented
          data-testid={control['data-testid']}
          aria-labelledby={control.id}
          disabled={control.disabled}
          value={value}
          onChange={onChange}
          options={options.map(({ value: option, label, disabled, disabledReason }) => ({
            value: option,
            label,
            disabled,
            disabledReason,
          }))}
        />
      )}
    </FieldShell>
  )
}

/**
 * A choice whose options differ in consequence rather than in degree — role
 * versus explicit scopes, opt-in versus opt-out. Each card states its
 * consequence in one sentence, because the difference between them is exactly
 * the thing a dropdown hides.
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
        <div role="radiogroup" aria-labelledby={control.id} data-testid={control['data-testid']} className="grid gap-2">
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={control.disabled || option.disabled}
                title={option.disabled ? option.disabledReason : undefined}
                data-testid={`${control['data-testid']}-${option.value}`}
                onClick={() => onChange(option.value)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
                  active ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted/60',
                )}
              >
                <div className="text-sm font-medium">{option.label}</div>
                {option.description ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">{option.description}</div>
                ) : null}
              </button>
            )
          })}
        </div>
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
  return (
    <FieldShell {...shell}>
      {(control) => (
        <div className="flex items-center gap-2">
          <Switch
            id={control.id}
            aria-describedby={control['aria-describedby']}
            data-testid={control['data-testid']}
            disabled={control.disabled}
            checked={value}
            onCheckedChange={onChange}
          />
          <span className="text-sm text-muted-foreground">{value ? (onLabel ?? 'On') : (offLabel ?? 'Off')}</span>
        </div>
      )}
    </FieldShell>
  )
}

const TRI = [
  { value: 'default', label: 'Default' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
] as const

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
  const state = value === undefined ? 'default' : value ? 'on' : 'off'
  return (
    <FieldShell
      {...shell}
      fallback={shell.fallback ?? (defaultLabel ? `Unset, the server uses ${defaultLabel}.` : undefined)}
    >
      {(control) => (
        <Segmented
          data-testid={control['data-testid']}
          aria-labelledby={control.id}
          disabled={control.disabled}
          value={state}
          options={TRI}
          onChange={(next) => onChange(next === 'default' ? undefined : next === 'on')}
        />
      )}
    </FieldShell>
  )
}
