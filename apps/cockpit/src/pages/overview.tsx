import { useQueries } from '@tanstack/react-query'
import { ck, statsKinds, usageStatsKinds, type StatsKind } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives'
import { keys } from '@/lib/query'
import { useSite } from '@/lib/site'

const WINDOW = { bucket: 'day', tz: 'UTC' } as const

interface Point {
  label: string
  value: number | null
}

/**
 * UsageStats metrics carry an explicit `value_state`. "missing" means the
 * evidence was never collected — it is emphatically not zero, and drawing it
 * as zero would invent a fact. Missing points break the line instead.
 */
function toSeries(payload: unknown): Point[] {
  const stats = payload as { series?: { buckets?: unknown[] }[]; metrics?: unknown[] } | undefined
  const first = stats?.series?.[0] as { buckets?: Record<string, unknown>[] } | undefined
  const buckets = first?.buckets ?? (stats?.metrics as Record<string, unknown>[] | undefined) ?? []
  return buckets.slice(-30).map((bucket) => {
    const label = String(bucket.bucket ?? bucket.at ?? bucket.start ?? '')
    const missing = bucket.value_state === 'missing'
    const raw = bucket.value ?? bucket.count
    return { label, value: missing || raw === null || raw === undefined ? null : Number(raw) }
  })
}

export function OverviewPage() {
  const { site } = useSite()
  const results = useQueries({
    queries: statsKinds.map((kind) => ({
      queryKey: keys.stats(site, kind, WINDOW),
      queryFn: () => ck.stats(site, kind, WINDOW),
      enabled: Boolean(site),
      // A 403 here means the operator lacks stats:read; the tile says so
      // rather than the whole page failing.
      retry: false,
    })),
  })

  if (!site) return <Page title="Overview"><NoSite /></Page>

  return (
    <Page title="Overview" description={`Daily UTC aggregates for ${site}, last 30 buckets.`}>
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
  const series = result?.data ? toSeries(result.data) : []
  const known = series.filter((point): point is { label: string; value: number } => point.value !== null)
  const total = known.reduce((sum, point) => sum + point.value, 0)
  const usage = usageStatsKinds.includes(kind)

  return (
    <Card>
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
        ) : known.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data in this window.</p>
        ) : (
          <>
            <div className="text-2xl font-semibold tabular-nums">{total.toLocaleString()}</div>
            <Sparkline points={series} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Deliberately an inline SVG rather than a charting dependency: one series,
 * thirty points, and a hard requirement that gaps stay gaps.
 */
function Sparkline({ points }: { points: Point[] }) {
  const values = points.map((point) => point.value).filter((value): value is number => value !== null)
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const step = 100 / Math.max(points.length - 1, 1)

  // Consecutive known points form a segment; a missing point ends it.
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
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-3 h-10 w-full" aria-hidden="true">
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
