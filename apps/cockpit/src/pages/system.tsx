import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { ck } from '@/api/ck'
import { useNow } from '@/hooks/use-now'
import { Page } from '@/app/shell'
import { useI18n } from '@/lib/i18n-context'
import { Confirm } from '@/components/confirm'
import { StatisticsSection, useStatTiles } from '@/components/statistics'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonFields } from '@/components/ui/skeleton'
import { StatusBadge } from '@/forms/status-badge'
import { keys } from '@/lib/query'
import { reportedCount } from '@/lib/reported'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'

const STATS_WINDOW = { bucket: 'day', tz: 'UTC' } as const

function usageValue(payload: unknown, name: string): number | null {
  const metric = (
    payload as { totals?: { metrics?: Record<string, { value?: number | null; value_state?: string }> }[] }
  )?.totals?.[0]?.metrics?.[name]
  return !metric || metric.value_state === 'missing' || typeof metric.value !== 'number' ? null : metric.value
}

const FieldGallery = lazy(() => import('@/forms/gallery').then((module) => ({ default: module.FieldGallery })))

/**
 * One reading of the process: a label, a state and the sentence behind it.
 *
 * These were four `Card`s in a four-column grid, each holding a label, a badge
 * and one sentence — the "nine equally weighted boxes" defect at a quarter
 * scale. A card is not a container for one sentence, and four of them said no
 * more than four rows do while claiming four times the weight and, below 640px,
 * four times the scroll. The props are unchanged, so what a tile means is still
 * decided in one place and asserted by name.
 */
function StatusReading({
  label,
  value,
  tone,
  detail,
  testId,
}: {
  label: string
  value: string
  // `neutral` is here because not every reading is a verdict. StatusBadge has
  // always supported it; this wrapper narrowed it away, which forced any new row
  // to claim good news or bad news. Uptime has neither: three minutes is
  // alarming after a quiet week and unremarkable during a deploy, and only the
  // operator knows which one this is. A reading dressed in green that means
  // nothing is the failure this console's own rules are about.
  tone: 'success' | 'warning' | 'danger' | 'neutral'
  detail?: ReactNode
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 px-(--card-spacing) py-2.5 sm:grid-cols-[11rem_7rem_1fr]"
    >
      <dt className="text-sm">{label}</dt>
      <dd className="justify-self-end sm:justify-self-start">
        <StatusBadge tone={tone}>{value}</StatusBadge>
      </dd>
      {detail ? <dd className="col-span-2 text-xs text-muted-foreground sm:col-span-1">{detail}</dd> : null}
    </div>
  )
}

export function SystemPage() {
  const { t, dateTime, number } = useI18n()
  const can = useCan()
  const { site } = useSite()
  const health = useQuery({
    queryKey: [...keys.system, 'health'],
    queryFn: () => ck.system.health(),
    refetchInterval: 15_000,
    retry: false,
  })
  const ready = useQuery({
    queryKey: [...keys.system, 'ready'],
    queryFn: () => ck.system.ready(),
    refetchInterval: 15_000,
    retry: false,
  })
  const descriptor = useQuery({
    queryKey: [...keys.system, 'descriptor'],
    queryFn: () => ck.system.descriptor(),
    refetchInterval: 15_000,
    retry: false,
  })
  const http = useQuery({
    queryKey: keys.stats(site, 'http', STATS_WINDOW),
    queryFn: () => ck.stats(site, 'http', STATS_WINDOW),
    enabled: Boolean(site) && can('stats:read'),
    retry: false,
  })
  const mcp = useQuery({
    queryKey: keys.stats(site, 'mcp', STATS_WINDOW),
    queryFn: () => ck.stats(site, 'mcp', STATS_WINDOW),
    enabled: Boolean(site) && can('stats:read'),
    retry: false,
  })
  const stats = useStatTiles(site)
  const now = useNow()

  // /ready answers 503 while draining, which the client turns into an error —
  // so "no data" here is itself the status, not a missing reading.
  const readiness = ready.data
  const draining = Boolean(ready.error)
  // `readiness` is undefined until /ready answers and again whenever it answers
  // 503, and both deck counters are optional in ReadinessReport even when it does
  // answer. So these are three separate readings a tile may not have, and none of
  // them is zero — see lib/reported.ts.
  const inflight = reportedCount(readiness?.inflight)
  const deckInflight = reportedCount(readiness?.deck_inflight)
  const deckQueued = reportedCount(readiness?.deck_queued)

  return (
    <Page title={t('page.system.title')} description={t('page.system.description')}>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('system.process')}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <dl className="flex flex-col divide-y divide-border">
              <StatusReading
                testId="system-health"
                label={t('system.liveness')}
                value={
                  health.isPending ? t('system.checking') : health.error ? t('system.unreachable') : t('system.ok')
                }
                tone={health.error ? 'danger' : 'success'}
                detail={health.error instanceof Error ? health.error.message : t('system.healthDetail')}
              />
              <StatusReading
                testId="system-readiness"
                label={t('system.readiness')}
                value={
                  ready.isPending
                    ? t('system.checking')
                    : readiness?.status === 'ready'
                      ? t('system.ready')
                      : t('system.notReady')
                }
                tone={draining ? 'danger' : readiness?.status === 'ready' ? 'success' : 'warning'}
                detail={
                  draining
                    ? ready.error instanceof Error
                      ? ready.error.message
                      : t('system.refusingTraffic')
                    : t('system.version', { version: readiness?.version ?? '—' })
                }
              />
              {/*
                Labelled by what it MEASURES rather than by the field it reads.
                The server reports an instant; the number here is a duration, and
                the duration is the operationally interesting half — a value that
                reset is a process that restarted, and a restart nobody ordered is
                the first thing worth knowing about an installation. The absolute
                instant stays in the detail line, where it answers "when" once
                somebody cares.

                Tone stays neutral on purpose. There is no uptime that is good
                news or bad news on its own: three minutes is alarming after a
                quiet week and unremarkable during a deploy, and only the
                operator knows which one this is.
              */}
              <StatusReading
                testId="system-uptime"
                label={t('system.uptime')}
                value={
                  descriptor.isPending
                    ? t('system.checking')
                    : uptime(descriptor.data?.started_at ?? null, now, {
                        day: t('system.dayShort'),
                        hour: t('system.hourShort'),
                        minute: t('system.minuteShort'),
                        second: t('system.secondShort'),
                      })
                }
                tone="neutral"
                detail={
                  descriptor.data?.started_at
                    ? t('system.since', { date: dateTime(descriptor.data.started_at) })
                    : t('system.noStartTime')
                }
              />
              {/* Green is a claim as much as the number is: a count nobody reported is
                  not a count known to be zero, so an unread row is the same "warning"
                  the Readiness row above it shows while it has no status. */}
              <StatusReading
                testId="system-builds"
                label={t('system.builds')}
                value={inflight === null ? '—' : number(inflight)}
                tone={inflight === null || inflight > 0 ? 'warning' : 'success'}
                detail={t('system.buildsDetail')}
              />
              <StatusReading
                testId="system-decks"
                label={t('system.deckRenders')}
                value={t('system.running', { count: deckInflight === null ? '—' : number(deckInflight) })}
                tone={deckQueued === null || deckQueued > 0 ? 'warning' : 'success'}
                detail={t('system.queued', { count: deckQueued === null ? '—' : number(deckQueued) })}
              />
            </dl>
            {site && can('stats:read') ? (
              <div data-testid="system-traffic" className="mt-3 border-t border-border pt-3">
                <div className="px-(--card-spacing) pb-2">
                  <h3 className="font-medium">{t('system.traffic')}</h3>
                  <p className="text-xs text-muted-foreground">{t('system.trafficDescription')}</p>
                </div>
                <dl className="flex flex-col divide-y divide-border">
                  {(['http', 'mcp'] as const).map((surface) => {
                    const result = surface === 'http' ? http : mcp
                    const calls = usageValue(result.data, 'calls')
                    const p95 = usageValue(result.data, 'duration_ms_p95')
                    return (
                      <div
                        key={surface}
                        className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 px-(--card-spacing) py-2.5 text-sm"
                      >
                        <dt className="font-medium">{surface === 'http' ? 'HTTP' : 'MCP'}</dt>
                        <dd className="text-muted-foreground">
                          {t('system.calls', { count: calls === null ? '—' : number(calls) })}
                        </dd>
                        <dd className="text-muted-foreground">
                          {t('system.p95', { value: p95 === null ? '—' : number(p95) })}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/*
          §1: "Betriebsmetriken (HTTP, p95, Calls) wohnen unter Installation →
          System, nie auf dem Startscreen." The eight product statistics carried
          durations and success ratios on the Overview, which is the same class
          of number under a different name, so they live here now. The Overview
          keeps only the §4 sentence about how many of them have nothing to
          show — a measurement, and the one statistic a first screen earns.
        */}
        {site && can('stats:read') ? <StatisticsSection stats={stats} /> : null}

        {can('release:write') ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('system.maintenance')}</CardTitle>
              <CardDescription>{t('system.maintenanceDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Confirm
                title={t('system.publishDueTitle')}
                description={t('system.publishDueDescription')}
                confirmLabel={t('system.publishDue')}
                onConfirm={() => ck.releases.publishDue()}
              >
                {(open) => (
                  <Button data-testid="maintenance-publish-due" variant="outline" onClick={open}>
                    {t('system.publishDue')}
                  </Button>
                )}
              </Confirm>
              <Confirm
                title={t('system.storageGcTitle')}
                description={t('system.storageGcDescription')}
                confirmLabel={t('system.storageGc')}
                destructive
                onConfirm={() => ck.releases.storageGc()}
              >
                {(open) => (
                  <Button data-testid="maintenance-storage-gc" variant="destructive" onClick={open}>
                    {t('system.storageGc')}
                  </Button>
                )}
              </Confirm>
            </CardContent>
          </Card>
        ) : null}

        {/* The field inventory, rendered once each. Dev build only — it is a
            drawing board, not an operator surface, and the dynamic import keeps
            it out of everything the production bundle actually loads. */}
        {import.meta.env.DEV ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('system.fieldGallery')}</CardTitle>
              <CardDescription>{t('system.fieldGalleryDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense
                fallback={
                  <SkeletonFields fields={6} label={t('system.fieldGalleryLoading')} data-testid="gallery-skeleton" />
                }
              >
                <FieldGallery />
              </Suspense>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </Page>
  )
}

/**
 * `3d 4h`, `4h 12m`, `38m`, `9s` — and `—` when nothing was reported.
 *
 * Absent is never "0s". A zero would say the process just started, which is a
 * measurement; not knowing is a different fact and reads differently.
 */
function uptime(
  startedAt: string | null,
  now: number,
  units: { day: string; hour: string; minute: string; second: string },
): string {
  if (!startedAt) return '—'
  const elapsed = now - new Date(startedAt).getTime()
  if (Number.isNaN(elapsed) || elapsed < 0) return '—'
  const seconds = Math.floor(elapsed / 1000)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}${units.day} ${hours}${units.hour}`
  if (hours > 0) return `${hours}${units.hour} ${minutes}${units.minute}`
  if (minutes > 0) return `${minutes}${units.minute}`
  return `${seconds}${units.second}`
}
