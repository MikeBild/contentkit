import { Input } from '@/components/ui/primitives'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { DATE_PRESETS, presetInstant } from './date-value'
import { FieldShell, invalidBorder, type FieldShellProps } from './field'
import type { ValueProps } from './text'

/**
 * A number with the unit it is measured in.
 *
 * The unit sits inside the control rather than in the label: "Retention 30" and
 * "Retention 30 days" are the same field, but only one of them can be misread as
 * hours. `allowUnset` covers the limits where absence means "no limit" — which
 * is emphatically not the same as zero, and the two must never share a
 * representation.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  integer,
  unit,
  allowUnset,
  unsetLabel = 'Unlimited',
  ...shell
}: FieldShellProps &
  ValueProps<number | undefined> & {
    min?: number
    max?: number
    step?: number
    integer?: boolean
    unit?: string
    allowUnset?: boolean
    unsetLabel?: string
  }) {
  const error =
    shell.error ??
    (value === undefined
      ? undefined
      : Number.isNaN(value)
        ? 'Not a number'
        : integer && !Number.isInteger(value)
          ? 'Whole numbers only'
          : min !== undefined && value < min
            ? `At least ${min}${unit ? ` ${unit}` : ''}`
            : max !== undefined && value > max
              ? `At most ${max}${unit ? ` ${unit}` : ''}`
              : undefined)

  return (
    <FieldShell {...shell} error={error}>
      {(control) => (
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-9 flex-1 items-center rounded-lg border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-accent',
              value === undefined && allowUnset && 'opacity-50',
              invalidBorder(error),
            )}
          >
            <Input
              {...control}
              type="number"
              inputMode={integer ? 'numeric' : 'decimal'}
              min={min}
              max={max}
              step={step ?? (integer ? 1 : undefined)}
              disabled={control.disabled || (allowUnset && value === undefined)}
              value={value ?? ''}
              className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
              onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
            />
            {unit ? <span className="shrink-0 pl-2 text-xs text-muted-foreground">{unit}</span> : null}
          </div>
          {allowUnset ? (
            <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <Switch
                data-testid={`${control['data-testid']}-unset`}
                checked={value === undefined}
                disabled={control.disabled}
                onCheckedChange={(unset) => onChange(unset ? undefined : (min ?? 0))}
              />
              {unsetLabel}
            </label>
          ) : null}
        </div>
      )}
    </FieldShell>
  )
}

const DIMENSION = /^(0|\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|ch))$/

/**
 * A CSS length. `0` is the one value that needs no unit — everything else
 * without one is a declaration the browser drops, which shows up as a layout
 * that ignored the setting rather than as an error.
 */
export function DimensionField({ value, onChange, ...shell }: FieldShellProps & ValueProps<string>) {
  const error = shell.error ?? (value && !DIMENSION.test(value) ? '0, or a number with px, rem, em, %, vh or vw' : undefined)
  return (
    <FieldShell {...shell} error={error}>
      {(control) => (
        <Input
          {...control}
          value={value}
          placeholder="0"
          className={cn('font-mono', invalidBorder(error))}
          onChange={(event) => onChange(event.target.value.trim())}
        />
      )}
    </FieldShell>
  )
}

/**
 * An ISO 8601 instant, with the presets that cover almost every real answer.
 *
 * The quick sets are `DATE_PRESETS` from `date-value.ts` — the one copy, imported
 * rather than repeated, because a second list beside this component is a list that
 * drifts. Counting forward is right here and wrong on a calendar-day field: "90
 * days" is what a credential's expiry wants, while `now + 90 days` on a
 * publication date dates a post a season ahead of everything published, which is
 * why `DateField` offers "Today" instead.
 *
 * `unsetLabel` is the label on the choice that clears the field, and it has to say
 * what empty does *here*: "Never" is the truth for an expiry, and the caller whose
 * empty means "publishes with the next release" passes its own word instead. The
 * testid does not move with the label, so one script still drives both callers.
 *
 * A date in the past is a warning and never a block: the server accepts one, and
 * an already-expired credential is a legitimate thing to create — it is how a
 * key gets revoked by the same form that made it.
 */
export function DateTimeField({
  value,
  onChange,
  unsetLabel = 'Never',
  ...shell
}: FieldShellProps & ValueProps<string | undefined> & { placeholder?: string; unsetLabel?: string }) {
  const parsed = value ? new Date(value) : null
  const invalid = Boolean(value) && Number.isNaN(parsed?.valueOf())
  const error = shell.error ?? (invalid ? 'Not a date' : undefined)

  return (
    <FieldShell
      {...shell}
      error={error}
      warning={shell.warning ?? (!invalid && parsed && parsed.valueOf() < Date.now() ? 'In the past — accepted, and effective immediately' : undefined)}
      fallback={shell.fallback ?? (value ? undefined : 'Unset means no expiry.')}
    >
      {(control) => (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            {...control}
            type="datetime-local"
            className={cn('w-auto flex-1', invalidBorder(error))}
            value={toLocalInput(parsed)}
            onChange={(event) =>
              onChange(event.target.value ? new Date(event.target.value).toISOString() : undefined)
            }
          />
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              data-testid={`${control['data-testid']}-preset-${preset.days ?? 'never'}`}
              disabled={control.disabled}
              onClick={() => onChange(presetInstant(preset.days))}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {preset.days === null ? unsetLabel : preset.label}
            </button>
          ))}
        </div>
      )}
    </FieldShell>
  )
}

// datetime-local speaks local wall time with no zone; the wire is UTC. The
// conversion is here so no caller has to remember which side it is on.
function toLocalInput(date: Date | null) {
  if (!date || Number.isNaN(date.valueOf())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16)
}
