import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { FieldShell, invalidBorder, type FieldShellProps } from './field'
import type { ValueProps } from './text'

const DEFAULT_PROTOCOLS = ['https:', 'http:']

export interface UrlCheck {
  error?: string
  warning?: string
  /** What the value resolves to once the base URL is applied. */
  resolved?: string
}

/**
 * The one place URL validity is decided, so the field, the form's validator and
 * the section status cannot disagree about the same string.
 */
export function checkUrl(
  value: string,
  { protocols = DEFAULT_PROTOCOLS, base, mode }: { protocols?: string[]; base?: string; mode?: 'absolute' | 'asset' } = {},
): UrlCheck {
  if (!value) return {}
  if (mode === 'asset' && value.startsWith('/')) {
    return { resolved: base ? safeResolve(value, base) : undefined }
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { error: 'Not a URL — include the scheme, for example https://' }
  }
  if (!protocols.includes(url.protocol)) return { error: `Only ${protocols.join(', ')} are allowed here` }
  // Credentials in a stored URL end up in logs, webhooks and published pages.
  // There is no case where this is what was meant.
  if (url.username || url.password) return { error: 'Remove the username and password from the URL' }
  if (url.protocol === 'http:') return { warning: 'Plain http — the value travels unencrypted' }
  return {}
}

function safeResolve(value: string, base: string) {
  try {
    return new URL(value, base).toString()
  } catch {
    return undefined
  }
}

/**
 * A URL that commits on blur.
 *
 * Validating per keystroke calls `https:/` invalid while it is being typed,
 * which trains people to ignore the message. The value is lifted on blur, and
 * `commitRef` gives the form a way to flush a still-focused field when the save
 * button is pressed — otherwise the last edited URL is the one that never
 * makes it into the request.
 */
export function UrlField({
  value,
  onChange,
  protocols,
  base,
  mode = 'absolute',
  commitRef,
  placeholder,
  ...shell
}: FieldShellProps &
  ValueProps<string> & {
    protocols?: string[]
    /** The site's base URL, for resolving an asset path to what it will actually serve. */
    base?: string
    mode?: 'absolute' | 'asset'
    commitRef?: React.MutableRefObject<(() => void) | null>
    placeholder?: string
  }) {
  const [draft, setDraft] = useState(value)
  const latest = useRef(draft)
  latest.current = draft

  // A value that changed underneath (a reset, a fetched record) wins over a
  // draft nobody is typing into.
  useEffect(() => setDraft(value), [value])

  function commit() {
    const trimmed = latest.current.trim()
    // A bare host is almost always meant as https. Adding the scheme on blur is
    // visible and reversible; guessing it at save time is neither.
    const withScheme =
      trimmed && mode === 'absolute' && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith('/')
        ? `https://${trimmed}`
        : trimmed
    if (withScheme !== value) onChange(withScheme)
    setDraft(withScheme)
  }

  useEffect(() => {
    if (!commitRef) return
    commitRef.current = commit
    return () => {
      commitRef.current = null
    }
  })

  const check = checkUrl(draft, { protocols, base, mode })
  const error = shell.error ?? check.error

  return (
    <FieldShell
      {...shell}
      error={error}
      warning={shell.warning ?? check.warning}
      hint={shell.hint ?? (check.resolved ? <span className="font-mono">{check.resolved}</span> : undefined)}
    >
      {(control) => (
        <Input
          {...control}
          type="url"
          inputMode="url"
          autoComplete="off"
          value={draft}
          placeholder={placeholder}
          className={cn('font-mono', invalidBorder(error))}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
        />
      )}
    </FieldShell>
  )
}

/**
 * A URL with placeholders, judged by what it resolves to rather than by its
 * syntax. The example resolution is the field's real answer — a template that
 * looks right and produces `https://example.com/undefined` is the bug this
 * catches.
 */
export function UrlTemplateField({
  value,
  onChange,
  placeholders,
  sample,
  protocols,
  ...shell
}: FieldShellProps &
  ValueProps<string> & {
    /** `{slug}`-style names the server substitutes, each with what it means. */
    placeholders: readonly { token: string; description: string }[]
    /** Real values to demonstrate with, so the preview is not hypothetical. */
    sample: Record<string, string>
    protocols?: string[]
  }) {
  const resolved = value.replace(/\{([a-z_]+)\}/gi, (match, name: string) => sample[name] ?? match)
  const unknown = [...value.matchAll(/\{([a-z_]+)\}/gi)]
    .map((match) => match[1])
    .filter((name) => !placeholders.some((entry) => entry.token === name))
  const check = checkUrl(resolved, { protocols })
  const error = shell.error ?? (unknown.length ? `Unknown placeholder: ${unknown.join(', ')}` : check.error)

  return (
    <FieldShell
      {...shell}
      error={error}
      warning={shell.warning ?? check.warning}
      hint={shell.hint ?? <span className="font-mono">{resolved || '—'}</span>}
    >
      {(control) => (
        <div className="flex flex-col gap-1.5">
          <Input
            {...control}
            value={value}
            className={cn('font-mono', invalidBorder(error))}
            onChange={(event) => onChange(event.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {placeholders.map((entry) => (
              <button
                key={entry.token}
                type="button"
                title={entry.description}
                disabled={control.disabled}
                data-testid={`${control['data-testid']}-insert-${entry.token}`}
                onClick={() => onChange(`${value}{${entry.token}}`)}
                className="rounded-md border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {`{${entry.token}}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </FieldShell>
  )
}
