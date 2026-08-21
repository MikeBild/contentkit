import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useI18n, type I18nValue } from '@/lib/i18n-context'
import { FieldShell, type FieldShellProps } from './field'
import type { ValueProps } from './text'

/** A token value is one string for both schemes, or one per scheme. */
export type SchemeValue = string | { light: string; dark: string }

const encoder = new TextEncoder()
const MAX_BYTES = 256

/**
 * Mirrors the server's token-value rule exactly.
 *
 * `themeStyles()` inlines the value verbatim into a `<style>` element with no
 * entity decoding, so `<` is the one character that could terminate it — and it
 * is rejected on write. Repeating that here means the operator learns it from
 * the field instead of from a 422 that rejected the whole settings PATCH.
 */
/** The one refusal `checkTokenValue` gives that is not about length. */
const TOKEN_CHARACTER = '“<” is not allowed in a token value'

export function checkTokenValue(value: string): string | undefined {
  if (!value) return undefined
  if (value.includes('<')) return TOKEN_CHARACTER
  if (encoder.encode(value).length > MAX_BYTES) return `Longer than ${MAX_BYTES} bytes`
  return undefined
}

/**
 * `checkTokenValue`'s answer, in the reader's language.
 *
 * One place rather than two: the swatch field mapped it to the catalogue and the
 * font field printed it raw, so the same wrong value was English in one box and
 * German in the next. Matching on the English sentence is the join that
 * `LOCAL-CK-KETTE-UEBER-STRINGGLEICHHEIT` describes — it is here, once, where
 * the sentence is defined a dozen lines above, rather than once per field.
 */
function localizeTokenMessage(raw: string | undefined, t: I18nValue['t']): string | undefined {
  if (!raw) return undefined
  return raw === TOKEN_CHARACTER ? t('color.tokenCharacter') : t('color.tokenLength', { count: MAX_BYTES })
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * A colour as swatch, text and native picker at once.
 *
 * The text box is the value — `oklch()`, `color-mix()` and `var(--x)` are all
 * legal CSS and the picker cannot express any of them. The picker only writes
 * hex, and only when it is used; it never rewrites what was typed.
 */
export function ColorField({ value, onChange, ...shell }: FieldShellProps & ValueProps<string>) {
  const { t } = useI18n()
  const error = shell.error ?? localizeTokenMessage(checkTokenValue(value), t)
  const pickable = HEX.test(value) ? value : '#000000'

  return (
    <FieldShell {...shell} error={error}>
      {(control) => (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-9 shrink-0 rounded-lg border border-border"
            style={{ background: value || 'transparent' }}
          />
          <Input
            {...control}
            value={value}
            placeholder="#0f172a"
            className="font-mono"
            onChange={(event) => onChange(event.target.value)}
          />
          <input
            type="color"
            aria-label={t('color.picker', { label: shell.label })}
            data-testid={`${control['data-testid']}-picker`}
            disabled={control.disabled}
            value={pickable}
            onChange={(event) => onChange(event.target.value)}
            className="size-9 shrink-0 cursor-pointer rounded-lg border border-border bg-background"
          />
        </div>
      )}
    </FieldShell>
  )
}

/**
 * One colour, or one per scheme.
 *
 * Most tokens are the same in light and dark and a form that always asks twice
 * makes that the operator's problem. The switch is the whole difference between
 * the wire's `"#fff"` and its `{ light, dark }` — flipping it off collapses to
 * the light value, which is the choice the operator can see.
 */
export function SchemeColorField({
  value,
  onChange,
  ...shell
}: FieldShellProps & ValueProps<SchemeValue>) {
  const { t } = useI18n()
  const split = typeof value !== 'string'
  const light = split ? value.light : value
  const dark = split ? value.dark : value
  const rawError = checkTokenValue(light) ?? checkTokenValue(dark)
  const error =
    shell.error ??
    (rawError === '“<” is not allowed in a token value'
      ? t('color.tokenCharacter')
      : rawError
        ? t('color.tokenLength', { count: MAX_BYTES })
        : undefined)

  return (
    <FieldShell {...shell} error={error}>
      {(control) => (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              data-testid={`${control['data-testid']}-split`}
              disabled={control.disabled}
              checked={!split}
              onCheckedChange={(same) => onChange(same ? light : { light, dark: dark || light })}
            />
            {t('color.sameSchemes')}
          </label>
          <div className={cn('grid gap-2', split && 'sm:grid-cols-2')}>
            <ColorField
              data-testid={`${control['data-testid']}-light`}
              label={split ? `${shell.label} — ${t('color.light')}` : shell.label}
              disabled={control.disabled}
              value={light}
              onChange={(next) => onChange(split ? { light: next, dark } : next)}
            />
            {split ? (
              <ColorField
                data-testid={`${control['data-testid']}-dark`}
                label={`${shell.label} — ${t('color.dark')}`}
                disabled={control.disabled}
                value={dark}
                onChange={(next) => onChange({ light, dark: next })}
              />
            ) : null}
          </div>
        </div>
      )}
    </FieldShell>
  )
}

const FONT_FAMILY = /^[\p{L}\p{N}\s,'"_-]+$/u

/**
 * A font stack, shown in itself. A specimen is the only honest preview: the
 * string `Georgia, serif` tells you nothing about whether the font resolves on
 * this machine, and the specimen tells you immediately.
 */
export function FontFamilyField({ value, onChange, ...shell }: FieldShellProps & ValueProps<string>) {
  const { t } = useI18n()
  const error =
    shell.error ??
    localizeTokenMessage(checkTokenValue(value), t) ??
    (value && !FONT_FAMILY.test(value) ? t('color.fontCharacters') : undefined)

  return (
    <FieldShell {...shell} error={error}>
      {(control) => (
        <div className="flex flex-col gap-2">
          <Input
            {...control}
            value={value}
            placeholder="Inter, system-ui, sans-serif"
            className="font-mono"
            onChange={(event) => onChange(event.target.value)}
          />
          <p
            data-testid={`${control['data-testid']}-specimen`}
            className="rounded-lg border border-border bg-background px-3 py-2 text-base"
            style={error ? undefined : { fontFamily: value || undefined }}
          >
            {t('color.specimen')}
          </p>
        </div>
      )}
    </FieldShell>
  )
}
