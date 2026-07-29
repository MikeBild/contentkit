import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { ck, type Release } from '@/api/ck'
import { Confirm } from '@/components/confirm'
import { Badge, Button, Input, TBody, TD, TH, THead, TR, Table, TableState } from '@/components/ui/primitives'
import { NoSite, Page } from '@/app/shell'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'
import { formatDate } from '@/lib/utils'

const TONE: Record<Release['status'], 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  active: 'success',
  ready: 'info',
  building: 'warning',
  preview: 'info',
  superseded: 'neutral',
  failed: 'danger',
}

export function ReleasesPage() {
  const { site } = useSite()
  const can = useCan()
  const client = useQueryClient()
  const [reason, setReason] = useState('')

  const releases = useQuery({
    queryKey: keys.releases(site),
    queryFn: () => ck.releases.list(site),
    enabled: Boolean(site),
    // A build is asynchronous; while one is in flight the list is the only
    // place its outcome shows up.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((release) => release.status === 'building') ? 3000 : false,
  })

  const invalidate = () => client.invalidateQueries({ queryKey: keys.releases(site) })
  const build = useMutation({ mutationFn: () => ck.releases.create(site, { reason }), onSuccess: invalidate })
  const activate = useMutation({
    mutationFn: (release: string) => ck.releases.activate(site, release),
    onSuccess: invalidate,
  })

  if (!site)
    return (
      <Page title="Releases">
        <NoSite />
      </Page>
    )

  const rows = releases.data ?? []
  const active = rows.find((release) => release.status === 'active')

  return (
    <Page
      title="Releases"
      description="A release is a complete, immutable build. Activation is a single atomic pointer swap, so rolling back is just activating an older one."
      actions={
        can('release:write') ? (
          <>
            <Input
              className="w-56"
              data-testid="release-reason"
              placeholder="Reason (optional)"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Confirm
              title="Build and activate a release?"
              description={
                <>
                  This builds every published revision of <strong>{site}</strong> and activates the result. The live
                  site changes as soon as the build succeeds.
                </>
              }
              confirmLabel="Build and activate"
              onConfirm={() => build.mutateAsync()}
            >
              {(open) => (
                <Button data-testid="release-build" onClick={open} disabled={build.isPending}>
                  {build.isPending ? 'Building…' : 'New release'}
                </Button>
              )}
            </Confirm>
          </>
        ) : null
      }
    >
      {active ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Live since {formatDate(active.activated_at)} · {active.file_count ?? 0} files
        </p>
      ) : null}

      <div className="rounded-xl border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>Status</TH>
              <TH>Kind</TH>
              <TH>Reason</TH>
              <TH>Revisions</TH>
              <TH>Files</TH>
              <TH>Completed</TH>
              <TH>
                <button
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  onClick={() => releases.refetch()}
                >
                  <RefreshCw className={releases.isFetching ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
                </button>
              </TH>
            </TR>
          </THead>
          <TBody>
            <TableState
              columns={7}
              isLoading={releases.isPending}
              error={releases.error}
              isEmpty={rows.length === 0}
              onRetry={() => releases.refetch()}
              emptyMessage="No releases yet. Build one to publish this site."
            >
              {rows.map((release) => (
                <TR key={release.id} data-testid="release-row" data-release={release.id}>
                  <TD>
                    <Badge tone={TONE[release.status]}>{release.status}</Badge>
                  </TD>
                  <TD className="text-muted-foreground">{release.kind}</TD>
                  <TD className="max-w-[18rem] truncate" title={release.reason ?? ''}>
                    {release.reason || '—'}
                  </TD>
                  <TD className="text-muted-foreground">{release.revision_ids?.length ?? 0}</TD>
                  <TD className="text-muted-foreground">{release.file_count ?? '—'}</TD>
                  <TD className="text-muted-foreground">{formatDate(release.completed_at)}</TD>
                  <TD>
                    {can('release:write') && release.status !== 'active' && release.status !== 'failed' ? (
                      <Confirm
                        title="Activate this release?"
                        description={
                          <>
                            The live site for <strong>{site}</strong> switches to this build immediately. Any newer
                            active release becomes superseded.
                          </>
                        }
                        confirmLabel="Activate"
                        onConfirm={() => activate.mutateAsync(release.id)}
                      >
                        {(open) => (
                          <Button data-testid="release-activate" size="sm" variant="outline" onClick={open}>
                            Activate
                          </Button>
                        )}
                      </Confirm>
                    ) : null}
                    {release.error ? <span className="text-xs text-chart-5">{release.error}</span> : null}
                  </TD>
                </TR>
              ))}
            </TableState>
          </TBody>
        </Table>
      </div>
    </Page>
  )
}
