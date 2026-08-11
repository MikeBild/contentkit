import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/forms/status-badge'
import { cn } from '@/lib/utils'
import { useI18n, type I18nValue, type TranslationKey } from '@/lib/i18n-context'
import { FieldShell, type FieldShellProps } from './field'
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
  keyLabel,
  valueLabel,
  ...shell
}: FieldShellProps &
  ValueProps<Record<string, string>> & {
    keyLabel?: string
    valueLabel?: string
  }) {
  const { t } = useI18n()
  const shownKeyLabel = keyLabel ?? t('map.key')
  const shownValueLabel = valueLabel ?? t('map.value')
  const [draftKey, setDraftKey] = useState('')
  const entries = Object.entries(value)
  const keyError = draftKey && !KEY_GRAMMAR.test(draftKey) ? t('map.keyValidation') : undefined

  return (
    <FieldShell {...shell} error={shell.error ?? keyError}>
      {(control) => (
        <div className="flex flex-col gap-2" data-testid={control['data-testid']}>
          {entries.map(([key, entry]) => (
            <div key={key} className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  {/* The row's key is truncated to keep the value box wide, so the
                      full key has to be reachable somewhere. A native `title` is
                      neither keyboard- nor touch-reachable; this trigger is a tab
                      stop and says the same thing. */}
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      data-testid={`${control['data-testid']}-key-${key}`}
                      className="w-40 shrink-0 truncate font-mono text-xs text-muted-foreground"
                    >
                      {key}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{key}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Input
                aria-label={t('map.valueFor', { label: shownValueLabel, key })}
                data-testid={`${control['data-testid']}-value-${key}`}
                disabled={control.disabled}
                value={entry}
                onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              />
              <IconButton
                type="button"
                variant="destructive"
                size="icon-sm"
                label={t('map.remove', { key })}
                data-testid={`${control['data-testid']}-remove-${key}`}
                disabled={control.disabled}
                onClick={() => {
                  const { [key]: _removed, ...rest } = value
                  onChange(rest)
                }}
              >
                <Trash2 />
              </IconButton>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              aria-label={shownKeyLabel}
              placeholder={shownKeyLabel}
              data-testid={`${control['data-testid']}-new-key`}
              disabled={control.disabled}
              value={draftKey}
              className="w-40 shrink-0 font-mono text-xs"
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
              <Plus data-icon="inline-start" />
              {t('common.add')}
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
  const { t } = useI18n()
  const [picked, setPicked] = useState('')
  const set = new Set(Object.keys(value))
  const available = tokens.filter((token) => !set.has(token.key))

  return (
    <FieldShell {...shell} hint={shell.hint ?? t('map.tokensSet', { count: set.size, total: tokens.length })}>
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
                    <RotateCcw data-icon="inline-start" />
                    {t('map.resetDefault')}
                  </Button>
                </div>
                {renderValue(token, value[token.key], (next) => onChange({ ...value, [token.key]: next }))}
              </div>
            ))}

          <div className="flex items-center gap-2">
            {/* Radix spells "nothing picked" as the empty string on the root and
                refuses it as an item's value, so the placeholder is the trigger's
                own — which is also where the "every token is set" case belongs. */}
            <Select
              disabled={control.disabled || available.length === 0}
              value={picked}
              onValueChange={setPicked}
            >
              <SelectTrigger
                aria-label={t('map.tokenToAdd')}
                data-testid={`${control['data-testid']}-picker`}
                className="flex-1"
              >
                <SelectValue placeholder={t(available.length ? 'map.addToken' : 'map.allTokensSet')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {available.map((token) => (
                    <SelectItem
                      key={token.key}
                      value={token.key}
                      disabled={Boolean(token.unavailableReason)}
                      data-testid={`${control['data-testid']}-picker-${token.key}`}
                    >
                      {token.label}
                      {token.unavailableReason ? ` — ${t('map.unavailable')}` : ''}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
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
              <Plus data-icon="inline-start" />
              {t('common.add')}
            </Button>
          </div>

          {tokens.some((token) => token.unavailableReason) ? (
            <div className="flex flex-wrap gap-1">
              {tokens
                .filter((token) => token.unavailableReason)
                .map((token) => (
                  <TooltipProvider key={token.key}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} data-testid={`${control['data-testid']}-unavailable-${token.key}`}>
                          <StatusBadge className="opacity-60">{token.key}</StatusBadge>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{token.unavailableReason}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
            </div>
          ) : null}
        </div>
      )}
    </FieldShell>
  )
}

type ExtraShape = 'text' | 'number' | 'boolean' | 'list' | 'map'

const SHAPE_KEYS: Record<ExtraShape, TranslationKey> = {
  text: 'map.shape.text',
  number: 'map.shape.number',
  boolean: 'map.shape.boolean',
  list: 'map.shape.list',
  map: 'map.shape.map',
}

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
  const { t } = useI18n()
  const [draftKey, setDraftKey] = useState('')
  const [draftShape, setDraftShape] = useState<ExtraShape>('text')
  const bytes = encoder.encode(JSON.stringify(value)).length
  const keyError = draftKey && !KEY_GRAMMAR.test(draftKey) ? t('map.keyValidation') : undefined
  const error =
    shell.error ?? keyError ?? (maxBytes !== undefined && bytes > maxBytes ? t('map.bytesOver', { count: bytes - maxBytes }) : undefined)

  const editable = Object.entries(value).filter(([, entry]) => isEditable(entry))

  return (
    <FieldShell
      {...shell}
      error={error}
      hint={shell.hint ?? (maxBytes !== undefined ? `${bytes}/${maxBytes}` : t('map.bytes', { count: bytes }))}
    >
      {(control) => (
        <div className="flex flex-col gap-2" data-testid={control['data-testid']}>
          {editable.map(([key, entry]) => (
            <div key={key} className="flex items-start gap-2" data-testid={`${control['data-testid']}-${key}`}>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      data-testid={`${control['data-testid']}-key-${key}`}
                      className="w-40 shrink-0 truncate pt-2 font-mono text-xs text-muted-foreground"
                    >
                      {key}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{key}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <div className="flex-1">
                <ExtraValue
                  testId={`${control['data-testid']}-${key}`}
                  disabled={control.disabled}
                  entry={entry}
                  onChange={(next) => onChange({ ...value, [key]: next })}
                />
              </div>
              <IconButton
                type="button"
                variant="destructive"
                size="icon-sm"
                label={t('map.remove', { key })}
                data-testid={`${control['data-testid']}-remove-${key}`}
                disabled={control.disabled}
                onClick={() => {
                  const { [key]: _removed, ...rest } = value
                  onChange(rest)
                }}
              >
                <Trash2 />
              </IconButton>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Input
              aria-label={t('map.newFieldName')}
              placeholder="field_name"
              data-testid={`${control['data-testid']}-new-key`}
              disabled={control.disabled}
              value={draftKey}
              className="w-40 shrink-0 font-mono text-xs"
              onChange={(event) => setDraftKey(event.target.value)}
            />
            <Select
              disabled={control.disabled}
              value={draftShape}
              onValueChange={(next) => setDraftShape(next as ExtraShape)}
            >
              <SelectTrigger aria-label={t('map.newFieldShape')} data-testid={`${control['data-testid']}-new-shape`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(SHAPE_KEYS).map(([value, key]) => (
                    <SelectItem
                      key={value}
                      value={value}
                      data-testid={`${control['data-testid']}-new-shape-${value}`}
                    >
                      {t(key)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
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
              <Plus data-icon="inline-start" />
              {t('common.add')}
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
  const { t } = useI18n()
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
        placeholder={t('map.listExample')}
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
        label={t('map.entries')}
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
  const { t } = useI18n()
  const entries = Object.entries(value)
  if (entries.length === 0) return null

  return (
    <div data-testid={testId} className={cn('rounded-lg border border-border p-3', className)}>
      <p className="text-xs text-muted-foreground">
        {t('map.carried')}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {entries.map(([key, entry]) => (
          <li key={key} className="flex items-center gap-2 text-xs">
            <span className="font-mono text-muted-foreground">{key}</span>
            <span className="min-w-0 flex-1 truncate font-mono">{describe(entry, t)}</span>
            <IconButton
              type="button"
              variant="destructive"
              size="icon-sm"
              label={t('map.remove', { key })}
              data-testid={`${testId}-remove-${key}`}
              onClick={() => onRemove(key)}
            >
              <Trash2 />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  )
}

// A shape summary, not a serialisation: the point is to recognise the key, not
// to read the value back out of a wall of braces.
function describe(entry: unknown, t: I18nValue['t']): string {
  if (entry === null) return t('map.empty')
  if (Array.isArray(entry)) return t(entry.length === 1 ? 'map.item' : 'map.items', { count: entry.length })
  if (typeof entry === 'object') return t('map.keys', { count: Object.keys(entry).length })
  return String(entry)
}
