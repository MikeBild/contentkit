import { useState } from 'react'
import { Chip } from '@/components/ui/chip'
import { Combobox, MultiCombobox, type ComboboxOption } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n-context'
import type { Choice } from './choice'
import { FieldShell, type FieldShellProps } from './field'
import type { ValueProps } from './text'

const BCP47 = /^[a-z]{2}(?:-[a-z]{2})?$/i

/**
 * A locale, offered from the ones the site already has and typed when it needs
 * a new one. Restricting it to the configured list would make adding the first
 * translation impossible from the form that needs it.
 */
export function LocaleField({
  value,
  onChange,
  locales,
  ...shell
}: FieldShellProps & ValueProps<string> & { locales: readonly string[] }) {
  const { t } = useI18n()
  const error = shell.error ?? (value && !BCP47.test(value) ? t('validation.locale') : undefined)
  return (
    <FieldShell {...shell} error={error}>
      {(control) => (
        <Combobox
          id={control.id}
          aria-describedby={control['aria-describedby']}
          aria-invalid={control['aria-invalid']}
          data-testid={control['data-testid']}
          disabled={control.disabled}
          allowCustom
          value={value}
          onChange={(next) => onChange(next.toLowerCase())}
          options={locales.map((locale) => ({ value: locale, label: locale }))}
          emptyMessage={t('locale.notConfigured')}
        />
      )}
    </FieldShell>
  )
}

/**
 * A list of free-text values entered one at a time.
 *
 * Enter and comma both commit, because half the world types tags one way and
 * half the other. Duplicates are shown rather than dropped: silently discarding
 * the third `design` looks like the field ignored the keystroke.
 */
export function TagListField({
  value,
  onChange,
  validate,
  placeholder,
  max,
  ...shell
}: FieldShellProps &
  ValueProps<readonly string[]> & {
    /** Per-entry rule; the returned message is shown against that chip. */
    validate?: (entry: string) => string | undefined
    placeholder?: string
    max?: number
  }) {
  const { t } = useI18n()
  const inputPlaceholder = placeholder ?? t('tag.add')
  const [draft, setDraft] = useState('')
  const problems = new Map(
    value.map((entry, index) => [
      index,
      value.indexOf(entry) !== index ? t('validation.duplicate') : validate?.(entry),
    ]),
  )
  const firstProblem = [...problems.values()].find(Boolean)
  const error = shell.error ?? (max !== undefined && value.length > max ? t('validation.maximum', { count: max }) : firstProblem)

  function commit(entry: string) {
    const trimmed = entry.trim()
    if (!trimmed) return
    onChange([...value, trimmed])
    setDraft('')
  }

  return (
    <FieldShell
      {...shell}
      error={error}
      hint={shell.hint ?? (max !== undefined ? `${value.length}/${max}` : undefined)}
    >
      {(control) => (
        <div
          className={cn(
            'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 focus-within:ring-2 focus-within:ring-accent',
          )}
        >
          {value.map((entry, index) => {
            const problem = problems.get(index)
            const chip = (
              <Chip
                key={`${entry}-${index}`}
                data-testid={`${control['data-testid']}-chip-${index}`}
                invalid={Boolean(problem)}
                removeLabel={t('tag.remove', { value: entry })}
                onRemove={control.disabled ? undefined : () => onChange(value.filter((_, at) => at !== index))}
              >
                {entry}
              </Chip>
            )
            // Which chip is wrong is `aria-invalid` and the destructive variant;
            // *why* it is wrong used to be a native `title` on the chip, and
            // `Chip` spreads its props onto the Badge span, so it was a native
            // tooltip with a capital letter in front of it. The wrapper is the
            // trigger, and it is a tab stop, because a chip is not one.
            return problem ? (
              <TooltipProvider key={`${entry}-${index}`}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className="max-w-full rounded focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      data-testid={`${control['data-testid']}-chip-${index}-why`}
                    >
                      {chip}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{problem}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              chip
            )
          })}
          <Input
            {...control}
            value={draft}
            placeholder={inputPlaceholder}
            className="h-7 min-w-24 flex-1 border-0 bg-transparent px-1 focus-visible:ring-0"
            onChange={(event) => {
              if (event.target.value.includes(',')) {
                for (const part of event.target.value.split(',')) commit(part)
              } else setDraft(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commit(draft)
              } else if (event.key === 'Backspace' && !draft && value.length) {
                onChange(value.slice(0, -1))
              }
            }}
            // A term left in the box is a term the operator meant to add.
            onBlur={() => commit(draft)}
          />
        </div>
      )}
    </FieldShell>
  )
}

/**
 * A subset of a closed set.
 *
 * `allEmptyMeans` exists because an empty list is a real, and usually the more
 * dangerous, choice: a webhook endpoint with no filter receives every event.
 * Rendering that as an empty box lets it look like an unfinished form, so the
 * two readings are offered as an explicit pair.
 */
export function EnumMultiSelect<T extends string>({
  value,
  onChange,
  options,
  allEmptyMeans,
  ...shell
}: FieldShellProps &
  ValueProps<readonly T[]> & {
    options: readonly Choice<T>[]
    allEmptyMeans?: { allLabel: string; someLabel: string }
  }) {
  const all = value.length === 0

  return (
    <FieldShell {...shell}>
      {(control) => (
        <div className="flex flex-col gap-2">
          {/* Two mutually exclusive readings of the same list, which is a
              ToggleGroup — the loop of `role="radio"` buttons with a hand-rolled
              `aria-checked` and a hand-rolled active border was the same control
              built by hand, roving focus and all. */}
          {allEmptyMeans ? (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={0}
              aria-labelledby={control.id}
              disabled={control.disabled}
              value={all ? 'all' : 'some'}
              onValueChange={(next) => {
                if (!next) return
                onChange(next === 'all' ? [] : value.length ? [...value] : [options[0]!.value])
              }}
            >
              <ToggleGroupItem value="all" data-testid={`${control['data-testid']}-all`}>
                {allEmptyMeans.allLabel}
              </ToggleGroupItem>
              <ToggleGroupItem value="some" data-testid={`${control['data-testid']}-some`}>
                {allEmptyMeans.someLabel}
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          {allEmptyMeans && all ? null : (
            <MultiCombobox
              id={control.id}
              aria-describedby={control['aria-describedby']}
              aria-invalid={control['aria-invalid']}
              data-testid={control['data-testid']}
              disabled={control.disabled}
              value={value as readonly string[]}
              onChange={(next) => onChange(next as T[])}
              options={toOptions(options)}
            />
          )}
        </div>
      )}
    </FieldShell>
  )
}

/**
 * A subset of a set loaded at runtime.
 *
 * The pre-check against the loaded set is the point: `POST /access-rules` answers
 * 422 "one or more access groups do not exist" for an id that was deleted in
 * another tab, and a form that only discovers this on submit throws away
 * everything else the operator typed. Loading and failure states are surfaced
 * because "no options" and "options did not load" are not the same situation.
 */
export function EntityMultiSelect({
  value,
  onChange,
  options,
  isLoading,
  /** The query's failure, distinct from `error`, which is this field's own verdict. */
  optionsError,
  emptyMessage,
  onCreate,
  createLabel,
  ...shell
}: FieldShellProps &
  ValueProps<readonly string[]> & {
    options: readonly ComboboxOption[]
    isLoading?: boolean
    optionsError?: unknown
    emptyMessage?: string
    onCreate?: (term: string) => void
    createLabel?: (term: string) => string
  }) {
  const { t } = useI18n()
  const stale =
    isLoading || optionsError ? [] : value.filter((entry) => !options.some((option) => option.value === entry))
  const fieldError =
    shell.error ?? (stale.length ? t('validation.staleEntity', { value: stale.join(', ') }) : undefined)

  return (
    <FieldShell {...shell} error={fieldError}>
      {(control) => (
        <MultiCombobox
          id={control.id}
          aria-describedby={control['aria-describedby']}
          aria-invalid={control['aria-invalid']}
          data-testid={control['data-testid']}
          disabled={control.disabled}
          value={value}
          onChange={onChange}
          options={options}
          isLoading={isLoading}
          error={optionsError}
          emptyMessage={emptyMessage}
          onCreate={onCreate}
          createLabel={createLabel}
        />
      )}
    </FieldShell>
  )
}

function toOptions<T extends string>(options: readonly Choice<T>[]): ComboboxOption[] {
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    hint: option.description,
    disabled: option.disabled,
    disabledReason: option.disabledReason,
  }))
}
