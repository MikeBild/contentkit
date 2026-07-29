import { Check, ChevronDown, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Chip } from './chip'

export interface ComboboxOption {
  value: string
  label: string
  /** One line saying what choosing this means. Shown next to the label, never instead of it. */
  hint?: string
  disabled?: boolean
  /** Why it is disabled. The only place a tooltip carries weight here. */
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
  if (isLoading) return <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
  if (error)
    return (
      <div className="px-3 py-2 text-xs text-chart-5">
        {error instanceof Error ? error.message : 'Options could not be loaded'}
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
            {(createLabel ?? ((value: string) => `Create “${value}”`))(term.trim())}
          </button>
        ) : (
          (emptyMessage ?? 'No matches')
        )}
      </div>
    )
  return (
    <>
      {visible.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="option"
          aria-selected={selected(option.value)}
          disabled={option.disabled}
          title={option.disabled ? option.disabledReason : undefined}
          data-testid={`${testId}-option-${option.value}`}
          onClick={() => onPick(option)}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50',
            index === active ? 'bg-muted' : 'hover:bg-muted/60',
          )}
        >
          <Check className={cn('h-3.5 w-3.5 shrink-0', selected(option.value) ? 'opacity-100' : 'opacity-0')} />
          <span className="truncate">{option.label}</span>
          {option.hint ? <span className="ml-auto truncate text-xs text-muted-foreground">{option.hint}</span> : null}
        </button>
      ))}
    </>
  )
}

const SHELL =
  'flex min-h-9 w-full items-center gap-1 rounded-lg border border-border bg-background px-2 text-sm focus-within:ring-2 focus-within:ring-accent aria-[invalid=true]:border-chart-5'

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
  placeholder = 'Select…',
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
          placeholder={value ? label : placeholder}
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
  placeholder = 'Add…',
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
        {value.map((entry) => (
          <Chip
            key={entry}
            data-testid={`${testId}-chip-${entry}`}
            removeLabel={`Remove ${entry}`}
            onRemove={disabled ? undefined : () => toggle(entry)}
          >
            {options.find((option) => option.value === entry)?.label ?? entry}
          </Chip>
        ))}
        <input
          id={aria.id}
          aria-describedby={aria['aria-describedby']}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          disabled={disabled}
          data-testid={`${testId}-input`}
          className="h-7 min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          placeholder={placeholder}
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
