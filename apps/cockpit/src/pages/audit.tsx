import { useQuery } from '@tanstack/react-query'
import { Fragment, useMemo, useState } from 'react'
import { ck, type AuditEvent } from '@/api/ck'
import { Page } from '@/app/shell'
import { Button } from '@/components/ui/button'
import { auditPhrase, auditResourceKind } from '@/lib/audit-action'
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
 * The list is the decision verbs from all three surfaces, and it is a list of
 * DEEDS: one entry per thing an operator did, because /v1/audit-events filters
 * `action` by equality and two entries under one label would be two halves of an
 * answer with nothing on screen saying so.
 *
 * That is why the moderation verbs appear once. They used to be written twice —
 * REST audited the resulting status (`comment.approved`), the MCP tool the
 * requested action (`comment.approve`) — and this comment claimed both spellings
 * stood here while only the REST one did: an operator who picked "Kommentar
 * freigeben" was shown the comments approved over HTTP and not the ones approved
 * over MCP (LOCAL-CK-AUDIT-MCP-SCHREIBWEISE). The fix is at the writer —
 * src/mcp/tools.mjs now audits the resulting status too — so one deed is one
 * action string. The spelling MCP used until then is named in AUDIT_ACTION_KEYS
 * below, so rows already in the trail read as German rather than as machine
 * values; it is deliberately not a filter entry, because a second option reading
 * "Kommentar freigeben" would be a promise the equality filter cannot keep.
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
 *
 * Both halves are FIXED LISTS. Deriving the options from the loaded page was
 * circular: the filter could only offer what the last fifty rows happened to
 * contain, so the one action an operator is hunting for — the rare revoke, the
 * failed build — was exactly the one missing from the menu. What holds a fixed
 * list to the server instead is test/unit/cockpit-audit-action.test.mjs, which
 * reads the actions out of src/** and fails when the Cockpit cannot ask for one.
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
  // LEGACY SPELLINGS, named but not offered. Until LOCAL-CK-AUDIT-MCP-SCHREIBWEISE
  // the MCP moderation tool audited the requested action rather than the
  // resulting status, so rows written before that fix say `comment.approve` and
  // `comment.reject`. The trail is append-only: those rows are still there and a
  // table that did not know them would print them at an operator as machine
  // strings. They are not in AUDIT_ACTIONS because the filter is a list of
  // deeds — see the comment above DECISION_ACTIONS.
  'comment.approve': 'audit.action.commentApprove',
  'comment.reject': 'audit.action.commentReject',
} as const satisfies Record<string, TranslationKey>

/**
 * The German name for one operation — §15.2's "Vorgang".
 *
 * THREE READINGS, AND NO SILENT FOURTH.
 *
 * 1. `lib/audit-action.ts`, which composes `<subject>.<verb>` in the PAST tense
 *    and reaches every action the server assembles at a call site. This is what
 *    the Overview has used since the last time a raw value stood in front of an
 *    operator, and it is first here so that one column speaks one tense: a
 *    trail is a list of things that are over. The filter's vocabulary is
 *    infinitive on purpose — there it labels a choice, not an event — and
 *    putting it in the rows made "Kommentar freigeben" sit under
 *    "Sitzung begonnen" in the same column.
 * 2. The filter's vocabulary, for an action the composition cannot name.
 * 3. `null` — and the caller prints the machine value MARKED AS ONE.
 *
 * What is gone is the fallback that returned the raw action as if it were a
 * name: `oauth.login` sat in typewriter type between two German sentences and
 * nothing anywhere said the mapping had a hole. §15.2 allows a machine value —
 * "als solcher erkennbar" — and forbids both a plausible German invention and
 * "Unbekannt". A silent fallback is the shape that lets the next hole through,
 * so the hole is now also a red test: test/unit/cockpit-audit-action.test.mjs
 * reads every action out of src/ and fails on the first one neither reading can
 * name.
 */
const auditOperation = (
  t: (key: TranslationKey) => string,
  action: string,
): { label: string; machine: false } | { label: string; machine: true } => {
  const phrase = auditPhrase(action)
  if (phrase) return { label: `${t(phrase.subject)} ${t(phrase.verb)}`, machine: false }
  if (action in AUDIT_ACTION_KEYS) {
    return { label: t(AUDIT_ACTION_KEYS[action as keyof typeof AUDIT_ACTION_KEYS]), machine: false }
  }
  return { label: action, machine: true }
}

/**
 * Who caused the row — §15.2's "Verursacher".
 *
 * The label the source carries, else the actor TYPE it carries, else a dash.
 * The type is read, not inferred; "Unbekannter Akteur" was neither, and §15.2
 * says plainly that where the source carries none the answer is a dash.
 */
const originLabel = (t: (key: TranslationKey) => string, event: AuditEvent) => {
  const type = AUDIT_ACTOR_KEYS[event.actor_type as keyof typeof AUDIT_ACTOR_KEYS]
  return event.actor_label || (type ? t(type) : '—')
}

/** The German kind for a row's resource, or a dash — §15.2 forbids inventing "Unbekannt". */
const kindLabel = (t: (key: TranslationKey) => string, resourceType: string | null | undefined) => {
  const key = auditResourceKind(resourceType)
  return key ? t(key) : '—'
}

/** The operation as one cell: a German name, or the machine value shown as one. */
function Operation({ action }: { action: string }) {
  const { t } = useI18n()
  const read = auditOperation(t, action)
  if (!read.machine) return <span>{read.label}</span>
  // Named as a machine value ON THE SURFACE, not in a `title`: a tooltip is
  // invisible to touch and to the keyboard, and the whole point is that nobody
  // reads this as German. §15.2 asks for "als solcher erkennbar" — so it says so.
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <code className="font-mono text-xs break-all">{read.label}</code>
      <span className="text-xs text-muted-foreground">{t('audit.machineValue')}</span>
    </span>
  )
}

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
        id: 'operation',
        priority: 'essential',
        kind: 'identity',
        label: t('audit.operation'),
        compare: (left, right) => compareText(left.action, right.action),
        cell: (event) => <Operation action={event.action} />,
      },
      {
        id: 'kind',
        priority: 'supporting',
        label: t('audit.kind'),
        compare: (left, right) => compareText(left.resource_type, right.resource_type),
        className: 'text-muted-foreground',
        // §15.2's "Art" is the KIND, and the label of the object is not a kind.
        // A row about a release named "2026-08-19" says "Release" here; which
        // release it was is the detail below it.
        cell: (event) => kindLabel(t, event.resource_type),
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
        id: 'origin',
        priority: 'supporting',
        kind: 'identity',
        label: t('audit.origin'),
        compare: (left, right) => compareText(left.actor_label, right.actor_label),
        className: 'text-muted-foreground',
        // §15.2: a dash where the source carries none — NEVER inferred. The
        // actor type is carried by the row, so naming it is reading and not
        // guessing; "Unbekannter Akteur" was neither, and is gone.
        cell: (event) => originLabel(t, event),
      },
      // Product-specific columns, and to the RIGHT of the five (§15.2).
      {
        id: 'site',
        priority: 'detail',
        label: t('audit.site'),
        hiddenByDefault: true,
        compare: (left, right) => compareText(left.site_label, right.site_label),
        className: 'text-muted-foreground',
        cell: (event) => event.site_label ?? '—',
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
    <Page title={t('audit.title')} description={t('audit.description')}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/*
          The three filters are Radix Selects now, and each one's `data-testid`
          sits on its `SelectTrigger`: `Select` itself is the headless root and
          renders no DOM node at all, so an id on it would name nothing. The names
          are unchanged — `ck-audit-site-filter`, `ck-audit-action-filter`,
          `ck-audit-limit-filter` are what scripts/verify-cockpit-prod.md drives.
        */}
        <Select value={scope || ANY} onValueChange={(next) => setScope(next === ANY ? '' : next)}>
          <SelectTrigger className="w-44" data-testid="ck-audit-site-filter" aria-label={t('audit.filter.site')}>
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
          <SelectTrigger className="w-52" data-testid="ck-audit-action-filter" aria-label={t('audit.filter.action')}>
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
          <SelectTrigger className="w-32" data-testid="ck-audit-limit-filter" aria-label={t('audit.filter.limit')}>
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
          <Button variant="ghost" size="sm" data-testid="ck-audit-follow-site" onClick={() => setScope(site)}>
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
        emptyMessage={action || scope ? t('audit.empty.filteredDescription') : t('audit.empty.description')}
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
                  <p className="text-xs font-medium">
                    <Operation action={event.action} />
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {originLabel(t, event)}
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
                  {event.resource_label || kindLabel(t, event.resource_type)}
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
        renderExpandedRow={(event) => (expanded === event.id ? detail(event) : null)}
      />
    </Page>
  )
}
