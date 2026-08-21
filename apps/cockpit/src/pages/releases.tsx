import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { MoreHorizontal, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ck, type Release } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DataTable, firstPage, useTableView, type DataColumn } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { RelativeTime } from '@/components/ui/relative-time'
import { SkeletonText } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { StatusBadge, type StatusTone } from '@/forms/status-badge'
import { PreviewsCard } from '@/forms/platform/previews'
import { useI18n } from '@/lib/i18n-context'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'
import { compareText, compareTime } from '@/lib/table-view'

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

function isActivatable(release: Release) {
  return release.kind === 'release' && (release.status === 'ready' || release.status === 'superseded')
}

function isDeletable(release: Release) {
  return release.status !== 'active' && release.status !== 'building'
}

type Naming = Pick<ReturnType<typeof useI18n>, 't' | 'date'>

// Through the catalogue, not composed here: "Release" happens to be the word in
// both languages, which is how a hardcoded label survives unnoticed.
//
// The date goes through the catalogue's formatter for the same reason the word
// does. `toLocaleDateString()` with no argument asks the BROWSER what locale it
// is in, so a German console rendered "Release 12/17/2025" — the console's own
// language never entered into it.
function releaseName(release: Release, i18n: Naming) {
  return i18n.t('releases.name', { date: i18n.date(release.created_at) })
}

export function ReleasesPage() {
  const i18n = useI18n()
  const { t } = i18n
  const { site } = useSite()
  const can = useCan()
  const client = useQueryClient()
  const search = useSearch({ strict: false }) as { promotion_review?: string }
  const [reason, setReason] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | Release['status']>('all')
  const [page, setPage] = useState(firstPage)
  const fileCount = (count: number | null | undefined) => {
    if (count === null || count === undefined) return t('releases.fileCountUnknown')
    return count === 1 ? t('releases.fileCountOne') : t('releases.fileCountMany', { count })
  }

  const invalidate = () => client.invalidateQueries({ queryKey: keys.releases(site) })
  const build = useMutation({ mutationFn: () => ck.releases.create(site, { reason }), onSuccess: invalidate })
  const activate = useMutation({ mutationFn: (id: string) => ck.releases.activate(site, id), onSuccess: invalidate })
  const promote = useMutation({
    mutationFn: (binding: { release: string; manifest: string; review: string }) =>
      ck.releases.promote(site, binding.release, binding.manifest, binding.review),
    onSuccess: () => {
      void invalidate()
      void client.invalidateQueries({ queryKey: ['decisions', site] })
    },
  })
  const releases = useQuery({
    queryKey: keys.releases(site),
    queryFn: () => ck.releases.list(site),
    enabled: Boolean(site),
    refetchInterval: (result) =>
      (result.state.data ?? []).some((release) => release.status === 'building') || build.isPending ? 3000 : false,
  })
  const review = useQuery({
    queryKey: keys.promotionReview(site, search.promotion_review || ''),
    queryFn: () => ck.promotionReviews.get(site, search.promotion_review!),
    enabled: Boolean(site && search.promotion_review),
    retry: false,
  })

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (releases.data ?? []).filter(
      (release) =>
        (status === 'all' || release.status === status) &&
        (!needle || release.reason.toLowerCase().includes(needle) || release.id.toLowerCase().includes(needle)),
    )
  }, [releases.data, query, status])
  const availableStatuses = useMemo(
    () => [...new Set((releases.data ?? []).map((release) => release.status))],
    [releases.data],
  )

  const columns = useMemo<DataColumn<Release>[]>(
    () => [
      {
        id: 'release',
        label: t('releases.created'),
        required: true,
        kind: 'identity',
        priority: 'essential',
        compare: (left, right) => compareTime(left.created_at, right.created_at),
        cell: (release) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{releaseName(release, i18n)}</span>
            <span className="break-words text-xs text-muted-foreground">{release.reason || '—'}</span>
          </div>
        ),
      },
      {
        id: 'status',
        label: t('releases.status'),
        kind: 'status',
        priority: 'essential',
        compare: (left, right) => compareText(left.status, right.status),
        cell: (release) => <StatusBadge tone={TONE[release.status]}>{t(STATUS_KEYS[release.status])}</StatusBadge>,
      },
      {
        id: 'kind',
        label: t('releases.kind'),
        priority: 'supporting',
        compare: (left, right) => compareText(left.kind, right.kind),
        cell: (release) => t(release.kind === 'preview' ? 'releases.kind.preview' : 'releases.kind.release'),
      },
      {
        id: 'files',
        label: t('releases.files'),
        priority: 'detail',
        compare: (left, right) => Number(left.file_count ?? -1) - Number(right.file_count ?? -1),
        cell: (release) => fileCount(release.file_count),
      },
      {
        id: 'actions',
        label: t('common.actions'),
        headerHidden: true,
        required: true,
        kind: 'actions',
        priority: 'essential',
        cell: (release, rowIndex) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-testid={`release-row-${rowIndex}-actions`}
                variant="ghost"
                size="icon"
                aria-label={t('common.actions')}
              >
                <MoreHorizontal data-icon="inline-start" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {can('release:write') && isActivatable(release) ? (
                  <Confirm
                    title={t('releases.activateTitle')}
                    description={t('releases.activateDescription', { site })}
                    confirmLabel={t('releases.activate')}
                    onConfirm={() => activate.mutateAsync(release.id)}
                  >
                    {(open) => (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault()
                          open()
                        }}
                      >
                        {t('releases.activate')}
                      </DropdownMenuItem>
                    )}
                  </Confirm>
                ) : null}
                {can('release:write') && isDeletable(release) ? (
                  <Confirm
                    title={
                      release.kind === 'preview' ? t('releases.deletePreviewTitle') : t('releases.deleteReleaseTitle')
                    }
                    description={
                      release.kind === 'preview'
                        ? t('releases.deletePreviewDescription', { site })
                        : t('releases.deleteReleaseDescription', { site, status: t(STATUS_KEYS[release.status]) })
                    }
                    confirmLabel={t('releases.delete')}
                    destructive
                    onConfirm={async () => {
                      await ck.releases.remove(site, release.id)
                      await invalidate()
                    }}
                  >
                    {(open) => (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={(event) => {
                          event.preventDefault()
                          open()
                        }}
                      >
                        {t('releases.delete')}
                      </DropdownMenuItem>
                    )}
                  </Confirm>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [activate, can, site, t],
  )
  const table = useTableView('releases', columns)

  const building = (releases.data ?? []).filter((release) => release.status === 'building')
  const startedAt =
    building.reduce<string | null>(
      (oldest, release) =>
        oldest === null || Date.parse(release.created_at) < Date.parse(oldest) ? release.created_at : oldest,
      null,
    ) ?? (build.isPending ? build.submittedAt : null)
  const inFlight = Math.max(building.length, build.isPending ? 1 : 0)
  const active = (releases.data ?? []).find((release) => release.status === 'active')

  if (!site)
    return (
      <Page title={t('page.releases.title')}>
        <NoSite />
      </Page>
    )

  return (
    <Page
      title={t('page.releases.title')}
      description={t('releases.description')}
      actions={
        can('release:write') ? (
          <>
            <Input
              data-testid="release-reason"
              className="w-56"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t('releases.reasonPlaceholder')}
            />
            <Confirm
              title={t('releases.buildTitle')}
              description={t('releases.buildDescription', { site })}
              confirmLabel={t('releases.buildActivate')}
              onConfirm={() => build.mutateAsync()}
            >
              {(open) => (
                <Button data-testid="release-build" onClick={open} disabled={build.isPending}>
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

      {search.promotion_review ? (
        <Alert className="mb-4" data-testid="promotion-review">
          <AlertTitle>{t('releases.promotionReviewTitle')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            {review.isPending ? (
              <SkeletonText lines={4} data-testid="promotion-review-skeleton" />
            ) : review.error ? (
              review.error.message
            ) : review.data ? (
              <>
                <p>{t('releases.promotionConfirmContent', { count: review.data.changes.length })}</p>
                <ul data-testid="promotion-review-content" className="flex list-disc flex-col gap-1 pl-5">
                  {review.data.changes.map((change) => (
                    <li key={`${change.content_item_id}-${change.effect}`}>{change.title}</li>
                  ))}
                </ul>
                <p>{t('releases.promotionConfirmEffect', { site })}</p>
                <p>{t('releases.promotionNextStep')}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{review.data.status}</Badge>
                  <Badge variant="secondary">{review.data.manifest_sha256.slice(0, 12)}</Badge>
                </div>
                {review.data.status === 'pending' ? (
                  <Confirm
                    title={t('releases.promotionConfirmTitle')}
                    description={t('releases.promotionConfirmGuard')}
                    confirmLabel={t('releases.promote')}
                    onConfirm={() =>
                      promote.mutateAsync({
                        release: review.data.release_id,
                        manifest: review.data.manifest_sha256,
                        review: review.data.id,
                      })
                    }
                  >
                    {(open) => (
                      <Button
                        data-testid="promotion-review-activate"
                        variant="outline"
                        onClick={open}
                        disabled={promote.isPending}
                      >
                        {promote.isPending ? <Spinner data-icon="inline-start" /> : null}
                        {t('releases.promote')}
                      </Button>
                    )}
                  </Confirm>
                ) : null}
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {startedAt !== null ? (
        <Card size="sm" className="mb-4 max-w-md" data-testid="release-building">
          <CardContent>
            <Progress
              data-testid="release-build-progress"
              label={inFlight === 1 ? t('releases.buildingOne') : t('releases.buildingMany', { count: inFlight })}
              since={startedAt}
              valueLabel={<RelativeTime value={startedAt} data-testid="release-build-since" />}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{t('releases.elapsedDescription')}</p>
          </CardContent>
        </Card>
      ) : null}

      <PreviewsCard site={site} />

      <DataTable
        testId="release-list"
        columns={columns}
        rows={rows}
        rowKey={(release) => release.id}
        rowTestId="release-row"
        isLoading={releases.isPending}
        error={releases.error}
        onRetry={() => releases.refetch()}
        emptyMessage={t('releases.emptyDescription')}
        view={table.view}
        onViewChange={table.setView}
        page={page}
        onPageChange={setPage}
        unit={t('nav.releases')}
        toolbar={
          <>
            <Input
              data-testid="release-search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(firstPage)
              }}
              placeholder={t('releases.search')}
              className="max-w-xs"
            />
            <ToggleGroup
              className="max-w-full flex-wrap"
              type="single"
              value={status}
              onValueChange={(value) => {
                if (value) {
                  setStatus(value as typeof status)
                  setPage(firstPage)
                }
              }}
            >
              <ToggleGroupItem data-testid="release-status-all" value="all">
                {t('releases.filterAll')}
              </ToggleGroupItem>
              {availableStatuses.map((entry) => (
                <ToggleGroupItem data-testid={`release-status-${entry}`} key={entry} value={entry}>
                  {t(STATUS_KEYS[entry])}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              data-testid="release-reload"
              variant="ghost"
              size="icon"
              aria-label={t('releases.reload')}
              onClick={() => releases.refetch()}
              disabled={releases.isFetching}
            >
              <RefreshCw
                data-icon="inline-start"
                data-spinning={releases.isFetching}
                className="data-[spinning=true]:animate-spin"
              />
            </Button>
          </>
        }
        renderMobileRow={(release, rowIndex) => (
          <div className="flex items-start justify-between gap-3 p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-medium">{releaseName(release, i18n)}</span>
              <span className="break-words text-sm text-muted-foreground">{release.reason || '—'}</span>
              <RelativeTime value={release.created_at} data-testid={`release-mobile-${rowIndex}-age`} />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <StatusBadge tone={TONE[release.status]}>{t(STATUS_KEYS[release.status])}</StatusBadge>
              {columns.find((column) => column.id === 'actions')?.cell(release, rowIndex)}
            </div>
          </div>
        )}
      />
    </Page>
  )
}
