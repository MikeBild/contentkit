import { useQuery } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { ck, type AccessRule } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Badge, Button, Select, TBody, TD, TH, THead, TR, Table, TableState } from '@/components/ui/primitives'
import { GroupsCard } from '@/forms/audience/groups'
import { CommentsCard, ContactCard, FeedbackCard } from '@/forms/audience/moderation'
import { ReadersCard } from '@/forms/audience/readers'
import { RebuildBanner, useRebuildRequired } from '@/forms/audience/rebuild-banner'
import { RulesCard } from '@/forms/audience/rules'
import { ApiKeysCard } from '@/forms/platform/api-keys'
import { IdentityGrantsCard } from '@/forms/platform/identity'
import { WebhookDeliveriesCard, WebhookEndpointsCard } from '@/forms/platform/webhooks'
import { keys } from '@/lib/query'
import { useSite } from '@/lib/site'
import { formatDate } from '@/lib/utils'

// ── Reader access ────────────────────────────────────────────────────────────

export function AccessPage() {
  const { site } = useSite()
  const rebuild = useRebuildRequired(site)
  // Lifted out of the rules card so the groups card can open the very rule that
  // is blocking a deletion, instead of only naming it.
  const [editingRule, setEditingRule] = useState<{ rule?: AccessRule } | null>(null)

  if (!site)
    return (
      <Page title="Reader access">
        <NoSite />
      </Page>
    )

  return (
    <Page
      title="Reader access"
      description="Who may read the published site. Rules are snapshotted into each release, so changes take effect on the next build."
    >
      {rebuild.required ? <RebuildBanner site={site} onBuilt={rebuild.clear} /> : null}

      <div className="space-y-4">
        <ReadersCard site={site} />
        <RulesCard
          site={site}
          editing={editingRule}
          onEditingChange={setEditingRule}
          onRebuildRequired={rebuild.mark}
        />
        <GroupsCard site={site} onEditRule={(rule) => setEditingRule({ rule })} />
      </div>
    </Page>
  )
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export function WebhooksPage() {
  const { site, siteId } = useSite()

  if (!site)
    return (
      <Page title="Webhooks">
        <NoSite />
      </Page>
    )

  return (
    <Page title="Webhooks" description="Outbound content events, their endpoints and delivery history.">
      <div className="space-y-4">
        <WebhookEndpointsCard site={site} />
        <WebhookDeliveriesCard site={site} siteId={siteId} />
      </div>
    </Page>
  )
}

// ── Moderation ───────────────────────────────────────────────────────────────

export function ModerationPage() {
  const { site, siteId } = useSite()

  if (!siteId)
    return (
      <Page title="Moderation">
        <NoSite />
      </Page>
    )

  return (
    <Page title="Moderation" description="Visitor comments, contact submissions and anonymous post feedback.">
      <div className="space-y-4">
        <CommentsCard site={site} siteId={siteId} />
        <ContactCard siteId={siteId} />
        <FeedbackCard site={site} siteId={siteId} />
      </div>
    </Page>
  )
}

// ── Credentials ──────────────────────────────────────────────────────────────

export function CredentialsPage() {
  return (
    <Page title="Credentials" description="API keys and the OAuth identity grants that bound what a token may ever do.">
      <div className="space-y-4">
        <ApiKeysCard />
        <IdentityGrantsCard />
      </div>
    </Page>
  )
}

// ── Audit ────────────────────────────────────────────────────────────────────

/**
 * The actions worth filtering by, as a fixed list.
 *
 * Deriving the options from the loaded page was circular: the filter could only
 * offer what the last fifty rows happened to contain, so the one action an
 * operator is hunting for — the rare revoke, the failed build — was exactly the
 * one missing from the menu.
 */
const AUDIT_ACTIONS = [
  'api_key.create',
  'api_key.revoke',
  'identity.create',
  'identity.update',
  'identity.restore',
  'identity.revoke',
  'site.create',
  'site.delete',
  'release.create',
  'release.activate',
  'release.delete',
  'content.publish',
  'content.unpublish',
  'content.delete',
] as const

const LIMITS = [50, 100, 200]

/**
 * The installation's audit trail, with its own site filter.
 *
 * `useState(site)` is deliberate and is what shell.tsx declares (`selection:
 * 'seeds'`): the trail is one append-only log for the whole installation, so the
 * filter is seeded from the selection and then belongs to the operator. Moving
 * the switcher afterwards does not re-narrow the list — following it would
 * silently discard a filter someone had just set, on a page whose whole purpose
 * is comparing one actor across sites.
 *
 * The seed is the FIRST render's selection, and on a cold load of /audit that is
 * no site at all: `useSite()` reads `?site=` and only picks a default once
 * GET /v1/sites has answered (lib/site.tsx), which is an effect later. So this
 * page opens on every site unless the URL already named one, and the sentence in
 * `description` says that rather than promising the switcher's site — re-seeding
 * from the effect would move a control under the hand of an operator already
 * reading the page, after the unfiltered request had gone out anyway.
 *
 * What was wrong was not the seeding but that nothing said so: the page named
 * the site nowhere and offered no way back to the selected one. Both are below —
 * `diverged` is true for the cold-load case too, so the way back is offered
 * exactly when the filter and the switcher disagree — and the switcher's own
 * caption is dimmed for the same reason.
 */
export function AuditPage() {
  const { site, sites } = useSite()
  const [action, setAction] = useState('')
  const [scope, setScope] = useState(site)
  const [limit, setLimit] = useState(50)
  const [expanded, setExpanded] = useState<string | null>(null)

  // All three go to the server. Filtering a page the server already truncated
  // to fifty rows answers a different question than the one being asked.
  const query = { ...(scope ? { site: scope } : {}), ...(action ? { action } : {}), limit }
  const events = useQuery({ queryKey: keys.audit(query), queryFn: () => ck.audit(query) })
  const rows = events.data ?? []
  const selected = sites.find((entry) => entry.slug === site)
  const diverged = Boolean(site) && scope !== site

  return (
    <Page
      title="Audit"
      description="Append-only, redacted record of every privileged action, across the whole installation. The site filter is seeded from the switcher as this page opens — on a cold load nothing is selected yet, so it starts on every site — and then stays where you put it: moving the switcher does not change this list."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          data-testid="ck-audit-site-filter"
          aria-label="Filter the audit trail by site"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="">Every site</option>
          {sites.map((entry) => (
            <option key={entry.id} value={entry.slug}>
              {entry.name}
            </option>
          ))}
        </Select>
        <Select
          data-testid="ck-audit-action-filter"
          aria-label="Filter the audit trail by action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          data-testid="ck-audit-limit-filter"
          aria-label="Number of audit events to load"
          value={String(limit)}
          onChange={(event) => setLimit(Number(event.target.value))}
        >
          {LIMITS.map((value) => (
            <option key={value} value={value}>
              Last {value}
            </option>
          ))}
        </Select>
        {diverged ? (
          // The one thing the seeded copy owes the operator: a way back to the
          // selected site, said out loud rather than implied by a switcher that
          // does nothing here.
          <Button
            variant="ghost"
            size="sm"
            data-testid="ck-audit-follow-site"
            onClick={() => setScope(site)}
          >
            {scope ? `Showing ${scope}` : 'Showing every site'} — switch to {selected?.name ?? site}
          </Button>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Actor</TH>
              <TH>Action</TH>
              <TH>Resource</TH>
              <TH>Result</TH>
              <TH>Transport</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            <TableState
              columns={7}
              isLoading={events.isPending}
              error={events.error}
              isEmpty={rows.length === 0}
              onRetry={() => events.refetch()}
              emptyMessage={action || scope ? 'No events match these filters.' : 'Nothing recorded yet.'}
            >
              {rows.map((event) => {
                const open = expanded === event.id
                return (
                  <Fragment key={event.id}>
                    <TR data-testid="ck-audit-row" data-event={event.id}>
                      <TD className="whitespace-nowrap text-muted-foreground">{formatDate(event.created_at)}</TD>
                      <TD className="text-muted-foreground">{event.actor_type}</TD>
                      <TD className="font-mono text-xs">{event.action}</TD>
                      <TD className="text-muted-foreground">{event.resource_type ?? '—'}</TD>
                      <TD>
                        <Badge tone={event.result === 'success' ? 'success' : 'danger'}>{event.result}</Badge>
                      </TD>
                      <TD className="text-muted-foreground">{event.transport ?? '—'}</TD>
                      <TD>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={open}
                          data-testid={`ck-audit-expand-${event.id}`}
                          onClick={() => setExpanded(open ? null : event.id)}
                        >
                          {open ? 'Hide' : 'Details'}
                        </Button>
                      </TD>
                    </TR>
                    {open ? (
                      <TR data-testid={`ck-audit-detail-${event.id}`}>
                        <TD colSpan={7} className="bg-muted/40">
                          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                            <dt className="text-muted-foreground">Actor id</dt>
                            <dd className="font-mono">{event.actor_id ?? '—'}</dd>
                            <dt className="text-muted-foreground">Resource id</dt>
                            <dd className="font-mono">{event.resource_id ?? '—'}</dd>
                            <dt className="text-muted-foreground">Site</dt>
                            <dd className="font-mono">
                              {sites.find((entry) => entry.id === event.site_id)?.slug ?? event.site_id ?? '—'}
                            </dd>
                            {Object.entries(event.metadata ?? {}).map(([key, value]) => (
                              <Fragment key={key}>
                                <dt className="font-mono text-muted-foreground">{key}</dt>
                                <dd className="break-words font-mono">{String(value)}</dd>
                              </Fragment>
                            ))}
                          </dl>
                        </TD>
                      </TR>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableState>
          </TBody>
        </Table>
      </div>
    </Page>
  )
}
