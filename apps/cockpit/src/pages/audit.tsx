import { useQuery } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'
import { ck, type AuditEvent } from '@/api/ck'
import { Page } from '@/app/shell'
import { Button } from '@/components/ui/button'
import { DataTable, firstPage, useTableView, type DataColumn } from '@/components/ui/data-table'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/forms/status-badge'
import { keys } from '@/lib/query'
import { useSite } from '@/lib/site'
import { useI18n, type TranslationKey } from '@/lib/i18n-context'
import { visibleMetadata } from '@/lib/opaque'
import { compareText, compareTime } from '@/lib/table-view'

/**
 * What happened to a decision, as the trail records it.
 *
 * This is the other half of §8.5. The Entscheidungen page shows what is waiting
 * and nothing else, so the deferred, the dismissed and the decided are only
 * reachable here — and "reachable" has to mean more than "the row exists". The
 * server has written `decision.dismiss`, `comment.approved`,
 * `draft_capture.triage` and the rest all along (src/routes.mjs, src/mcp/tools.mjs);
 * what was missing was a name for them and a way to ask for them. Without both,
 * an operator looking for a decision they made last week had to page through
 * every event in the installation and read machine strings.
 *
 * The list is the decision verbs from all three surfaces, including both
 * spellings the moderation routes produce: REST audits the resulting status
 * (`comment.approved`), MCP audits the requested action (`comment.approve`), and
 * which one wrote the row is not something an operator should have to know.
 */
const DECISION_ACTIONS = [
  'decision.defer',
  'decision.dismiss',
  'decision.restore',
  'comment.approved',
  'comment.rejected',
  'contact.read',
  'contact.closed',
  'feedback.reset',
  'draft_capture.triage',
  'draft_capture.discard',
  'promotion_review.activate',
  'promotion_review.reject',
] as const

/**
 * Everything else worth filtering by — the administrative half.
 */
const ADMIN_ACTIONS = [
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

/**
 * The actions worth filtering by, as a fixed list.
 *
 * Deriving the options from the loaded page was circular: the filter could only
 * offer what the last fifty rows happened to contain, so the one action an
 * operator is hunting for — the rare revoke, the failed build — was exactly the
 * one missing from the menu.
 */
const AUDIT_ACTIONS = [...DECISION_ACTIONS, ...ADMIN_ACTIONS] as const

const LIMITS = [50, 100, 200]

const AUDIT_ACTOR_KEYS = {
  api_key: 'audit.actor.api_key',
  oauth: 'audit.actor.oauth',
  operator: 'audit.actor.operator',
  system: 'audit.actor.system',
} as const satisfies Record<string, TranslationKey>

const AUDIT_RESULT_KEYS = {
  success: 'audit.result.success',
  denied: 'audit.result.denied',
  failed: 'audit.result.failed',
  cancelled: 'audit.result.cancelled',
} as const satisfies Record<string, TranslationKey>

const AUDIT_ACTION_KEYS = {
  'decision.defer': 'audit.action.decisionDefer',
  'decision.dismiss': 'audit.action.decisionDismiss',
  'decision.restore': 'audit.action.decisionRestore',
  'comment.approved': 'audit.action.commentApprove',
  'comment.rejected': 'audit.action.commentReject',
  'contact.read': 'audit.action.contactRead',
  'contact.closed': 'audit.action.contactClose',
  'feedback.reset': 'audit.action.feedbackReset',
  'draft_capture.triage': 'audit.action.draftTriage',
  'draft_capture.discard': 'audit.action.draftDiscard',
  'promotion_review.activate': 'audit.action.promotionActivate',
  'promotion_review.reject': 'audit.action.promotionReject',
  'api_key.create': 'audit.action.apiKeyCreate',
  'api_key.revoke': 'audit.action.apiKeyRevoke',
  'identity.create': 'audit.action.identityCreate',
  'identity.update': 'audit.action.identityUpdate',
  'identity.restore': 'audit.action.identityRestore',
  'identity.revoke': 'audit.action.identityRevoke',
  'site.create': 'audit.action.siteCreate',
  'site.delete': 'audit.action.siteDelete',
  'release.create': 'audit.action.releaseCreate',
  'release.activate': 'audit.action.releaseActivate',
  'release.delete': 'audit.action.releaseDelete',
  'content.publish': 'audit.action.contentPublish',
  'content.unpublish': 'audit.action.contentUnpublish',
  'content.delete': 'audit.action.contentDelete',
} as const satisfies Record<(typeof AUDIT_ACTIONS)[number], TranslationKey>

const auditActionLabel = (t: (key: TranslationKey) => string, action: string) =>
  action in AUDIT_ACTION_KEYS ? t(AUDIT_ACTION_KEYS[action as keyof typeof AUDIT_ACTION_KEYS]) : action

/**
 * "No filter", as a value Radix will accept.
 *
 * A `SelectItem` may not carry an empty value — Radix reserves it for "nothing
 * selected" and throws on it — while this page's query means "every site" and
 * "all actions" by the empty string. So the sentinel exists at the control and
 * nowhere else: it is put on the way in and taken off in `onValueChange`, and
 * `scope`/`action` still hold '' exactly as before. The leading underscores keep
 * it outside the slug and action alphabets, so no real value can collide.
 */
const ANY = '__any'

/**
 * The installation's audit trail, with its own site filter.
 *
 * One page, one list, so it takes the container ladder's first step and has no
 * container of its own: three filters and the table. The table's own `Card` is
 * the frame every list in this console wears, not a section around the page.
 *
 * The shared `DataTable` owns the window, responsive card rows and expanded
 * evidence. The detail stays directly below its event on both layouts, while
 * UUID-shaped actor/resource metadata is deliberately omitted from the visible
 * account surface.
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
  // The site filter is seeded from the switcher when this page opens. On a cold
  // load nothing is selected yet, so it starts on every site.
  // moving the switcher does not change this list after that.
  const { t, dateTime } = useI18n()
  const { site, sites } = useSite()
  const [action, setAction] = useState('')
  const [scope, setScope] = useState(site)
  const [limit, setLimit] = useState(50)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [page, setPage] = useState(firstPage)

  // All three go to the server. Filtering a page the server already truncated
  // to fifty rows answers a different question than the one being asked.
  const query = { ...(scope ? { site: scope } : {}), ...(action ? { action } : {}), limit }
  const events = useQuery({ queryKey: keys.audit(query), queryFn: () => ck.audit(query) })
  const rows = events.data ?? []
  const selected = sites.find((entry) => entry.slug === site)
  const diverged = Boolean(site) && scope !== site
  const columns = useMemo<DataColumn<AuditEvent>[]>(
    () => [
      {
        id: 'when',
        label: t('audit.when'),
        required: true,
        priority: 'essential',
        compare: (left, right) => compareTime(left.created_at, right.created_at),
        descFirst: true,
        className: 'whitespace-nowrap text-muted-foreground',
        cell: (event) => dateTime(event.created_at),
      },
      {
        id: 'actor',
        priority: 'supporting',
        kind: 'identity',
        label: t('audit.actor'),
        compare: (left, right) => compareText(left.actor_label, right.actor_label),
        className: 'text-muted-foreground',
        cell: (event) => event.actor_label || t(AUDIT_ACTOR_KEYS[event.actor_type as keyof typeof AUDIT_ACTOR_KEYS] ?? 'audit.unknownActor'),
      },
      {
        id: 'action',
        priority: 'essential',
        kind: 'identity',
        label: t('audit.action'),
        compare: (left, right) => compareText(left.action, right.action),
        className: 'font-mono text-xs',
        cell: (event) => auditActionLabel(t, event.action),
      },
      {
        id: 'resource',
        priority: 'detail',
        label: t('audit.resource'),
        compare: (left, right) => compareText(left.resource_label, right.resource_label),
        className: 'text-muted-foreground',
        cell: (event) => event.resource_label || event.resource_type || t('audit.unknownResource'),
      },
      {
        id: 'result',
        priority: 'essential',
        kind: 'status',
        label: t('audit.result'),
        compare: (left, right) => compareText(left.result, right.result),
        cell: (event) => (
          <StatusBadge tone={event.result === 'success' ? 'success' : 'danger'}>
            {t(AUDIT_RESULT_KEYS[event.result as keyof typeof AUDIT_RESULT_KEYS] ?? 'audit.result.failed')}
          </StatusBadge>
        ),
      },
      {
        id: 'transport',
        priority: 'detail',
        label: t('audit.transport'),
        hiddenByDefault: true,
        compare: (left, right) => compareText(left.transport, right.transport),
        className: 'text-muted-foreground',
        cell: (event) => event.transport ?? '—',
      },
      {
        id: 'actions',
        label: t('common.actions'),
        required: true,
        priority: 'essential',
        kind: 'actions',
        headerHidden: true,
        cell: (event, rowIndex) => {
          const open = expanded === event.id
          return (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={open}
              data-testid={`ck-audit-row-${rowIndex}-expand`}
              onClick={() => setExpanded(open ? null : event.id)}
            >
              {t(open ? 'common.hide' : 'common.details')}
            </Button>
          )
        },
      },
    ],
    [dateTime, expanded, t],
  )
  const { view, setView } = useTableView('audit', columns)

  const detail = (event: AuditEvent) => (
    <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted-foreground">{t('audit.site')}</dt>
      <dd>{event.site_label || sites.find((entry) => entry.id === event.site_id)?.name || '—'}</dd>
      {Object.entries(event.metadata ?? {}).map(([key, value]) => {
        const visible = visibleMetadata(value)
        return visible ? (
          <Fragment key={key}>
            <dt className="font-mono text-muted-foreground">{key}</dt>
            <dd className="break-words font-mono">{visible}</dd>
          </Fragment>
        ) : null
      })}
    </dl>
  )

  return (
    <Page
      title={t('audit.title')}
      description={t('audit.description')}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/*
          The three filters are Radix Selects now, and each one's `data-testid`
          sits on its `SelectTrigger`: `Select` itself is the headless root and
          renders no DOM node at all, so an id on it would name nothing. The names
          are unchanged — `ck-audit-site-filter`, `ck-audit-action-filter`,
          `ck-audit-limit-filter` are what scripts/verify-cockpit-prod.md drives.
        */}
        <Select
          value={scope || ANY}
          onValueChange={(next) => setScope(next === ANY ? '' : next)}
        >
          <SelectTrigger
            className="w-44"
            data-testid="ck-audit-site-filter"
            aria-label={t('audit.filter.site')}
          >
            <SelectValue placeholder={t('site.every')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {/* Radix refuses an empty item value — it is how it spells "no
                  selection" — so "every" is a sentinel the state layer undoes. */}
              <SelectItem value={ANY}>{t('site.every')}</SelectItem>
              {sites.map((entry) => (
                <SelectItem key={entry.id} value={entry.slug}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={action || ANY} onValueChange={(next) => setAction(next === ANY ? '' : next)}>
          <SelectTrigger
            className="w-52"
            data-testid="ck-audit-action-filter"
            aria-label={t('audit.filter.action')}
          >
            <SelectValue placeholder={t('audit.allActions')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ANY}>{t('audit.allActions')}</SelectItem>
            </SelectGroup>
            {/*
              Two groups rather than one alphabet. The decision verbs are what an
              operator arrives with from the Entscheidungen page — that page shows
              only open work now, so this menu is the way back to what was already
              answered — and a heading is what makes them findable among the
              installation's administrative traffic.
            */}
            <SelectGroup>
              <SelectLabel>{t('audit.group.decisions')}</SelectLabel>
              {DECISION_ACTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(AUDIT_ACTION_KEYS[value])}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>{t('audit.group.administration')}</SelectLabel>
              {ADMIN_ACTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(AUDIT_ACTION_KEYS[value])}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={String(limit)} onValueChange={(next) => setLimit(Number(next))}>
          <SelectTrigger
            className="w-32"
            data-testid="ck-audit-limit-filter"
            aria-label={t('audit.filter.limit')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {LIMITS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {t('audit.last', { count: value })}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
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
            {t(scope ? 'audit.followSite' : 'audit.followEvery', {
              scope,
              site: selected?.name ?? site,
            })}
          </Button>
        ) : null}
      </div>

      <DataTable
        testId="ck-audit"
        columns={columns}
        rows={rows}
        rowKey={(event) => event.id}
        rowTestId="ck-audit-row"
        expandedRowTestId="ck-audit-detail"
        rowAttributes={(event) => ({ 'data-event': event.id })}
        isLoading={events.isPending}
        error={events.error}
        onRetry={() => events.refetch()}
        emptyMessage={
          action || scope
            ? t('audit.empty.filteredDescription')
            : t('audit.empty.description')
        }
        view={view}
        onViewChange={setView}
        page={page}
        onPageChange={setPage}
        pageSize={limit}
        unit={t('common.events')}
        renderMobileRow={(event, rowIndex) => {
          const open = expanded === event.id
          return (
            <div className="grid gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{auditActionLabel(t, event.action)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {event.actor_label || t(AUDIT_ACTOR_KEYS[event.actor_type as keyof typeof AUDIT_ACTOR_KEYS] ?? 'audit.unknownActor')}
                    {' · '}
                    {dateTime(event.created_at)}
                  </p>
                </div>
                <StatusBadge tone={event.result === 'success' ? 'success' : 'danger'}>
                  {t(AUDIT_RESULT_KEYS[event.result as keyof typeof AUDIT_RESULT_KEYS] ?? 'audit.result.failed')}
                </StatusBadge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-xs text-muted-foreground">
                  {event.resource_label || event.resource_type || t('audit.unknownResource')}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={open}
                  data-testid={`ck-audit-row-${rowIndex}-expand`}
                  onClick={() => setExpanded(open ? null : event.id)}
                >
                  {t(open ? 'common.hide' : 'common.details')}
                </Button>
              </div>
            </div>
          )
        }}
        renderExpandedRow={(event) => expanded === event.id ? detail(event) : null}
      />
    </Page>
  )
}
