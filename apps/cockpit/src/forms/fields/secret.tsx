import { Eye, EyeOff } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { CopyButton } from '@/components/ui/copy-button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n-context'
import { FieldShell, type FieldShellProps } from './field'
import type { ValueProps } from './text'

/**
 * A value that must not be shoulder-surfed or autofilled.
 *
 * `autoComplete="new-password"` is the part that matters and the part that is
 * always forgotten: without it the browser offers the operator's own saved
 * password for the site's webhook secret, and one Tab later that is what got
 * stored.
 *
 * The strength meter measures length only. Anything cleverer would be a claim
 * about entropy the console cannot make about a value it did not generate.
 */
export function SecretField({
  value,
  onChange,
  minLength = 16,
  generate,
  ...shell
}: FieldShellProps &
  ValueProps<string> & {
    minLength?: number
    /** Produces a strong value. The result is shown once through `RevealOnce`. */
    generate?: () => string
}) {
  const { t } = useI18n()
  const [revealed, setRevealed] = useState(false)
  const error = shell.error ?? (value && value.length < minLength ? t('validation.minimumCharacters', { count: minLength }) : undefined)
  const strength = Math.min(1, value.length / (minLength * 2))

  return (
    <FieldShell {...shell} error={error} hint={shell.hint ?? (value ? t('secret.characters', { count: value.length }) : undefined)}>
      {(control) => (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Input
              {...control}
              type={revealed ? 'text' : 'password'}
              autoComplete="new-password"
              spellCheck={false}
              value={value}
              className="font-mono"
              onChange={(event) => onChange(event.target.value)}
            />
            <IconButton
              type="button"
              variant="outline"
              size="icon-sm"
              label={t(revealed ? 'secret.hide' : 'secret.reveal')}
              data-testid={`${control['data-testid']}-reveal`}
              disabled={control.disabled}
              onClick={() => setRevealed((state) => !state)}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </IconButton>
            {generate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={`${control['data-testid']}-generate`}
                disabled={control.disabled}
                onClick={() => onChange(generate())}
              >
                {t('secret.generate')}
              </Button>
            ) : null}
          </div>
          {value ? (
            <div aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full transition-all', strength < 0.5 ? 'bg-warning' : 'bg-success')}
                style={{ width: `${Math.round(strength * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      )}
    </FieldShell>
  )
}

/**
 * A value the server will never return again.
 *
 * Generalised from the API-key panel, which had this logic inline. Dismissal is
 * irreversible and says so before it happens, because the alternative — a quiet
 * "Close" — has already cost people a key they had not copied yet.
 */
export function RevealOnce({
  value,
  title,
  description,
  onDismiss,
  className,
  'data-testid': testId,
}: {
  value: string
  title: string
  description?: ReactNode
  onDismiss: () => void
  className?: string
  'data-testid': string
}) {
  const { t } = useI18n()
  const [acknowledged, setAcknowledged] = useState(false)

  return (
    <div
      data-testid={testId}
      className={cn('rounded-xl border border-warning/30 bg-warning/10 p-4', className)}
      // The one-time value is important enough to be announced, not merely shown.
      role="alert"
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      <code
        data-testid={`${testId}-value`}
        className="mt-3 block break-all rounded-lg border border-border bg-background p-3 font-mono text-xs"
      >
        {value}
      </code>
      <div className="mt-3 flex items-center gap-2">
        <CopyButton value={value} data-testid={`${testId}-copy`} label={t('common.copy')} />
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            data-testid={`${testId}-acknowledge`}
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          {t('secret.stored')}
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid={`${testId}-dismiss`}
          disabled={!acknowledged}
          onClick={onDismiss}
        >
          {t('secret.dismiss')}
        </Button>
      </div>
    </div>
  )
}
