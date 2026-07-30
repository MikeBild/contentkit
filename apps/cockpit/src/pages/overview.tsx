import { useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ck, statsKinds, usageStatsKinds, type StatsKind } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives'
import { ReleaseChain } from '@/components/ui/release-chain'
import { keys } from '@/lib/query'
import { deriveReleaseChain } from '@/lib/release-chain'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'
import { tileEmptiness, visibleMetrics } from '@/lib/stat-tile'

const WINDOW = { bucket: 'day', tz: 'UTC' } as const

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

export function OverviewPage() {
  const { site, current } = useSite()
  const can = useCan()
  // Both lists are content:read; this page's own scope is stats:read, so an
  // operator may hold one and not the other. Asking anyway would answer 403 and
  // an empty list, and an empty list here means "nothing waiting" — the exact
  // lie the chain exists to avoid. So it is not asked, and the chain says so.
  const canReadChain = can('content:read')

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
    queries: statsKinds.map((kind) => ({
      queryKey: keys.stats(site, kind, WINDOW),
      queryFn: () => ck.stats(site, kind, WINDOW),
      enabled: Boolean(site),
      // A 403 means this operator lacks stats:read; the tile says so instead of
      // the whole page failing.
      retry: false,
    })),
  })

  if (!site) {
    return (
      <Page title="Overview">
        <NoSite />
      </Page>
    )
  }

  return (
    <Page title="Overview" description={`Daily UTC aggregates for ${site}, last 30 buckets.`}>
      {/*
        Summary first. A chain with nothing wrong in it is one line; a chain with
        an exception in it earns the block, because that is the state an operator
        has to act on. The derivation is the same either way — the variant is a
        layout choice, not a second reading of the same two endpoints.
      */}
      <ReleaseChain
        chain={chain}
        isLoading={chainLoading}
        variant={chain.calm ? 'compact' : 'card'}
        className="mb-4"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statsKinds.map((kind, index) => (
          <StatCard key={kind} kind={kind} result={results[index]} />
        ))}
      </div>
    </Page>
  )
}

function StatCard({
  kind,
  result,
}: {
  kind: StatsKind
  result?: { data?: unknown; error?: unknown; isPending?: boolean }
}) {
  const usage = usageStatsKinds.includes(kind)
  const metrics = result?.data ? (usage ? readUsageStats(result.data) : readProductStats(result.data)) : []
  // Both rules live in lib/stat-tile.ts so they can be called by a test rather than
  // matched as text — see that module's header for why that distinction earned its own file.
  const shown = visibleMetrics(metrics)
  const lead = shown[0] ?? metrics[0]
  const emptiness = tileEmptiness(metrics)

  return (
    <Card data-testid="stat-card" data-kind={kind}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="capitalize">{kind}</span>
          {usage ? <span className="text-[0.65rem] font-normal text-muted-foreground">usage · opt-in</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {result?.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : result?.error ? (
          <p className="text-sm text-muted-foreground">
            {result.error instanceof Error ? result.error.message : 'Unavailable'}
          </p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="stat-card-empty" data-emptiness={emptiness}>
            {emptiness === 'measured-all-zero'
              ? 'Measured in this window, and every value is zero.'
              : usage
                ? 'No usage telemetry in this window.'
                : 'Nothing recorded in this window.'}
          </p>
        ) : (
          <>
            {lead ? <Sparkline points={lead.points} /> : null}
            <dl className="mt-3 space-y-1">
              {shown.map((metric) => (
                <div key={metric.name} className="flex items-baseline justify-between gap-3">
                  <dt className="truncate text-xs text-muted-foreground" title={metric.name}>
                    {metric.name.replace(/_/g, ' ')}
                  </dt>
                  <dd className="shrink-0 text-sm font-semibold tabular-nums">{format(metric)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function format(metric: Metric) {
  if (metric.total === null) return '—'
  if (metric.kind === 'duration') return `${Math.round(metric.total)} ms`
  if (metric.kind === 'ratio' || metric.kind === 'percentage') return `${(metric.total * 100).toFixed(1)} %`
  if (metric.kind === 'data-size') return `${(metric.total / 1024).toFixed(1)} kB`
  return metric.total.toLocaleString()
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
