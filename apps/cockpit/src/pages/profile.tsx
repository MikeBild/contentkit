import { Page } from '@/app/shell'
import { ContextHelp } from '@/components/context-help'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SCOPE_DESCRIPTION_KEYS } from '@/forms/fields/scopes'
import { PRODUCT_SCOPES, type ProductScope } from '@/forms/contracts/enums.generated'
import { useSession } from '@/lib/session'
import { useNow } from '@/hooks/use-now'
import { useI18n } from '@/lib/i18n-context'

/**
 * Who you are signed in as, what that lets you do, and how long it lasts.
 *
 * The console had none of this. The footer printed a name and a role and that
 * was the whole account surface — no way to see the subject an audit line is
 * keyed by, no way to see which scopes the session actually holds, and no sight
 * of either session clock.
 *
 * The clocks are the reason this page exists. `/v1/identity/session` has
 * returned `expires_at` and `absolute_expires_at` all along and nothing rendered
 * them, so a tab left open overnight could not say when it stops working — it
 * found out mid-save.
 *
 * The sibling console has the same page in the same shape. It is a separate
 * implementation over a different authorization model — ContentKit has real
 * roles and stores them, watchkit has scopes and derives a label — and the
 * layout is shared because an operator moving between the two should not have
 * to relearn where their own account lives.
 */
export function ProfilePage() {
  const { t } = useI18n()
  return (
    <Page title={t('profile.title')} description={t('profile.description')}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Identity />
        <SessionClocks />
        <div className="lg:col-span-2">
          <Authority />
        </div>
      </div>
    </Page>
  )
}

function Identity() {
  const session = useSession()
  const { t } = useI18n()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.identity.title')}</CardTitle>
        <CardDescription>{t('profile.identity.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[9rem_1fr]">
          <dt className="text-sm text-muted-foreground">{t('profile.name')}</dt>
          <dd className="text-sm">{session.display_name ?? '—'}</dd>
          <dt className="text-sm text-muted-foreground">{t('profile.email')}</dt>
          <dd className="text-sm break-all">{session.email ?? '—'}</dd>
          <dt className="text-sm text-muted-foreground">{t('profile.provider')}</dt>
          <dd className="text-sm">{session.provider_id ?? t('profile.apiKey')}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}

/** `4h 12m`, `38m`, `9s`. Past due is `expired`, never a negative duration. */
function until(iso: string | null | undefined, now: number, expired: string): string {
  if (!iso) return '—'
  const remaining = new Date(iso).getTime() - now
  if (Number.isNaN(remaining)) return '—'
  if (remaining <= 0) return expired
  const seconds = Math.floor(remaining / 1000)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

function SessionClocks() {
  const session = useSession()
  const now = useNow()
  const { t } = useI18n()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profile.session.title')}</CardTitle>
        <CardDescription>{t('profile.session.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm text-muted-foreground">{t('profile.session.idle')}</dt>
          <dd className="text-sm">
            <span className="font-medium" data-testid="idle-remaining">
              {until(session.expires_at, now, t('profile.session.expired'))}
            </span>
            <span className="ml-2 text-muted-foreground">{t('profile.session.idleHint')}</span>
          </dd>
          <dt className="text-sm text-muted-foreground">{t('profile.session.absolute')}</dt>
          <dd className="text-sm">
            {/* The one that cannot be extended. Naming the difference is the
                whole point: an operator who assumes activity keeps a session
                alive discovers otherwise in the middle of a save. */}
            <span className="font-medium" data-testid="absolute-remaining">
              {until(session.absolute_expires_at, now, t('profile.session.expired'))}
            </span>
            <span className="ml-2 text-muted-foreground">{t('profile.session.absoluteHint')}</span>
          </dd>
        </dl>
      </CardContent>
    </Card>
  )
}

function Authority() {
  const session = useSession()
  const held = new Set<string>(session.product_scopes ?? [])
  // Everything the installation defines, split into what this session holds and
  // what it does not. Showing only the held half answers "what can I do" and
  // leaves "why is that page missing" unanswered — which is the question an
  // operator actually arrives with.
  const missing = PRODUCT_SCOPES.filter((scope) => !held.has(scope))
  const { t } = useI18n()

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1">
          <CardTitle>{t('profile.permissions.title')}</CardTitle>
          <ContextHelp label={t('profile.permissions.description')} testId="profile-permissions-help">
            {t('profile.permissions.description')}
          </ContextHelp>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('profile.role')}</span>
          <Badge variant="secondary" className="font-mono uppercase" data-testid="profile-role">
            {session.role}
          </Badge>
        </div>

        <ScopeList
          title={t('profile.held')}
          caption={t('profile.held.description')}
          scopes={PRODUCT_SCOPES.filter((scope) => held.has(scope))}
          variant="secondary"
          testid="scope-held"
        />

        {missing.length > 0 ? (
          <ScopeList
            title={t('profile.missing')}
            caption={t('profile.missing.description')}
            scopes={missing}
            variant="outline"
            testid="scope-missing"
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function ScopeList({
  title,
  caption,
  scopes,
  variant,
  testid,
}: {
  title: string
  caption: string
  scopes: readonly ProductScope[]
  variant: 'secondary' | 'outline'
  testid: string
}) {
  const { t } = useI18n()
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-xs text-muted-foreground">{caption}</p>
      {scopes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('common.none')}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {scopes.map((scope) => (
            <li
              key={scope}
              className="flex items-start gap-2 rounded-md border border-border p-2.5"
              data-testid={testid}
            >
              <Badge variant={variant} className="font-mono">
                {scope}
              </Badge>
              <span className="text-xs text-muted-foreground">{t(SCOPE_DESCRIPTION_KEYS[scope])}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
