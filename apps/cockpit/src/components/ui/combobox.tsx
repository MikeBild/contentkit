import { Check, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { visibleLabel } from '@/lib/opaque'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n-context'
import { Chip } from './chip'

export interface ComboboxOption {
  value: string
  label: string
  /** One line saying what choosing this means. Shown next to the label, never instead of it. */
  hint?: string
  disabled?: boolean
  /**
   * Why it is disabled, shown in the hint's place on the row it belongs to.
   *
   * It used to be a native `title`, which put the one sentence explaining a dead
   * option behind a hover — unreachable on a touch screen, and unreachable by a
   * keyboard because the option it hung on is `disabled` and therefore not a
   * focus target either. A reason nobody can read is not a reason, so it is on
   * screen beside the option instead.
   */
  disabledReason?: string
}

interface Shared {
  options: readonly ComboboxOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  'data-testid'?: string
  /** Live option sets have three failure modes and the list must show all three. */
  isLoading?: boolean
  error?: unknown
  emptyMessage?: string
  /** Offers "create <term>" once the typed term matches nothing. */
  onCreate?: (term: string) => void
  createLabel?: (term: string) => string
}

function useDismiss(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, close])
  return root
}

function match(options: readonly ComboboxOption[], term: string) {
  const needle = term.trim().toLowerCase()
  if (!needle) return options
  return options.filter(
    (option) => option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
  )
}

/** The list body, shared by both comboboxes so their three states cannot diverge. */
function Listbox({
  visible,
  active,
  selected,
  onPick,
  isLoading,
  error,
  emptyMessage,
  term,
  onCreate,
  createLabel,
  testId,
}: {
  visible: readonly ComboboxOption[]
  active: number
  selected: (value: string) => boolean
  onPick: (option: ComboboxOption) => void
  term: string
  testId: string
} & Pick<Shared, 'isLoading' | 'error' | 'emptyMessage' | 'onCreate' | 'createLabel'>) {
  const { t } = useI18n()
  if (isLoading) return <div className="px-3 py-2 text-xs text-muted-foreground">{t('common.loading')}</div>
  if (error)
    return (
      <div className="px-3 py-2 text-xs text-destructive">
        {error instanceof Error ? error.message : t('combobox.optionsFailed')}
      </div>
    )
  if (visible.length === 0)
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        {term && onCreate ? (
          <button
            type="button"
            data-testid={`${testId}-create`}
            className="flex w-full items-center gap-2 text-left text-foreground"
            onClick={() => onCreate(term.trim())}
          >
            <Plus className="h-3 w-3" />
            {(createLabel ?? ((value: string) => t('combobox.create', { value })))(term.trim())}
          </button>
        ) : (
          (emptyMessage ?? t('combobox.noMatches'))
        )}
      </div>
    )
  return (
    <>
      {visible.map((option, index) => {
        // The aside is one slot with two occupants, and a dead option's reason
        // outranks its hint: "what choosing this means" is not the sentence to
        // read on a row that cannot be chosen. `forms/fields/choice.tsx` makes
        // the same swap for the same reason.
        const aside = (option.disabled ? option.disabledReason : undefined) ?? option.hint
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={selected(option.value)}
            disabled={option.disabled}
            data-testid={`${testId}-option-${option.value}`}
            onClick={() => onPick(option)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50',
              index === active ? 'bg-muted' : 'hover:bg-muted/60',
            )}
          >
            <Check className={cn('h-3.5 w-3.5 shrink-0', selected(option.value) ? 'opacity-100' : 'opacity-0')} />
            <span className="truncate">{option.label}</span>
            {aside ? <span className="ml-auto truncate text-xs text-muted-foreground">{aside}</span> : null}
          </button>
        )
      })}
    </>
  )
}

const SHELL =
  'flex min-h-9 w-full items-center gap-1 rounded-lg border border-border bg-background px-2 text-sm focus-within:ring-2 focus-within:ring-accent aria-[invalid=true]:border-destructive'

/**
 * A searchable single-value picker.
 *
 * `<select>` covers a closed set of a dozen; past that, and for any set the
 * console loads at runtime, the operator needs to type. The value stays a
 * string — free text is only reachable through `allowCustom`, and then it is
 * the caller's job to validate it.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  allowCustom,
  disabled,
  className,
  isLoading,
  error,
  emptyMessage,
  onCreate,
  createLabel,
  'data-testid': testId = 'ck-combobox',
  ...aria
}: Shared & { value: string; onChange: (value: string) => void; allowCustom?: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)
  const root = useDismiss(open, () => setOpen(false))
  const visible = useMemo(() => match(options, term), [options, term])
  const label = options.find((option) => option.value === value)?.label ?? value

  function commit(next: string) {
    onChange(next)
    setTerm('')
    setOpen(false)
  }

  return (
    <div ref={root} className={cn('relative', className)} data-testid={testId}>
      <div className={SHELL} aria-invalid={aria['aria-invalid']}>
        <input
          id={aria.id}
          aria-describedby={aria['aria-describedby']}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          disabled={disabled}
          data-testid={`${testId}-input`}
          className="h-8 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          placeholder={value ? label : (placeholder ?? t('combobox.select'))}
          value={open ? term : value ? label : ''}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setTerm(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setOpen(true)
              setActive((at) => (at + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % (visible.length || 1))
            } else if (event.key === 'Enter') {
              const picked = visible[active]
              if (picked && !picked.disabled) {
                event.preventDefault()
                commit(picked.value)
              } else if (allowCustom && term.trim()) {
                event.preventDefault()
                commit(term.trim())
              }
            } else if (event.key === 'Escape') {
              setOpen(false)
              setTerm('')
            }
          }}
          onBlur={() => {
            // Free text has to survive losing focus, or a typed locale is gone
            // the moment the operator reaches for the save button.
            if (allowCustom && term.trim()) commit(term.trim())
          }}
        />
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      {open ? (
        <div
          role="listbox"
          className="scrollbar-thin absolute z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          <Listbox
            visible={visible}
            active={active}
            selected={(candidate) => candidate === value}
            onPick={(option) => commit(option.value)}
            term={term}
            isLoading={isLoading}
            error={error}
            emptyMessage={emptyMessage}
            onCreate={onCreate}
            createLabel={createLabel}
            testId={testId}
          />
        </div>
      ) : null}
    </div>
  )
}

/** The same picker over a set of values, shown as removable chips. */
export function MultiCombobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  isLoading,
  error,
  emptyMessage,
  onCreate,
  createLabel,
  'data-testid': testId = 'ck-multicombobox',
  ...aria
}: Shared & { value: readonly string[]; onChange: (value: string[]) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)
  const root = useDismiss(open, () => setOpen(false))
  const visible = useMemo(() => match(options, term), [options, term])

  function toggle(candidate: string) {
    onChange(value.includes(candidate) ? value.filter((entry) => entry !== candidate) : [...value, candidate])
    setTerm('')
    setActive(0)
  }

  return (
    <div ref={root} className={cn('relative', className)} data-testid={testId}>
      <div className={cn(SHELL, 'flex-wrap py-1')} aria-invalid={aria['aria-invalid']}>
        {value.map((entry, index) => {
          /*
           * A selected value whose option is gone used to fall back to the value
           * itself — and in this console those values are UUIDs, so a path rule
           * pointing at a deleted reader group printed two raw identifiers into
           * the dialog and a third into the error line beneath it (§5, found by
           * the detail sweep of LOCAL-CK-DETAILROUTEN).
           *
           * `visibleLabel` is the console's existing answer to "is this string
           * something a person may read": it returns the value unless the value
           * is an opaque identifier. So a human-readable value still shows
           * itself, and an id degrades to the honest words instead — which is
           * also what the chip needs to say, because the operator's next move is
           * to remove it.
           */
          const named = options.find((option) => option.value === entry)?.label ?? visibleLabel(entry)
          const label = named ?? t('common.missingEntry')
          return (
            <Chip
              key={entry}
              data-testid={`${testId}-chip-${index}`}
              data-missing={named ? undefined : 'true'}
              removeLabel={t('tag.remove', { value: label })}
              onRemove={disabled ? undefined : () => toggle(entry)}
            >
              {label}
            </Chip>
          )
        })}
        <input
          id={aria.id}
          aria-describedby={aria['aria-describedby']}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          disabled={disabled}
          data-testid={`${testId}-input`}
          className="h-7 min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          placeholder={placeholder ?? t('combobox.add')}
          value={term}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setTerm(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setOpen(true)
              setActive((at) => (at + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % (visible.length || 1))
            } else if (event.key === 'Enter') {
              const picked = visible[active]
              if (picked && !picked.disabled) {
                event.preventDefault()
                toggle(picked.value)
              }
            } else if (event.key === 'Backspace' && !term && value.length) {
              onChange(value.slice(0, -1))
            } else if (event.key === 'Escape') {
              setOpen(false)
              setTerm('')
            }
          }}
        />
      </div>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable
          className="scrollbar-thin absolute z-40 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          <Listbox
            visible={visible}
            active={active}
            selected={(candidate) => value.includes(candidate)}
            onPick={(option) => toggle(option.value)}
            term={term}
            isLoading={isLoading}
            error={error}
            emptyMessage={emptyMessage}
            onCreate={onCreate}
            createLabel={createLabel}
            testId={testId}
          />
        </div>
      ) : null}
    </div>
  )
}
