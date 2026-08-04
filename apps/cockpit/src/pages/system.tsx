import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { ck } from '@/api/ck'
import { Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SkeletonFields } from '@/components/ui/skeleton'
import { StatusBadge } from '@/forms/status-badge'
import { keys } from '@/lib/query'
import { reportedCount } from '@/lib/reported'
import { useCan } from '@/lib/session'

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
  tone: 'success' | 'warning' | 'danger'
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
  const can = useCan()
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
    <Page title="System" description="Liveness, readiness and the two scheduled maintenance actions.">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Process</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <dl className="flex flex-col divide-y divide-border">
              <StatusReading
                testId="system-health"
                label="Liveness"
                value={health.isPending ? 'checking' : health.error ? 'unreachable' : 'ok'}
                tone={health.error ? 'danger' : 'success'}
                detail={health.error instanceof Error ? health.error.message : 'The process answers /health.'}
              />
              <StatusReading
                testId="system-readiness"
                label="Readiness"
                value={ready.isPending ? 'checking' : (readiness?.status ?? 'not ready')}
                tone={draining ? 'danger' : readiness?.status === 'ready' ? 'success' : 'warning'}
                detail={
                  draining
                    ? ready.error instanceof Error
                      ? ready.error.message
                      : 'Refusing traffic.'
                    : `Version ${readiness?.version ?? '—'}`
                }
              />
              {/* Green is a claim as much as the number is: a count nobody reported is
                  not a count known to be zero, so an unread row is the same "warning"
                  the Readiness row above it shows while it has no status. */}
              <StatusReading
                testId="system-builds"
                label="Release builds in flight"
                value={`${inflight ?? '—'}`}
                tone={inflight === null || inflight > 0 ? 'warning' : 'success'}
                detail="A restart waits for these to finish."
              />
              <StatusReading
                testId="system-decks"
                label="Deck renders"
                value={`${deckInflight ?? '—'} running`}
                tone={deckQueued === null || deckQueued > 0 ? 'warning' : 'success'}
                detail={`${deckQueued ?? '—'} queued`}
              />
            </dl>
          </CardContent>
        </Card>

        {can('release:write') ? (
          <Card>
            <CardHeader>
              <CardTitle>Maintenance</CardTitle>
              <CardDescription>
                Both of these normally run on a schedule. Trigger them by hand only when you know why.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Confirm
                title="Publish everything that is due?"
                description="Scheduled revisions across every site you may write to are published and their sites rebuilt. Live sites change."
                confirmLabel="Publish due"
                onConfirm={() => ck.releases.publishDue()}
              >
                {(open) => (
                  <Button data-testid="maintenance-publish-due" variant="outline" onClick={open}>
                    Publish due
                  </Button>
                )}
              </Confirm>
              <Confirm
                title="Collect old release objects?"
                description="Superseded release objects are deleted from storage and stuck builds are reaped. Active releases are never touched."
                confirmLabel="Run storage GC"
                destructive
                onConfirm={() => ck.releases.storageGc()}
              >
                {(open) => (
                  <Button data-testid="maintenance-storage-gc" variant="outline" onClick={open}>
                    Storage GC
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
              <CardTitle>Field gallery</CardTitle>
              <CardDescription>
                Every form field the console has, with live state. Not shown in a production build.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense
                fallback={
                  <SkeletonFields fields={6} label="Loading the field gallery…" data-testid="gallery-skeleton" />
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
