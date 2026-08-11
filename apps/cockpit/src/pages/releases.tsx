import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Fragment, useState } from 'react'
import { ck, type ContentItem, type Release } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { useI18n } from '@/lib/i18n-context'
import { Confirm } from '@/components/confirm'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge, type StatusTone } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { RelativeTime } from '@/components/ui/relative-time'
import { PreviewsCard } from '@/forms/platform/previews'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'

const TONE: Record<Release['status'], StatusTone> = {
  active: 'success',
  ready: 'info',
  building: 'warning',
  preview: 'info',
  superseded: 'neutral',
  failed: 'danger',
}
const STATUS_KEYS = {
  active: 'releases.status.active',
  ready: 'releases.status.ready',
  building: 'releases.status.building',
  preview: 'releases.status.preview',
  superseded: 'releases.status.superseded',
  failed: 'releases.status.failed',
} as const

/**
 * A preview is a build behind an invitation, not a candidate for the live site;
 * the server answers 404 for an attempt to activate one. Offering the button
 * anyway — which is what a check on `status` alone does — promises a rollback
 * target that does not exist.
 */
function isActivatable(release: Release) {
  return release.kind === 'release' && (release.status === 'ready' || release.status === 'superseded')
}

/** The active release is what the site is served out of, so it cannot be deleted. */
function isDeletable(release: Release) {
  return release.status !== 'active' && release.status !== 'building'
}

/**
 * What a build says it holds, or the fact that it said nothing.
 *
 * A build of zero files is an active release that serves nothing — which is how a
 * site once came to answer empty pages while every status in the console read
 * green. That makes 0 the state with an incident attached to it, and it is
 * exactly the value `?? 0` used to put here for a count the release never
 * reported. `liveStep` in lib/release-chain.ts calls an absent count 'unknown'
 * for that reason, and the Overview and this page must not disagree about one
 * release: an absent count reads as absent in both.
 */
export function ReleasesPage() {
  const { t, dateTime } = useI18n()
  const { site } = useSite()
  const can = useCan()
  const client = useQueryClient()
  const [reason, setReason] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const fileCount = (count: number | null | undefined) => {
    if (count === null || count === undefined) return t('releases.fileCountUnknown')
    return count === 1 ? t('releases.fileCountOne') : t('releases.fileCountMany', { count })
  }

  const invalidate = () => client.invalidateQueries({ queryKey: keys.releases(site) })
  const build = useMutation({ mutationFn: () => ck.releases.create(site, { reason }), onSuccess: invalidate })
  const activate = useMutation({
    mutationFn: (release: string) => ck.releases.activate(site, release),
    onSuccess: invalidate,
  })

  const releases = useQuery({
    queryKey: keys.releases(site),
    queryFn: () => ck.releases.list(site),
    enabled: Boolean(site),
    // A build is asynchronous; while one is in flight the list is the only
    // place its outcome shows up. The pending mutation counts too: the POST
    // blocks for the whole build, so without it the row that appears while this
    // operator waits would not be polled and the elapsed time would stand still.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((release) => release.status === 'building') || build.isPending ? 3000 : false,
  })
  const refreshing = releases.isFetching

  // Releases carry revision ids and nothing else; the authoring list is where
  // the titles live. One query resolves them for every expanded row.
  const content = useQuery({
    queryKey: keys.content.list(site),
    queryFn: () => ck.content.list(site),
    enabled: Boolean(site),
    staleTime: 60_000,
  })
  const items = (content.data ?? []) as ContentItem[]

  if (!site)
    return (
      <Page title={t('page.releases.title')}>
        <NoSite />
      </Page>
    )

  const rows = releases.data ?? []
  const active = rows.find((release) => release.status === 'active')

  /*
   * What is known about a build in progress, and nothing beyond it.
   *
   * `GET /v1/sites/{site}/releases` answers `id`, `kind`, `status`, `reason`,
   * `revision_ids`, `file_count`, `created_at`, `completed_at` and `activated_at`
   * — no step, no total, no percentage; `file_count` is written once, in the same
   * update that flips the status to `ready`. So a fraction does not exist to draw,
   * and a bar filling at a guessed rate on work measured at over a hundred seconds
   * would reach ninety per cent and sit there until the operator cancelled a build
   * that was fine.
   *
   * Two real facts are left: that it is running, and since when. `created_at` is
   * the server's own instant; a pending POST is this operator's own, which matters
   * because the request blocks for the whole build and the row is not visible
   * until the next poll brings it back.
   */
  const building = rows.filter((release) => release.status === 'building')
  const startedAt =
    building.reduce<string | null>(
      (oldest, release) =>
        oldest === null || Date.parse(release.created_at) < Date.parse(oldest) ? release.created_at : oldest,
      null,
    ) ?? (build.isPending ? build.submittedAt : null)
  const inFlight = Math.max(building.length, build.isPending ? 1 : 0)

  return (
    <Page
      title={t('page.releases.title')}
      description={t('releases.description')}
      actions={
        can('release:write') ? (
          <>
            <Input
              className="w-56"
              data-testid="release-reason"
              placeholder={t('releases.reasonPlaceholder')}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Confirm
              title={t('releases.buildTitle')}
              description={t('releases.buildDescription', { site })}
              confirmLabel={t('releases.buildActivate')}
              onConfirm={() => build.mutateAsync()}
            >
              {(open) => (
                <Button data-testid="release-build" onClick={open} disabled={build.isPending} aria-busy={build.isPending}>
                  {build.isPending ? <Spinner data-icon="inline-start" /> : null}
                  {t('releases.new')}
                </Button>
              )}
            </Confirm>
          </>
        ) : null
      }
    >
      {active ? (
        <p data-testid="release-active-summary" className="mb-3 text-sm text-muted-foreground">
          {t('releases.liveSince')}{' '}
          <RelativeTime value={active.activated_at} data-testid="release-active-since" className="inline" /> ·{' '}
          <span data-testid="release-active-files">{fileCount(active.file_count)}</span>
        </p>
      ) : null}

      {startedAt !== null ? (
        <Card size="sm" className="mb-3 max-w-md" data-testid="release-building">
          <CardContent>
            <Progress
              data-testid="release-build-progress"
              label={
                inFlight === 1 ? t('releases.buildingOne') : t('releases.buildingMany', { count: inFlight })
              }
              since={startedAt}
              // Spelled out for the test id alone: `release-build-since` is the
              // name a browser test already knows the elapsed time by, and
              // `Progress` would otherwise derive `-progress-value`. Same
              // component, same sentence, same instant.
              valueLabel={<RelativeTime value={startedAt} data-testid="release-build-since" />}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t('releases.elapsedDescription')}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <PreviewsCard site={site} />

      <Card className="py-0">
        <Table
          mobileLabels={[
            t('releases.status'),
            t('releases.kind'),
            t('releases.reason'),
            t('releases.revisions'),
            t('releases.files'),
            t('releases.completed'),
            '',
          ]}
        >
          <TableHeader>
            <TableRow>
              <TableHead>{t('releases.status')}</TableHead>
              <TableHead>{t('releases.kind')}</TableHead>
              <TableHead>{t('releases.reason')}</TableHead>
              <TableHead>{t('releases.revisions')}</TableHead>
              <TableHead>{t('releases.files')}</TableHead>
              <TableHead>{t('releases.completed')}</TableHead>
              <TableHead>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        data-testid="release-refresh"
                        aria-label={t('releases.reload')}
                        disabled={refreshing}
                        onClick={() => releases.refetch()}
                      >
                        <RefreshCw data-icon="inline-start" data-spinning={refreshing} className="data-[spinning=true]:animate-spin" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('releases.reload')}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState
              columns={7}
              isLoading={releases.isPending}
              error={releases.error}
              isEmpty={rows.length === 0}
              onRetry={() => releases.refetch()}
              emptyTitle={t('releases.empty')}
              emptyMessage={t('releases.emptyDescription')}
            >
              {rows.map((release) => {
                const open = expanded === release.id
                return (
                  <Fragment key={release.id}>
                    <TableRow data-testid="release-row" data-release={release.id}>
                      <TableCell>
                        <StatusBadge tone={TONE[release.status]}>{t(STATUS_KEYS[release.status])}</StatusBadge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t(release.kind === 'preview' ? 'releases.kind.preview' : 'releases.kind.release')}
                      </TableCell>
                      <TableCell className="max-w-[18rem] truncate">{release.reason || '—'}</TableCell>
                      {/*
                        0 is a claim of its own here — "this build is exactly the
                        published set", which is what the detail row spells out —
                        so an absent list does not get to borrow it, the same way
                        the Files column beside it refuses to.
                      */}
                      <TableCell className="tabular-nums text-muted-foreground">
                        {release.revision_ids?.length ?? '—'}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{release.file_count ?? '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {release.completed_at ? dateTime(release.completed_at) : '—'}
                      </TableCell>
                      {/*
                        Three acts, three grammars — the row this rule was
                        written for. `Details` reveals the row below and changes
                        nothing, so it is the console's disclosure: ghost, with
                        `aria-expanded` saying which state it is in. `Activate`
                        changes the live site, so it is a button. `Delete` cannot
                        be undone, so it is `destructive` — it used to be `ghost`,
                        which made an irreversible act and a disclosure the same
                        control to look at.
                      */}
                      <TableCell className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={open}
                          data-testid={`release-expand-${release.id}`}
                          onClick={() => setExpanded(open ? null : release.id)}
                        >
                          {open ? t('common.hide') : t('common.details')}
                        </Button>
                        {can('release:write') && isActivatable(release) ? (
                          <Confirm
                            title={t('releases.activateTitle')}
                            description={t('releases.activateDescription', { site })}
                            confirmLabel={t('releases.activate')}
                            onConfirm={() => activate.mutateAsync(release.id)}
                          >
                            {(openDialog) => (
                              <Button
                                data-testid={`release-activate-${release.id}`}
                                size="sm"
                                variant="outline"
                                onClick={openDialog}
                              >
                                {t('releases.activate')}
                              </Button>
                            )}
                          </Confirm>
                        ) : null}
                        {can('release:write') && isDeletable(release) ? (
                          <Confirm
                            title={
                              release.kind === 'preview'
                                ? t('releases.deletePreviewTitle')
                                : t('releases.deleteReleaseTitle')
                            }
                            description={
                              release.kind === 'preview'
                                ? t('releases.deletePreviewDescription', { site })
                                : t('releases.deleteReleaseDescription', {
                                    site,
                                    status: t(STATUS_KEYS[release.status]),
                                  })
                            }
                            confirmLabel={t('releases.delete')}
                            destructive
                            onConfirm={async () => {
                              await ck.releases.remove(site, release.id)
                              await invalidate()
                            }}
                          >
                            {(openDialog) => (
                              <Button
                                data-testid={`release-delete-${release.id}`}
                                size="sm"
                                variant="destructive"
                                onClick={openDialog}
                              >
                                {t('releases.delete')}
                              </Button>
                            )}
                          </Confirm>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {open ? (
                      <TableRow data-testid={`release-detail-${release.id}`}>
                        <TableCell colSpan={7} className="bg-muted/40">
                          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                            <dt className="text-muted-foreground">{t('releases.created')}</dt>
                            <dd>{dateTime(release.created_at)}</dd>
                            <dt className="text-muted-foreground">{t('releases.activated')}</dt>
                            <dd>{release.activated_at ? dateTime(release.activated_at) : '—'}</dd>
                            <dt className="text-muted-foreground">{t('releases.files')}</dt>
                            <dd className="tabular-nums">{release.file_count ?? '—'}</dd>
                            {/*
                              Drawn when a reason arrives and never faked when one
                              does not: `listReleases` in src/repository.mjs
                              projects nine fields and `error` is not among them,
                              so today this row does not appear on a failed build.
                              The declared `Release` schema does carry `error`;
                              until the projection sends it, "the last build
                              failed" is the whole of what this console knows.
                            */}
                            {release.error ? (
                              <>
                                <dt className="text-muted-foreground">{t('releases.error')}</dt>
                                <dd className="whitespace-pre-wrap break-words text-destructive">{release.error}</dd>
                              </>
                            ) : null}
                            <dt className="text-muted-foreground">{t('releases.overlaidRevisions')}</dt>
                            <dd>
                              {release.revision_ids?.length ? (
                                <ul className="flex flex-col gap-0.5">
                                  {release.revision_ids.map((revisionId) => (
                                    <li key={revisionId} className="font-mono">
                                      {/*
                                        The list carries no revision→item mapping,
                                        so a title is shown when the content list
                                        happens to name the same slug and the id
                                        otherwise. An id is a poor label, but a
                                        wrong title would be worse.
                                      */}
                                      {items.find((item) => item.published_revision_id === revisionId)?.title ??
                                        t('common.unavailableDocument')}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-muted-foreground">{t('releases.noRevisions')}</span>
                              )}
                            </dd>
                          </dl>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableState>
          </TableBody>
        </Table>
      </Card>
    </Page>
  )
}
