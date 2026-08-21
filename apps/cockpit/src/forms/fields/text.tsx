import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n-context'
import { FieldShell, type FieldShellProps } from './field'

export interface ValueProps<T> {
  value: T
  onChange: (value: T) => void
}

/**
 * One line of text.
 *
 * `maxLength` counts rather than truncates. The native attribute silently drops
 * the keystrokes past the limit, which reads as a broken keyboard; a counter
 * that turns red says the same thing and leaves the operator in control of what
 * to cut.
 */
export function TextField({
  value,
  onChange,
  maxLength,
  placeholder,
  transform,
  ...shell
}: FieldShellProps &
  ValueProps<string> & {
    maxLength?: number
    placeholder?: string
    /** Applied on blur, not per keystroke: a cursor that jumps mid-word is worse than a late fix. */
    transform?: (value: string) => string
}) {
  const { t } = useI18n()
  const over = maxLength !== undefined && value.length > maxLength
  return (
    <FieldShell
      {...shell}
      error={shell.error ?? (over ? t('validation.charactersOver', { count: value.length - maxLength }) : undefined)}
      hint={
        shell.hint ??
        (maxLength !== undefined ? (
          <span className={over ? 'text-destructive' : undefined}>
            {value.length}/{maxLength}
          </span>
        ) : undefined)
      }
    >
      {(control) => (
        <Input
          {...control}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onBlur={transform ? () => onChange(transform(value)) : undefined}
        />
      )}
    </FieldShell>
  )
}

const SLUG_GRAMMAR = {
  /** Content slugs address a published path segment. */
  content: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  /** Group slugs address an access group and allow the same shape. */
  group: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
} as const

export function slugify(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * A slug derived from a title until the operator touches it.
 *
 * The latch is the whole point: deriving forever means a typo in the title
 * silently changes a published URL, and never deriving means every new item is
 * typed twice. Once `edited` flips it stays flipped for the life of the form —
 * the operator has expressed an opinion and the form does not overrule it.
 */
export function SlugField({
  value,
  onChange,
  derivedFrom,
  grammar = 'content',
  siblings = [],
  ...shell
}: FieldShellProps &
  ValueProps<string> & {
    /** The title this slug follows while it is still automatic. */
    derivedFrom?: string
    grammar?: keyof typeof SLUG_GRAMMAR
    /** Slugs already taken beside this one. Excludes the value's own, if editing. */
    siblings?: readonly string[]
}) {
  const { t } = useI18n()
  const edited = useRef(false)
  const suggestion = derivedFrom ? slugify(derivedFrom) : ''

  // The suggestion is pushed into the form's own state rather than only shown.
  // A derived value that lives in the input alone is the value the operator
  // reads and the server never receives.
  useEffect(() => {
    if (edited.current || !suggestion || suggestion === value) return
    onChange(suggestion)
  }, [suggestion, value, onChange])

  const error =
    shell.error ??
    (value && !SLUG_GRAMMAR[grammar].test(value)
      ? t('validation.slug')
      : siblings.includes(value)
        ? t('validation.taken')
        : undefined)

  return (
    <FieldShell {...shell} error={error}>
      {(control) => (
        <Input
          {...control}
          value={value}
          className="font-mono"
          onChange={(event) => {
            edited.current = true
            onChange(event.target.value)
          }}
          onBlur={() => {
            const normalised = slugify(value)
            if (normalised !== value) onChange(normalised)
          }}
        />
      )}
    </FieldShell>
  )
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,63}$/

/** Mirrors the server's reader-username rule exactly, and lower-cases on blur. */
export function UsernameField({ value, onChange, ...shell }: FieldShellProps & ValueProps<string>) {
  const { t } = useI18n()
  const error =
    shell.error ??
    (value && !USERNAME.test(value)
      ? t('validation.username')
      : undefined)
  return (
    <FieldShell {...shell} error={error}>
      {(control) => (
        <Input
          {...control}
          value={value}
          autoComplete="off"
          className="font-mono"
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => onChange(value.toLowerCase())}
        />
      )}
    </FieldShell>
  )
}

const encoder = new TextEncoder()

/**
 * Multi-line text with a real byte budget.
 *
 * The server measures bytes, not characters — a 8192-byte limit is 8192 ASCII
 * characters or about 2700 emoji, and a character counter would call the second
 * one fine right up to the 422. `forbid` covers the one class of content that is
 * a structural problem rather than a size one (`</style` breaking out of the
 * emitted style element).
 */
export function TextAreaField({
  value,
  onChange,
  rows = 6,
  maxChars,
  maxBytes,
  forbid,
  forbidMessage,
  monospace,
  placeholder,
  ...shell
}: FieldShellProps &
  ValueProps<string> & {
    rows?: number
    maxChars?: number
    maxBytes?: number
    forbid?: RegExp
    forbidMessage?: string
    monospace?: boolean
    placeholder?: string
}) {
  const { t } = useI18n()
  const bytes = maxBytes === undefined ? 0 : encoder.encode(value).length
  const error =
    shell.error ??
    (maxBytes !== undefined && bytes > maxBytes
      ? t('validation.bytesOver', { count: bytes - maxBytes })
      : maxChars !== undefined && value.length > maxChars
        ? t('validation.charactersOver', { count: value.length - maxChars })
        : forbid && forbid.test(value)
          ? (forbidMessage ?? t('validation.forbiddenSequence'))
          : undefined)

  // "bytes" is a word, and it was the English one on both consoles. The
  // character budget carries no noun and needs no key.
  const budget =
    maxBytes !== undefined
      ? t('field.byteBudget', { used: bytes, limit: maxBytes })
      : maxChars !== undefined
        ? `${value.length}/${maxChars}`
        : null

  return (
    <FieldShell
      {...shell}
      error={error}
      hint={shell.hint ?? (budget ? <span className={error ? 'text-destructive' : undefined}>{budget}</span> : undefined)}
    >
      {(control) => (
        <Textarea
          {...control}
          rows={rows}
          value={value}
          placeholder={placeholder}
          spellCheck={monospace ? false : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={cn(monospace && 'font-mono text-xs')}
        />
      )}
    </FieldShell>
  )
}

/**
 * A path stored on the site, shown exactly as it will be stored.
 *
 * The normalisation is visible rather than applied at save time: an operator who
 * types `assets//logo.png` and sees `/assets/logo.png` below the box has learned
 * the rule; one who discovers it later in a diff has only learned to distrust
 * the form.
 */
export function PathField({
  value,
  onChange,
  ...shell
}: FieldShellProps & ValueProps<string> & { placeholder?: string }) {
  const { t } = useI18n()
  const [touched, setTouched] = useState(false)
  const effective = normalisePath(value)
  const error =
    shell.error ??
    (value && /\\|\?|#/.test(value)
      ? t('validation.pathCharacters')
      : value && /(^|\/)\.\.?(\/|$)/.test(value)
        ? t('validation.pathSegments')
        : undefined)

  return (
    <FieldShell
      {...shell}
      error={error}
      hint={shell.hint ?? (touched && effective !== value ? <span className="font-mono">{effective}</span> : undefined)}
    >
      {(control) => (
        <Input
          {...control}
          value={value}
          className="font-mono"
          onChange={(event) => {
            setTouched(true)
            onChange(event.target.value)
          }}
          onBlur={() => onChange(effective)}
        />
      )}
    </FieldShell>
  )
}

export function normalisePath(value: string) {
  if (!value) return ''
  return `/${value}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
}
