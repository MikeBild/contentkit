import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PRODUCT_SCOPES, type ProductScope } from '../contracts/enums.generated'
import { FieldShell, type FieldShellProps } from './field'

/**
 * What each scope actually lets a credential do. The generated contract carries
 * the names; a name alone ("access:admin") is not a decision anyone can make
 * responsibly, so the sentence lives next to the box.
 */
export const SCOPE_DESCRIPTIONS: Record<ProductScope, string> = {
  'content:read': 'Read drafts, revisions and published documents.',
  'content:write': 'Create and change content, including deleting revisions.',
  'deck:render': 'Render slide decks.',
  'release:preview': 'Build previews that are never activated.',
  'release:write': 'Build and activate releases — this is what changes the live site.',
  'site:admin': 'Change site settings, domains and locales, and delete the site.',
  'access:admin': 'Manage readers, groups and access rules.',
  'webhook:admin': 'Manage webhook endpoints and read their deliveries.',
  'api-key:admin': 'Create and revoke API keys.',
  'identity:admin': 'Grant and revoke operator access.',
  'moderation:write': 'Approve, reject and delete comments, contact submissions and feedback.',
  'audit:read': 'Read the audit trail.',
  'stats:read': 'Read usage and product statistics.',
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
  const unlimited = ceiling.includes('*')
  const error = shell.error ?? (value.length === 0 ? 'Choose at least one scope' : undefined)

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
            const row = (
              <label
                className={cn(
                  'flex items-start gap-2 rounded-lg p-2 text-sm',
                  held ? 'hover:bg-muted/60' : 'opacity-50',
                )}
              >
                <span className="pt-0.5">
                  <Checkbox
                    data-testid={`${control['data-testid']}-${scope}`}
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
                  <span className="font-mono text-xs">{scope}</span>
                  <span className="block text-xs text-muted-foreground">{SCOPE_DESCRIPTIONS[scope]}</span>
                </span>
              </label>
            )
            return held ? (
              <div key={scope}>{row}</div>
            ) : (
              <Tooltip key={scope} content="You do not hold this scope yourself" className="block">
                {row}
              </Tooltip>
            )
          })}
        </div>
      )}
    </FieldShell>
  )
}
