import { useQueries } from '@tanstack/react-query'
import { ChartNoAxesColumn, TriangleAlert } from 'lucide-react'
import { ck, usageStatsKinds, type StatsKind } from '@/api/ck'
import { useI18n, type TranslationKey } from '@/lib/i18n-context'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { keys } from '@/lib/query'
import { tileEmptiness, visibleMetrics, type TileEmptiness } from '@/lib/stat-tile'

/**
 * The product statistics: read once, classified once, rendered in two places.
 *
 * WHY THIS IS NOT ON THE OVERVIEW ANY MORE
 *
 * §1 is explicit — "Betriebsmetriken (HTTP, p95, Calls) wohnen unter
 * Installation → System, nie auf dem Startscreen" — and the tiles carried
 * durations and success ratios, which is the same class of number under a
 * different name. The Overview keeps exactly one thing from this module, and it
 * keeps it because ContentKit is the family's reference for §4: the sentence
 * "5 von 10 Statistiken haben nichts darzustellen" is a MEASUREMENT, not a
 * shortage, and it is the one statistic a first screen earns.
 *
 * WHY IT IS ONE MODULE RATHER THAN TWO COPIES
 *
 * The two surfaces read the same eight endpoints and must agree about what an
 * empty one means. `tileEmptiness` separates "measured, and the answer is zero"
 * from "nothing came back", and the whole value of that separation is that both
 * screens say the same word for the same state. Two copies of the classification
 * is how a console starts contradicting itself about its own data.
 */

const WINDOW = { bucket: 'day', tz: 'UTC' } as const
export const PRODUCT_STATS: StatsKind[] = [
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

export interface Point {
  ts: string
  /** null is a real answer: the evidence is missing, which is not zero. */
  value: number | null
}

export interface Metric {
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
export interface Tile {
  kind: StatsKind
  /** Usage statistics are opt-in per site, which is why an absent one is ordinary. */
  usage: boolean
  result?: StatsResult
  shown: Metric[]
  lead?: Metric
  emptiness: TileEmptiness
}

export function readTile(kind: StatsKind, result?: StatsResult): Tile {
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
export const QUIET_WORD = {
  'measured-all-zero': 'overview.measuredZero',
  'nothing-came-back': 'overview.notRecorded',
} as const
export const QUIET_WORD_USAGE = {
  'measured-all-zero': 'overview.measuredZero',
  'nothing-came-back': 'overview.notOptedIn',
} as const


/**
 * The eight statistics, asked for once and classified into the four groups a
 * surface actually renders.
 *
 * Grouping is the page's job, not the tile's — that is what let the Overview see
 * that seven of its nine tiles were saying the same thing when each one only
 * ever knew about itself. Doing it here means both surfaces group identically.
 */
export interface StatTiles {
  tiles: Tile[]
  pending: Tile[]
  failed: Tile[]
  reporting: Tile[]
  quiet: Tile[]
}

export function useStatTiles(site: string): StatTiles {
  const results = useQueries({
    queries: PRODUCT_STATS.map((kind) => ({
      queryKey: keys.stats(site, kind, WINDOW),
      queryFn: () => ck.stats(site, kind, WINDOW),
      enabled: Boolean(site),
      // A 403 means this operator lacks stats:read; the surface says so instead
      // of the whole page failing.
      retry: false,
    })),
  })
  const tiles = PRODUCT_STATS.map((kind, index) => readTile(kind, results[index]))
  return {
    tiles,
    pending: tiles.filter((tile) => tile.result?.isPending),
    failed: tiles.filter((tile) => !tile.result?.isPending && tile.result?.error),
    reporting: tiles.filter((tile) => !tile.result?.isPending && !tile.result?.error && tile.shown.length > 0),
    quiet: tiles.filter((tile) => !tile.result?.isPending && !tile.result?.error && tile.shown.length === 0),
  }
}

/**
 * The full statistics surface, as Installation → System renders it: one refusal
 * for the whole surface, the tiles that have something to plot, and the quiet
 * ones named underneath.
 */
export function StatisticsSection({ stats }: { stats: StatTiles }) {
  const { t } = useI18n()
  const { tiles, pending, failed, reporting, quiet } = stats
  return (
    <section className="flex flex-col gap-3" data-testid="ck-system-statistics">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold tracking-tight">{t('overview.statistics')}</h2>
        <p className="text-xs text-muted-foreground">{t('overview.statisticsWindow')}</p>
      </header>

      {/*
        One refusal for the surface, not one per tile. A missing stats:read
        scope fails all eight identically, and eight identical destructive
        alerts is eight times the pixels for one fact about this operator.
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
export function UnreadableStats({ tiles }: { tiles: Tile[] }) {
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
export function QuietStats({ tiles, total }: { tiles: Tile[]; total: number }) {
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
export function StatCard({ tile }: { tile: Tile }) {
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
