import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge, Button, Input, Select } from '@/components/ui/primitives'
import { Switch } from '@/components/ui/switch'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { FieldShell, invalidBorder, type FieldShellProps } from './field'
import type { ValueProps } from './text'

const KEY_GRAMMAR = /^[a-z][a-z0-9_]{0,63}$/

/**
 * A string map as rows.
 *
 * The key is fixed once the row exists: renaming a key in place is a delete plus
 * an add that looks like an edit, and for anything keyed by identity that is a
 * silent data loss. Removing and re-adding says the same thing honestly.
 */
export function KeyValueField({
  value,
  onChange,
  keyLabel = 'Key',
  valueLabel = 'Value',
  ...shell
}: FieldShellProps &
  ValueProps<Record<string, string>> & {
    keyLabel?: string
    valueLabel?: string
  }) {
  const [draftKey, setDraftKey] = useState('')
  const entries = Object.entries(value)
  const keyError = draftKey && !KEY_GRAMMAR.test(draftKey) ? 'Lower-case letters, digits and underscores' : undefined

  return (
    <FieldShell {...shell} error={shell.error ?? keyError}>
      {(control) => (
        <div className="flex flex-col gap-2" data-testid={control['data-testid']}>
          {entries.map(([key, entry]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-40 shrink-0 truncate font-mono text-xs text-muted-foreground" title={key}>
                {key}
              </span>
              <Input
                aria-label={`${valueLabel} for ${key}`}
                data-testid={`${control['data-testid']}-value-${key}`}
                disabled={control.disabled}
                value={entry}
                onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${key}`}
                data-testid={`${control['data-testid']}-remove-${key}`}
                disabled={control.disabled}
                onClick={() => {
                  const { [key]: _removed, ...rest } = value
                  onChange(rest)
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-chart-5" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              aria-label={keyLabel}
              placeholder={keyLabel}
              data-testid={`${control['data-testid']}-new-key`}
              disabled={control.disabled}
              value={draftKey}
              className={cn('w-40 shrink-0 font-mono text-xs', invalidBorder(keyError))}
              onChange={(event) => setDraftKey(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={`${control['data-testid']}-add`}
              disabled={control.disabled || !draftKey || Boolean(keyError) || draftKey in value}
              onClick={() => {
                onChange({ ...value, [draftKey]: '' })
                setDraftKey('')
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </div>
      )}
    </FieldShell>
  )
}

export interface TokenDefinition {
  key: string
  label: string
  /** Shown when the value is unset — the token's stock value. */
  fallback?: string
  /** Set for a token the console knows about but the server will not accept. */
  unavailableReason?: string
}

/**
 * A map with a closed key set.
 *
 * "Add token" is a menu of the unset allowed keys and never a text box, because
 * an unknown key does not fail quietly — it fails the entire settings PATCH with
 * a 422, taking every other edit on the page with it. A key that cannot be typed
 * cannot be mistyped.
 */
export function TokenMapField({
  value,
  onChange,
  tokens,
  renderValue,
  ...shell
}: FieldShellProps & {
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  tokens: readonly TokenDefinition[]
  /** Each token's own editor — a colour, a length, a font stack. */
  renderValue: (token: TokenDefinition, entry: unknown, set: (next: unknown) => void) => ReactNode
}) {
  const [picked, setPicked] = useState('')
  const set = new Set(Object.keys(value))
  const available = tokens.filter((token) => !set.has(token.key))

  return (
    <FieldShell {...shell} hint={shell.hint ?? `${set.size}/${tokens.length} set`}>
      {(control) => (
        <div className="flex flex-col gap-3" data-testid={control['data-testid']}>
          {tokens
            .filter((token) => set.has(token.key))
            .map((token) => (
              <div key={token.key} className="flex flex-col gap-1" data-testid={`${control['data-testid']}-${token.key}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{token.key}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`${control['data-testid']}-reset-${token.key}`}
                    disabled={control.disabled}
                    onClick={() => {
                      const { [token.key]: _removed, ...rest } = value
                      onChange(rest)
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset to default
                  </Button>
                </div>
                {renderValue(token, value[token.key], (next) => onChange({ ...value, [token.key]: next }))}
              </div>
            ))}

          <div className="flex items-center gap-2">
            <Select
              aria-label="Token to add"
              data-testid={`${control['data-testid']}-picker`}
              disabled={control.disabled || available.length === 0}
              value={picked}
              className="flex-1"
              onChange={(event) => setPicked(event.target.value)}
            >
              <option value="">{available.length ? 'Add a token…' : 'Every token is set'}</option>
              {available.map((token) => (
                <option key={token.key} value={token.key} disabled={Boolean(token.unavailableReason)}>
                  {token.label}
                  {token.unavailableReason ? ' — not available' : ''}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={`${control['data-testid']}-add`}
              disabled={control.disabled || !picked}
              onClick={() => {
                onChange({ ...value, [picked]: '' })
                setPicked('')
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          {tokens.some((token) => token.unavailableReason) ? (
            <div className="flex flex-wrap gap-1">
              {tokens
                .filter((token) => token.unavailableReason)
                .map((token) => (
                  <Tooltip key={token.key} content={token.unavailableReason}>
                    <Badge className="opacity-60">{token.key}</Badge>
                  </Tooltip>
                ))}
            </div>
          ) : null}
        </div>
      )}
    </FieldShell>
  )
}

type ExtraShape = 'text' | 'number' | 'boolean' | 'list' | 'map'

const SHAPES: { value: ExtraShape; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes/no' },
  { value: 'list', label: 'List of text' },
  { value: 'map', label: 'Map of text' },
]

function shapeOf(entry: unknown): ExtraShape {
  if (typeof entry === 'number') return 'number'
  if (typeof entry === 'boolean') return 'boolean'
  if (Array.isArray(entry)) return 'list'
  if (entry && typeof entry === 'object') return 'map'
  return 'text'
}

function emptyOf(shape: ExtraShape): unknown {
  return shape === 'number' ? 0 : shape === 'boolean' ? false : shape === 'list' ? [] : shape === 'map' ? {} : ''
}

const encoder = new TextEncoder()

/**
 * Free-form frontmatter extras, without a JSON box.
 *
 * The offered shapes stop at one level: text, number, boolean, a list of text, a
 * map of text. `null` and deeper containers are not offered at all — they are
 * representable in the store, but a form that can produce them is a form that
 * needs a JSON editor, and that is the thing this whole layer exists to remove.
 * Anything deeper that already exists is carried through untouched by
 * `CarriedKeys`.
 */
export function ExtraFieldsField({
  value,
  onChange,
  maxBytes,
  ...shell
}: FieldShellProps & {
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  maxBytes?: number
}) {
  const [draftKey, setDraftKey] = useState('')
  const [draftShape, setDraftShape] = useState<ExtraShape>('text')
  const bytes = encoder.encode(JSON.stringify(value)).length
  const keyError = draftKey && !KEY_GRAMMAR.test(draftKey) ? 'Lower-case letters, digits and underscores' : undefined
  const error =
    shell.error ?? keyError ?? (maxBytes !== undefined && bytes > maxBytes ? `${bytes - maxBytes} bytes over` : undefined)

  const editable = Object.entries(value).filter(([, entry]) => isEditable(entry))

  return (
    <FieldShell
      {...shell}
      error={error}
      hint={shell.hint ?? (maxBytes !== undefined ? `${bytes}/${maxBytes} bytes` : `${bytes} bytes`)}
    >
      {(control) => (
        <div className="flex flex-col gap-2" data-testid={control['data-testid']}>
          {editable.map(([key, entry]) => (
            <div key={key} className="flex items-start gap-2" data-testid={`${control['data-testid']}-${key}`}>
              <span className="w-40 shrink-0 truncate pt-2 font-mono text-xs text-muted-foreground" title={key}>
                {key}
              </span>
              <div className="flex-1">
                <ExtraValue
                  testId={`${control['data-testid']}-${key}`}
                  disabled={control.disabled}
                  entry={entry}
                  onChange={(next) => onChange({ ...value, [key]: next })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${key}`}
                data-testid={`${control['data-testid']}-remove-${key}`}
                disabled={control.disabled}
                onClick={() => {
                  const { [key]: _removed, ...rest } = value
                  onChange(rest)
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-chart-5" />
              </Button>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Input
              aria-label="New field name"
              placeholder="field_name"
              data-testid={`${control['data-testid']}-new-key`}
              disabled={control.disabled}
              value={draftKey}
              className={cn('w-40 shrink-0 font-mono text-xs', invalidBorder(keyError))}
              onChange={(event) => setDraftKey(event.target.value)}
            />
            <Select
              aria-label="New field shape"
              data-testid={`${control['data-testid']}-new-shape`}
              disabled={control.disabled}
              value={draftShape}
              onChange={(event) => setDraftShape(event.target.value as ExtraShape)}
            >
              {SHAPES.map((shape) => (
                <option key={shape.value} value={shape.value}>
                  {shape.label}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={`${control['data-testid']}-add`}
              disabled={control.disabled || !draftKey || Boolean(keyError) || draftKey in value}
              onClick={() => {
                onChange({ ...value, [draftKey]: emptyOf(draftShape) })
                setDraftKey('')
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </div>
      )}
    </FieldShell>
  )
}

function isEditable(entry: unknown): boolean {
  const shape = shapeOf(entry)
  if (shape === 'list') return (entry as unknown[]).every((item) => typeof item === 'string')
  if (shape === 'map') return Object.values(entry as object).every((item) => typeof item === 'string')
  return entry !== null
}

function ExtraValue({
  entry,
  onChange,
  disabled,
  testId,
}: {
  entry: unknown
  onChange: (value: unknown) => void
  disabled?: boolean
  testId: string
}) {
  const shape = shapeOf(entry)
  if (shape === 'boolean')
    return (
      <Switch
        data-testid={`${testId}-value`}
        disabled={disabled}
        checked={entry as boolean}
        onCheckedChange={onChange}
      />
    )
  if (shape === 'number')
    return (
      <Input
        type="number"
        data-testid={`${testId}-value`}
        disabled={disabled}
        value={entry as number}
        onChange={(event) => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
      />
    )
  if (shape === 'list')
    return (
      <Input
        data-testid={`${testId}-value`}
        disabled={disabled}
        placeholder="one, two, three"
        value={(entry as string[]).join(', ')}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean),
          )
        }
      />
    )
  if (shape === 'map')
    return (
      <KeyValueField
        label="Entries"
        data-testid={`${testId}-value`}
        disabled={disabled}
        value={entry as Record<string, string>}
        onChange={onChange}
      />
    )
  return (
    <Input
      data-testid={`${testId}-value`}
      disabled={disabled}
      value={entry as string}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/**
 * Keys the form does not own, shown and removable but not editable.
 *
 * Settings pass unknown keys through untouched, so something a future version —
 * or a script — wrote must survive a save from this console. It must also be
 * removable, or "delete has to work everywhere" would quietly mean "except
 * here". Read-only plus delete is the whole compromise: nothing to edit means no
 * JSON box comes back.
 */
export function CarriedKeys({
  value,
  onRemove,
  className,
  'data-testid': testId,
}: {
  value: Record<string, unknown>
  onRemove: (key: string) => void
  className?: string
  'data-testid': string
}) {
  const entries = Object.entries(value)
  if (entries.length === 0) return null

  return (
    <div data-testid={testId} className={cn('rounded-lg border border-border p-3', className)}>
      <p className="text-xs text-muted-foreground">
        Kept as they are — written by something other than this form, and preserved on save.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {entries.map(([key, entry]) => (
          <li key={key} className="flex items-center gap-2 text-xs">
            <span className="font-mono text-muted-foreground">{key}</span>
            <span className="min-w-0 flex-1 truncate font-mono">{describe(entry)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${key}`}
              data-testid={`${testId}-remove-${key}`}
              onClick={() => onRemove(key)}
            >
              <Trash2 className="h-3.5 w-3.5 text-chart-5" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// A shape summary, not a serialisation: the point is to recognise the key, not
// to read the value back out of a wall of braces.
function describe(entry: unknown): string {
  if (entry === null) return 'empty'
  if (Array.isArray(entry)) return `${entry.length} item${entry.length === 1 ? '' : 's'}`
  if (typeof entry === 'object') return `${Object.keys(entry).length} key(s)`
  return String(entry)
}
