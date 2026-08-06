import { Page } from '@/app/shell'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SCOPE_DESCRIPTIONS } from '@/forms/fields/scopes'
import { PRODUCT_SCOPES, type ProductScope } from '@/forms/contracts/enums.generated'
import { useSession } from '@/lib/session'
import { useNow } from '@/hooks/use-now'

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
  return (
    <Page title="Profile" description="Who this session belongs to, what it may do, and when it ends.">
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity</CardTitle>
        <CardDescription>What ContentKit knows about the account this session was opened with.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[9rem_1fr]">
          <dt className="text-sm text-muted-foreground">Name</dt>
          <dd className="text-sm">{session.display_name ?? '—'}</dd>
          <dt className="text-sm text-muted-foreground">Email</dt>
          <dd className="text-sm break-all">{session.email ?? '—'}</dd>
          <dt className="text-sm text-muted-foreground">Signed in via</dt>
          <dd className="text-sm">{session.provider_id ?? 'API key'}</dd>
          {/* The subject, not the email, is what an audit line and a support
              request are keyed by — and it was previously reachable nowhere. */}
          <dt className="text-sm text-muted-foreground">Subject</dt>
          <dd className="font-mono text-sm break-all">{session.subject}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}

/** `4h 12m`, `38m`, `9s`. Past due is `expired`, never a negative duration. */
function until(iso: string | null | undefined, now: number): string {
  if (!iso) return '—'
  const remaining = new Date(iso).getTime() - now
  if (Number.isNaN(remaining)) return '—'
  if (remaining <= 0) return 'expired'
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>This session</CardTitle>
        <CardDescription>Two clocks, and only one of them can be reset by working.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm text-muted-foreground">Idle timeout</dt>
          <dd className="text-sm">
            <span className="font-medium" data-testid="idle-remaining">
              {until(session.expires_at, now)}
            </span>
            <span className="ml-2 text-muted-foreground">slides forward with every request</span>
          </dd>
          <dt className="text-sm text-muted-foreground">Hard expiry</dt>
          <dd className="text-sm">
            {/* The one that cannot be extended. Naming the difference is the
                whole point: an operator who assumes activity keeps a session
                alive discovers otherwise in the middle of a save. */}
            <span className="font-medium" data-testid="absolute-remaining">
              {until(session.absolute_expires_at, now)}
            </span>
            <span className="ml-2 text-muted-foreground">not extendable — sign in again after this</span>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>What this session may do</CardTitle>
        <CardDescription>
          ContentKit stores a role, and the role is a name for a set of scopes. Both are shown, because the role is what
          gets talked about and the scopes are what actually gate a request.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Role</span>
          <Badge variant="secondary" className="font-mono uppercase" data-testid="profile-role">
            {session.role}
          </Badge>
        </div>

        <ScopeList
          title="Held"
          caption="These are what a request is checked against."
          scopes={PRODUCT_SCOPES.filter((scope) => held.has(scope))}
          variant="secondary"
          testid="scope-held"
        />

        {missing.length > 0 ? (
          <ScopeList
            title="Not held"
            caption="Pages needing one of these are hidden rather than shown and refused — hidden is not the same as absent, and this is where the difference is written down."
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
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-xs text-muted-foreground">{caption}</p>
      {scopes.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
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
              <span className="text-xs text-muted-foreground">{SCOPE_DESCRIPTIONS[scope]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
