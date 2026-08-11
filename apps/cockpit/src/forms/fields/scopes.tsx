import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useI18n, type TranslationKey } from '@/lib/i18n-context'
import { PRODUCT_SCOPES, type ProductScope } from '../contracts/enums.generated'
import { FieldShell, type FieldShellProps } from './field'

/**
 * What each scope actually lets a credential do. The generated contract carries
 * the names; a name alone ("access:admin") is not a decision anyone can make
 * responsibly, so the sentence lives next to the box.
 */
export const SCOPE_DESCRIPTION_KEYS: Record<ProductScope, TranslationKey> = {
  'content:read': 'scope.contentRead',
  'content:write': 'scope.contentWrite',
  'deck:render': 'scope.deckRender',
  'release:preview': 'scope.releasePreview',
  'release:write': 'scope.releaseWrite',
  'site:admin': 'scope.siteAdmin',
  'access:admin': 'scope.accessAdmin',
  'webhook:admin': 'scope.webhookAdmin',
  'api-key:admin': 'scope.apiKeyAdmin',
  'identity:admin': 'scope.identityAdmin',
  'moderation:write': 'scope.moderationWrite',
  'audit:read': 'scope.auditRead',
  'stats:read': 'scope.statsRead',
}

export const SCOPE_LABEL_KEYS: Record<ProductScope, TranslationKey> = {
  'content:read': 'scope.label.contentRead',
  'content:write': 'scope.label.contentWrite',
  'deck:render': 'scope.label.deckRender',
  'release:preview': 'scope.label.releasePreview',
  'release:write': 'scope.label.releaseWrite',
  'site:admin': 'scope.label.siteAdmin',
  'access:admin': 'scope.label.accessAdmin',
  'webhook:admin': 'scope.label.webhookAdmin',
  'api-key:admin': 'scope.label.apiKeyAdmin',
  'identity:admin': 'scope.label.identityAdmin',
  'moderation:write': 'scope.label.moderationWrite',
  'audit:read': 'scope.label.auditRead',
  'stats:read': 'scope.label.statsRead',
}

/**
 * The scope set of a credential.
 *
 * Two rules are structural rather than validated. Scopes above the granting
 * operator's own ceiling are disabled — what you do not hold, you cannot hand
 * out, and the server enforces exactly this — and `*` is not offered at all: it
 * exists in stored grants but is never something a form may create.
 */
export function ScopePicker({
  value,
  onChange,
  ceiling,
  ...shell
}: FieldShellProps & {
  value: readonly string[]
  onChange: (value: string[]) => void
  /** The granting operator's own scopes. Everything outside is unavailable. */
  ceiling: readonly string[]
}) {
  const { t } = useI18n()
  const unlimited = ceiling.includes('*')
  const error = shell.error ?? (value.length === 0 ? t('validation.chooseScope') : undefined)

  return (
    <FieldShell {...shell} error={error} hint={shell.hint ?? `${value.length}/${PRODUCT_SCOPES.length}`}>
      {(control) => (
        // The shell hands down `id`, `aria-describedby` and `aria-invalid` for a
        // reason: without them the label above points at an id no element in the
        // document carries, the group has no accessible name at all, and "Choose
        // at least one scope" is text on a page that no control refers to. A
        // `<div>` is not labelable, so the name comes from `aria-label` — the
        // `id` is still taken so the label's `htmlFor` resolves to something.
        <div
          role="group"
          id={control.id}
          aria-label={shell.label}
          aria-describedby={control['aria-describedby']}
          className="grid gap-1"
          data-testid={control['data-testid']}
        >
          {PRODUCT_SCOPES.map((scope) => {
            const held = unlimited || ceiling.includes(scope)
            const scopeTestId = scope.replace(':', '-')
            const row = (
              <label
                className={cn(
                  'flex items-start gap-2 rounded-lg p-2 text-sm',
                  held ? 'hover:bg-muted/60' : 'opacity-50',
                )}
              >
                <span className="pt-0.5">
                  <Checkbox
                    data-testid={`${control['data-testid']}-${scopeTestId}`}
                    // `aria-invalid` is not allowed on `role="group"`, and the
                    // refusal is about the set rather than any one box, so every
                    // box carries it — whichever one the operator lands on says
                    // the answer is not accepted yet.
                    aria-invalid={control['aria-invalid']}
                    disabled={control.disabled || !held}
                    checked={value.includes(scope)}
                    onCheckedChange={(checked) =>
                      onChange(checked ? [...value, scope] : value.filter((entry) => entry !== scope))
                    }
                  />
                </span>
                <span>
                  <span className="block text-xs font-medium">{t(SCOPE_LABEL_KEYS[scope])}</span>
                  <span className="block font-mono text-[0.7rem] text-muted-foreground">{scope}</span>
                  <span className="block text-xs text-muted-foreground">{t(SCOPE_DESCRIPTION_KEYS[scope])}</span>
                </span>
              </label>
            )
            return held ? (
              <div key={scope}>{row}</div>
            ) : (
              // A disabled checkbox is neither a hover nor a focus target, so the
              // reason it is disabled would be unreachable through it. The wrapper
              // is the trigger, and it is a tab stop so the sentence is not
              // mouse-only. `TooltipProvider` is opened locally as well as at the
              // app root: this picker is rendered inside dialogs that mount their
              // own trees, and a missing provider throws rather than degrades.
              <TooltipProvider key={scope}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className="block"
                      data-testid={`${control['data-testid']}-${scopeTestId}-locked`}
                    >
                      {row}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t('scope.locked')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          })}
        </div>
      )}
    </FieldShell>
  )
}
