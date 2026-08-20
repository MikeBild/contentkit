import { useQuery } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { ck, type AuditEvent, type Decision } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { AppLink } from '@/components/app-link'
import { auditPhrase } from '@/lib/audit-action'
import { QuietStats, useStatTiles } from '@/components/statistics'
import { useI18n } from '@/lib/i18n-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ReleaseChain } from '@/components/ui/release-chain'
import { RelativeTime } from '@/components/ui/relative-time'
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton'
import { keys } from '@/lib/query'
import { deriveReleaseChain } from '@/lib/release-chain'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'

export function OverviewPage() {
  const { t } = useI18n()
  const { site, current } = useSite()
  const can = useCan()
  // Both lists are content:read; this page's own scope is stats:read, so an
  // operator may hold one and not the other. Asking anyway would answer 403 and
  // an empty list, and an empty list here means "nothing waiting" — the exact
  // lie the chain exists to avoid. So it is not asked, and the chain says so.
  const canReadChain = can('content:read')
  const canReadDecisions = can('content:write') || can('moderation:write') || can('release:write')
  const decisions = useQuery({
    queryKey: keys.decisions(site, { state: 'open', limit: 3 }),
    queryFn: () => ck.decisions.list(site, { state: 'open', limit: 3 }),
    enabled: Boolean(site) && canReadDecisions,
    retry: false,
  })
  const activity = useQuery({
    queryKey: keys.audit({ site, limit: 5 }),
    queryFn: () => ck.audit({ site, limit: 5 }),
    enabled: Boolean(site) && can('audit:read'),
    retry: false,
  })

  const releases = useQuery({
    queryKey: keys.releases(site),
    queryFn: () => ck.releases.list(site),
    enabled: Boolean(site) && canReadChain,
    retry: false,
    // A build is asynchronous, and 'building' is a state this page reports.
    refetchInterval: (query) => ((query.state.data ?? []).some((row) => row.status === 'building') ? 3000 : false),
  })
  const content = useQuery({
    queryKey: keys.content.list(site),
    queryFn: () => ck.content.list(site),
    enabled: Boolean(site) && canReadChain,
    retry: false,
    staleTime: 60_000,
  })

  // `undefined` from a pending or failed query becomes `null`: absent evidence,
  // never an empty list. The endpoints are unpaginated, so a count taken here is
  // the whole site and not the first page of it.
  const chain = useMemo(
    () =>
      deriveReleaseChain({
        releases: releases.data ?? null,
        items: content.data ?? null,
        baseUrl: current?.base_url ?? null,
      }),
    [releases.data, content.data, current?.base_url],
  )
  const chainLoading = canReadChain && (releases.isPending || content.isPending)

  // The statistics are still READ here, because the one thing this page keeps
  // from them is a measurement about all of them: "5 von 8 haben nichts
  // darzustellen" is only true if all 8 were asked. The tiles themselves render
  // under Installation → System (§1).
  const stats = useStatTiles(site)

  // A decision is overdue when its 72-hour deadline has passed (src/decisions.mjs
  // sets `due_at` to opened_at + 72h), which is what makes this the "Frist
  // gerissen" of §8.7 rather than a second, softer reading of the same queue.
  // Undefined while the queue is unread, and deliberately not defaulted to 0: a
  // queue nobody has answered yet is not a queue known to be on time.
  const overdue = decisions.data?.counts.overdue

  if (!site) {
    return (
      <Page title={t('page.overview.title')}>
        <NoSite />
      </Page>
    )
  }

  return (
    // The description says what the page is for. What the numbers underneath it
    // are measured over is a fact about the numbers, so it sits with them.
    <Page title={t('page.overview.title')} description={t('page.overview.description', { site })}>
      <div className="flex flex-col gap-6">
        {/*
          §8.7, and its two load-bearing halves are position and exit.

          The banner used to live inside the "Wartet auf dich" card, which read
          the same to a person and was wrong twice over: a nested alert is
          announced *after* whatever the card says above it, and a reader who
          scrolls past the card has scrolled past the incident. The paragraph is
          a statement about document order — "oberhalb aller Kacheln" — so the
          banner is the first block of the page and belongs to no card.

          The second half is the link. A red banner that names a number and
          offers no way to the thing it counts is the "kein Rot ohne Weg zur
          Ursache" defect of §1 in its purest form. Exactly one link, and it goes
          to the decision page — a second one would make the way ambiguous.
        */}
        {overdue ? <OverdueBanner site={site} count={overdue} /> : null}

        {canReadDecisions ? <DecisionZone site={site} result={decisions.data} loading={decisions.isPending} /> : null}

        {/*
          First, and alone: the chain is the only thing on this page an operator
          acts on. A chain with nothing wrong in it is one line; a chain with an
          exception in it earns the block, because that is the state that has to
          be acted on. The derivation is the same either way — the variant is a
          layout choice, not a second reading of the same two endpoints.
        */}
        <ReleaseChain chain={chain} isLoading={chainLoading} variant={chain.calm ? 'compact' : 'card'} />

        {can('audit:read') ? (
          <Card data-testid="ck-overview-activity">
            <CardHeader>
              <CardTitle>{t('overview.activity')}</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {activity.isPending ? (
                <SkeletonGroup className="px-(--card-spacing)">
                  <Skeleton className="h-16" />
                </SkeletonGroup>
              ) : activity.data?.length ? (
                <ul className="divide-y divide-border">
                  {activity.data.map((event, index) => (
                    <ActivityRow key={event.id} event={event} index={index} />
                  ))}
                </ul>
              ) : (
                <p className="px-(--card-spacing) text-sm text-muted-foreground">{t('overview.noActivity')}</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/*
          The one statistic a first screen earns, and the reason ContentKit is
          the family's reference for §4: "5 von 8 Statistiken haben nichts
          darzustellen" is a measurement, not a shortage — and it names which
          nothing each one is. The tiles it counts live under Installation →
          System, where §1 puts operational numbers; the link is how an operator
          gets from the count to the things counted.
        */}
        {stats.quiet.length > 0 ? (
          <section className="flex flex-col gap-3" data-testid="ck-overview-statistics">
            <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-sm font-semibold tracking-tight">{t('overview.statistics')}</h2>
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <AppLink data-testid="overview-open-statistics" to="/system">
                  {t('overview.allStatistics')}
                </AppLink>
              </Button>
            </header>
            <QuietStats tiles={stats.quiet} total={stats.tiles.length} />
          </section>
        ) : null}
      </div>
    </Page>
  )
}

/**
 * One thing that happened, said in words, with the machine value beside it.
 *
 * Zone C used to print `event.action` — "release.promote" — which is §5's rule
 * broken at its plainest: German on the top level, the API's own vocabulary only
 * once somebody goes looking for it. The sentence comes first now and the raw
 * action stays, in mono and dimmed, because it is the string an operator filters
 * the audit trail by and greps a log for; deleting it would trade one kind of
 * unreadable for another.
 *
 * An action `lib/audit-action.ts` cannot name keeps only the machine value. A
 * plausible German sentence over an event nobody mapped is a worse row than the
 * raw string, because the raw string admits what it is.
 */
function ActivityRow({ event, index }: { event: AuditEvent; index: number }) {
  const { t } = useI18n()
  const phrase = auditPhrase(event.action)
  const label = event.resource_label
  const sentence = phrase
    ? label
      ? t('overview.eventNamed', { subject: t(phrase.subject), label, verb: t(phrase.verb) })
      : t('overview.event', { subject: t(phrase.subject), verb: t(phrase.verb) })
    : null

  return (
    <li className="flex items-baseline justify-between gap-4 px-(--card-spacing) py-2.5 text-sm">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {sentence ? <span className="min-w-0 truncate">{sentence}</span> : null}
        <code
          data-testid={`overview-activity-action-${index}`}
          className="font-mono text-xs break-all text-muted-foreground"
        >
          {event.action}
        </code>
      </span>
      <RelativeTime
        value={event.created_at}
        className="shrink-0 text-xs text-muted-foreground"
        data-testid={`overview-activity-age-${index}`}
      />
    </li>
  )
}

/**
 * The incident banner of §8.7: not dismissable, first on the page, one way out.
 *
 * It carries the number rather than a mood — "3 Entscheidungen warten länger als
 * drei Tage" is a fact an operator can check against the queue, "Es gibt
 * überfällige Entscheidungen" is not — and the singular is its own sentence,
 * because "1 Entscheidungen" is the smallest way for a console to look
 * unattended.
 *
 * There is no close control on purpose. A banner an operator can dismiss is a
 * banner that stops being true without anything having been decided; the way to
 * make it go away is the link.
 */
function OverdueBanner({ site, count }: { site: string; count: number }) {
  const { t } = useI18n()
  return (
    <Alert variant="destructive" data-testid="ck-overview-overdue" data-count={count}>
      <TriangleAlert />
      <AlertTitle>
        {count === 1 ? t('overview.overdueDecisionOne') : t('overview.overdueDecisions', { count })}
      </AlertTitle>
      <AlertDescription>
        <AppLink data-testid="overview-overdue-link" to="/decisions" search={{ site } as never}>
          {t('overview.overdueLink')}
        </AppLink>
      </AlertDescription>
    </Alert>
  )
}

function DecisionZone({
  site,
  result,
  loading,
}: {
  site: string
  result?: { items: Decision[]; counts: { open: number; overdue: number } }
  loading: boolean
}) {
  const { t } = useI18n()
  const count = result?.counts.open ?? 0
  return (
    <Card className={count ? 'border-warning/40' : undefined} data-testid="ck-overview-decisions">
      <CardHeader>
        <div>
          <CardTitle>{t('overview.waitingForYou')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? t('common.loading') : count ? t('overview.openDecisions', { count }) : t('overview.noDecisions')}
          </p>
        </div>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <AppLink data-testid="overview-open-decisions" to="/decisions" search={{ site } as never}>
              {t('overview.openQueue')}
            </AppLink>
          </Button>
        </CardAction>
      </CardHeader>
      {result?.items.length ? (
        <CardContent className="px-0">
          <ul className="divide-y divide-border">
            {result.items.slice(0, 3).map((decision, index) => (
              <li key={decision.id} className="flex items-center justify-between gap-4 px-(--card-spacing) py-2.5">
                <span className="min-w-0 text-sm font-medium">{decision.title}</span>
                <RelativeTime
                  value={decision.opened_at}
                  className="shrink-0 text-xs text-muted-foreground"
                  data-testid={`overview-decision-age-${index}`}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  )
}
