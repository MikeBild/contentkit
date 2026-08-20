import { useQueries, useQuery } from '@tanstack/react-query'
import { ChartNoAxesColumn, TriangleAlert } from 'lucide-react'
import { useMemo } from 'react'
import { ck, usageStatsKinds, type Decision, type StatsKind } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { AppLink } from '@/components/app-link'
import { useI18n, type TranslationKey } from '@/lib/i18n-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { ReleaseChain } from '@/components/ui/release-chain'
import { RelativeTime } from '@/components/ui/relative-time'
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { keys } from '@/lib/query'
import { deriveReleaseChain } from '@/lib/release-chain'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'
import { tileEmptiness, visibleMetrics, type TileEmptiness } from '@/lib/stat-tile'

const WINDOW = { bucket: 'day', tz: 'UTC' } as const
const OVERVIEW_STATS: StatsKind[] = [
  'releases',
  'content',
  'decks',
  'readers',
  'webhooks',
  'audio',
  'engagement',
  'compositions',
]

const STAT_KIND_KEYS: Record<StatsKind, TranslationKey> = {
  releases: 'overview.stat.releases',
  content: 'overview.stat.content',
  decks: 'overview.stat.decks',
  readers: 'overview.stat.readers',
  webhooks: 'overview.stat.webhooks',
  audio: 'overview.stat.audio',
  engagement: 'overview.stat.engagement',
  http: 'overview.stat.http',
  compositions: 'overview.stat.compositions',
  mcp: 'overview.stat.mcp',
}

const METRIC_KEYS: Record<string, TranslationKey> = {
  built: 'overview.metric.built',
  activated: 'overview.metric.activated',
  failed: 'overview.metric.failed',
}

interface Point {
  ts: string
  /** null is a real answer: the evidence is missing, which is not zero. */
  value: number | null
}

interface Metric {
  name: string
  total: number | null
  kind?: string
  points: Point[]
}

/**
 * The two stats shapes differ enough that guessing between them produces an
 * empty console against a busy site — which is exactly what happened.
 *
 * ProductStats: `{buckets: [{ts, <metric>: number}], totals: {<metric>: number}}`
 * UsageStats:   `{buckets: [{ts, metrics: {<name>: UsageMetric}}], totals: [{metrics}]}`
 *
 * A UsageMetric carries `value_state`, and `missing` means the evidence was
 * never collected. It is emphatically not zero, so it stays null all the way
 * into the chart rather than being flattened into a plausible-looking 0.
 */
function readProductStats(payload: unknown): Metric[] {
  const stats = payload as { buckets?: Record<string, unknown>[]; totals?: Record<string, number> }
  const totals = stats?.totals ?? {}
  const buckets = stats?.buckets ?? []
  return Object.keys(totals).map((name) => ({
    name,
    // The same test the points below apply, applied to the total: a value that is
    // not a number was not answered, and `?? 0` answered it with the one number
    // an operator reads as "this happened, nought times". null prints as an em
    // dash instead, which is the contract the usage reader beside this one keeps.
    total: typeof totals[name] === 'number' ? totals[name] : null,
    points: buckets.map((bucket) => ({
      ts: String(bucket.ts ?? ''),
      value: typeof bucket[name] === 'number' ? (bucket[name] as number) : null,
    })),
  }))
}

function readUsageStats(payload: unknown): Metric[] {
  const stats = payload as {
    buckets?: { ts?: string; metrics?: Record<string, { value: number | null; value_state: string }> }[]
    totals?: { metrics?: Record<string, { value: number | null; value_state: string; value_kind?: string }> }[]
  }
  // Without group_by there is exactly one totals row; with it, the first is the
  // headline and the console does not pretend to chart the breakdown.
  const totals = stats?.totals?.[0]?.metrics ?? {}
  const buckets = stats?.buckets ?? []
  return Object.entries(totals).map(([name, metric]) => ({
    name,
    total: metric.value_state === 'missing' ? null : (metric.value ?? null),
    kind: metric.value_kind,
    points: buckets.map((bucket) => {
      const point = bucket.metrics?.[name]
      return {
        ts: String(bucket.ts ?? ''),
        value: !point || point.value_state === 'missing' ? null : point.value,
      }
    }),
  }))
}

interface StatsResult {
  data?: unknown
  error?: unknown
  isPending?: boolean
}

/**
 * One statistic, already read and already classified.
 *
 * The classification used to happen inside the tile, which is why the page could
 * not see that seven of its nine tiles were saying the same thing: each one only
 * ever knew about itself. Deriving it here is what lets the page group nine
 * answers into one statement — the tile renders a result, and the *page* owns
 * what to do about the tiles that have none.
 */
interface Tile {
  kind: StatsKind
  /** Usage statistics are opt-in per site, which is why an absent one is ordinary. */
  usage: boolean
  result?: StatsResult
  shown: Metric[]
  lead?: Metric
  emptiness: TileEmptiness
}

function readTile(kind: StatsKind, result?: StatsResult): Tile {
  const usage = usageStatsKinds.includes(kind)
  const metrics = result?.data ? (usage ? readUsageStats(result.data) : readProductStats(result.data)) : []
  // Both rules live in lib/stat-tile.ts so they can be called by a test rather than
  // matched as text — see that module's header for why that distinction earned its own file.
  const shown = visibleMetrics(metrics)
  return { kind, usage, result, shown, lead: shown[0] ?? metrics[0], emptiness: tileEmptiness(metrics) }
}

/**
 * What one quiet statistic is quiet *about*, in the two words a chip has room
 * for.
 *
 * Nine paragraphs became one, and this is the half that must not have been lost
 * with them: `tileEmptiness` separates "measured, and the answer is zero" from
 * "nothing came back", its tests pin that separation, and a layout that prints
 * one word over both would undo it in the one place no test was looking. So the
 * naming is two plain records rather than a chain of ternaries inside JSX —
 * `test/unit/cockpit-overview.test.mjs` slices them out and asserts that the two
 * emptinesses never share a word.
 *
 * The usage record differs in exactly one entry, and that entry is the reason it
 * exists: usage telemetry is opt-in per site, so a usage statistic with nothing
 * in it is ordinarily a site that never switched it on — a different sentence
 * from a product statistic that recorded nothing.
 */
const QUIET_WORD = {
  'measured-all-zero': 'overview.measuredZero',
  'nothing-came-back': 'overview.notRecorded',
} as const
const QUIET_WORD_USAGE = {
  'measured-all-zero': 'overview.measuredZero',
  'nothing-came-back': 'overview.notOptedIn',
} as const

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

  const results = useQueries({
    queries: OVERVIEW_STATS.map((kind) => ({
      queryKey: keys.stats(site, kind, WINDOW),
      queryFn: () => ck.stats(site, kind, WINDOW),
      enabled: Boolean(site),
      // A 403 means this operator lacks stats:read; the tile says so instead of
      // the whole page failing.
      retry: false,
    })),
  })

  const tiles = OVERVIEW_STATS.map((kind, index) => readTile(kind, results[index]))
  const pending = tiles.filter((tile) => tile.result?.isPending)
  const failed = tiles.filter((tile) => !tile.result?.isPending && tile.result?.error)
  const reporting = tiles.filter((tile) => !tile.result?.isPending && !tile.result?.error && tile.shown.length > 0)
  const quiet = tiles.filter((tile) => !tile.result?.isPending && !tile.result?.error && tile.shown.length === 0)

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
                    <li
                      key={event.id}
                      className="flex items-baseline justify-between gap-4 px-(--card-spacing) py-2.5 text-sm"
                    >
                      <span>{event.action}</span>
                      <RelativeTime
                        value={event.created_at}
                        className="shrink-0 text-xs text-muted-foreground"
                        data-testid={`overview-activity-age-${index}`}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-(--card-spacing) text-sm text-muted-foreground">{t('overview.noActivity')}</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/*
          Then the reference half, under its own heading so that it reads as
          material to consult rather than as nine more things to decide about.
        */}
        <section className="flex flex-col gap-3" data-testid="ck-overview-statistics">
          <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-sm font-semibold tracking-tight">{t('overview.statistics')}</h2>
            <p className="text-xs text-muted-foreground">{t('overview.statisticsWindow')}</p>
          </header>

          {/*
            One refusal for the surface, not one per tile. A missing stats:read
            scope fails all nine identically, and nine identical destructive
            alerts is nine times the pixels for one fact about this operator.
          */}
          {failed.length > 0 ? <UnreadableStats tiles={failed} /> : null}

          {pending.length + reporting.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[...pending, ...reporting].map((tile) => (
                <StatCard key={tile.kind} tile={tile} />
              ))}
            </div>
          ) : null}

          {/*
            And one Empty for everything that had nothing to plot. This used to be
            a card each, every one of them carrying its own paragraph — three
            near-identical sentences on the screenshot that started this, carrying
            one fact between them.
          */}
          {quiet.length > 0 ? <QuietStats tiles={quiet} total={tiles.length} /> : null}
        </section>
      </div>
    </Page>
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

/**
 * Every statistic that could not be read, said once per distinct refusal.
 *
 * The server's own words are carried verbatim and grouped by message rather than
 * rewritten into a summary: a 403 and a 500 on the same page are two different
 * problems, and a refusal that names counts loses them the moment it is
 * paraphrased.
 */
function UnreadableStats({ tiles }: { tiles: Tile[] }) {
  const { t } = useI18n()
  const grouped = new Map<string, StatsKind[]>()
  for (const tile of tiles) {
    const message = tile.result?.error instanceof Error ? tile.result.error.message : t('overview.unavailable')
    grouped.set(message, [...(grouped.get(message) ?? []), tile.kind])
  }

  return (
    <Alert variant="destructive" data-testid="ck-overview-unreadable" data-count={tiles.length}>
      <TriangleAlert />
      <AlertTitle>
        {tiles.length === 1 ? t('overview.unreadableOne') : t('overview.unreadableMany', { count: tiles.length })}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-1.5">
        {[...grouped].map(([message, kinds]) => (
          <span key={message} className="flex flex-wrap items-center gap-1.5">
            {kinds.map((kind) => (
              <Badge key={kind} variant="destructive" data-testid={`ck-overview-unreadable-${kind}`}>
                {kind}
              </Badge>
            ))}
            <span>{message}</span>
          </span>
        ))}
      </AlertDescription>
    </Alert>
  )
}

/**
 * Everything with nothing to plot, as one statement and a list of names.
 *
 * The distinction the sentences used to carry is not lost, it is compressed: a
 * window that was measured and answered zero, a window nothing was recorded in,
 * and a site that never opted into usage telemetry are three different facts,
 * and each name below says which of the three it is in two words. `data-emptiness`
 * keeps the same distinction addressable to a browser test.
 */
function QuietStats({ tiles, total }: { tiles: Tile[]; total: number }) {
  const { t } = useI18n()
  return (
    <Empty className="border" data-testid="ck-overview-quiet" data-count={tiles.length}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ChartNoAxesColumn />
        </EmptyMedia>
        <EmptyTitle>{t('overview.quietTitle', { quiet: tiles.length, total })}</EmptyTitle>
        <EmptyDescription>{t('overview.quietDescription')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-none">
        <ul className="flex flex-wrap items-center justify-center gap-1.5">
          {tiles.map((tile) => (
            <li key={tile.kind}>
              <Badge
                variant="outline"
                data-testid={`ck-overview-quiet-${tile.kind}`}
                data-emptiness={tile.emptiness}
                className="gap-1"
              >
                <span>{t(STAT_KIND_KEYS[tile.kind])}</span>
                <span className="text-muted-foreground">
                  · {t((tile.usage ? QUIET_WORD_USAGE : QUIET_WORD)[tile.emptiness])}
                </span>
              </Badge>
            </li>
          ))}
        </ul>
      </EmptyContent>
    </Empty>
  )
}

/**
 * One statistic that has something to say.
 *
 * It no longer has an empty state or an error state of its own: both were facts
 * about the surface rather than about this card, and both now live above it.
 * What is left is the wait and the result — a card that is only ever built for a
 * tile with rows in it, or for one that is still loading them.
 */
function StatCard({ tile }: { tile: Tile }) {
  const { t, number } = useI18n()
  const { kind, usage, result, shown, lead } = tile

  return (
    <Card data-testid={`ck-overview-stat-${kind}`} data-kind={kind}>
      <CardHeader>
        <CardTitle>{t(STAT_KIND_KEYS[kind])}</CardTitle>
        {/* The opt-in note is a status about this tile's data, so it is a Badge
            rather than a differently-sized span, and it sits in the header's own
            action slot — CardHeader re-grids itself once one is present. */}
        {usage ? (
          <CardAction>
            <Badge variant="outline">{t('overview.usageOptIn')}</Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {result?.isPending ? (
          // The tile's own shape: a sparkline band and four metric rows. Twelve of
          // these load at once, so a one-line "Loading…" made the grid settle at
          // twelve short cards and then jolt to full height a moment later.
          <SkeletonGroup label={t('overview.loading')} data-testid={`ck-overview-stat-${kind}-skeleton`}>
            <Skeleton className="h-10 w-full" />
            <div className="mt-3 flex flex-col gap-2">
              {Array.from({ length: 4 }, (_, row) => (
                <div key={row} className="flex items-baseline justify-between gap-3">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
            </div>
          </SkeletonGroup>
        ) : (
          <>
            {lead ? <Sparkline points={lead.points} /> : null}
            <dl className="mt-3 flex flex-col gap-1">
              {shown.map((metric) => (
                <div key={metric.name} className="flex items-baseline justify-between gap-3">
                  {/*
                    The row prints the metric with its underscores rubbed out and
                    truncated to the card's width, so the name the API actually
                    reports — the one to search the docs or a log for — has to stay
                    reachable. It was a native `title`, which is a pointer-only
                    answer to a question a keyboard can also ask.
                  */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <dt
                          tabIndex={0}
                          data-testid={`ck-overview-stat-${kind}-metric-${metric.name}`}
                          className="truncate rounded text-xs text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          {METRIC_KEYS[metric.name] ? t(METRIC_KEYS[metric.name]!) : metric.name.replace(/_/g, ' ')}
                        </dt>
                      </TooltipTrigger>
                      <TooltipContent>{metric.name}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <dd className="shrink-0 text-sm font-semibold tabular-nums">{format(metric, number)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function format(metric: Metric, number: (value: number) => string) {
  if (metric.total === null) return '—'
  if (metric.kind === 'duration') return `${number(Math.round(metric.total))} ms`
  if (metric.kind === 'ratio' || metric.kind === 'percentage') return `${number(metric.total * 100)} %`
  if (metric.kind === 'data-size') return `${number(metric.total / 1024)} kB`
  return number(metric.total)
}

/**
 * An inline SVG rather than a charting dependency: one series, thirty points,
 * and a hard requirement that a gap stays a gap.
 */
function Sparkline({ points }: { points: Point[] }) {
  const values = points.map((point) => point.value).filter((value): value is number => value !== null)
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const step = 100 / Math.max(points.length - 1, 1)

  // Consecutive known points form a segment; a missing point ends it, so the
  // line breaks instead of inventing a value across the gap.
  const segments: string[] = []
  let current: string[] = []
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
      return
    }
    current.push(`${(index * step).toFixed(2)},${(28 - ((point.value - min) / span) * 26).toFixed(2)}`)
  })
  if (current.length > 1) segments.push(current.join(' '))

  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-10 w-full" aria-hidden="true">
      {segments.map((segment, index) => (
        <polyline
          key={index}
          points={segment}
          fill="none"
          stroke="var(--color-chart-1)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
