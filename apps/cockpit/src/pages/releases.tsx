import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { Fragment, useState } from 'react'
import { ck, type ContentItem, type Release } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import { Badge, Button, Input, TBody, TD, TH, THead, TR, Table, TableState } from '@/components/ui/primitives'
import { PreviewsCard } from '@/forms/platform/previews'
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

export function ReleasesPage() {
  const { site } = useSite()
  const can = useCan()
  const client = useQueryClient()
  const [reason, setReason] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const releases = useQuery({
    queryKey: keys.releases(site),
    queryFn: () => ck.releases.list(site),
    enabled: Boolean(site),
    // A build is asynchronous; while one is in flight the list is the only
    // place its outcome shows up.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((release) => release.status === 'building') ? 3000 : false,
  })

  // Releases carry revision ids and nothing else; the authoring list is where
  // the titles live. One query resolves them for every expanded row.
  const content = useQuery({
    queryKey: keys.content.list(site),
    queryFn: () => ck.content.list(site),
    enabled: Boolean(site),
    staleTime: 60_000,
  })
  const items = (content.data ?? []) as ContentItem[]

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

      <PreviewsCard site={site} />

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
                  data-testid="release-refresh"
                  aria-label="Reload releases"
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
              {rows.map((release) => {
                const open = expanded === release.id
                return (
                  <Fragment key={release.id}>
                    <TR data-testid="release-row" data-release={release.id}>
                      <TD>
                        <Badge tone={TONE[release.status]}>{release.status}</Badge>
                      </TD>
                      <TD className="text-muted-foreground">{release.kind}</TD>
                      <TD className="max-w-[18rem] truncate">{release.reason || '—'}</TD>
                      <TD className="tabular-nums text-muted-foreground">{release.revision_ids?.length ?? 0}</TD>
                      <TD className="tabular-nums text-muted-foreground">{release.file_count ?? '—'}</TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{formatDate(release.completed_at)}</TD>
                      <TD className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={open}
                          data-testid={`release-expand-${release.id}`}
                          onClick={() => setExpanded(open ? null : release.id)}
                        >
                          {open ? 'Hide' : 'Details'}
                        </Button>
                        {can('release:write') && isActivatable(release) ? (
                          <Confirm
                            title="Activate this release?"
                            description={
                              <>
                                The live site for <strong>{site}</strong> switches to this build immediately. The
                                release currently active becomes superseded.
                              </>
                            }
                            confirmLabel="Activate"
                            onConfirm={() => activate.mutateAsync(release.id)}
                          >
                            {(openDialog) => (
                              <Button
                                data-testid={`release-activate-${release.id}`}
                                size="sm"
                                variant="outline"
                                onClick={openDialog}
                              >
                                Activate
                              </Button>
                            )}
                          </Confirm>
                        ) : null}
                        {can('release:write') && isDeletable(release) ? (
                          <Confirm
                            title={release.kind === 'preview' ? 'Delete this preview?' : 'Delete this release?'}
                            description={
                              release.kind === 'preview' ? (
                                <>
                                  The preview build for <strong>{site}</strong> and its storage objects are deleted, and
                                  its invitation and preview links stop working immediately. The content itself is
                                  untouched.
                                </>
                              ) : (
                                <>
                                  This {release.status} release of <strong>{site}</strong> and its storage objects are
                                  deleted, and with them the option of rolling back to it. The published content is
                                  untouched — a release is a rendered snapshot, not the source.
                                </>
                              )
                            }
                            confirmLabel="Delete"
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
                                variant="ghost"
                                onClick={openDialog}
                              >
                                Delete
                              </Button>
                            )}
                          </Confirm>
                        ) : null}
                      </TD>
                    </TR>
                    {open ? (
                      <TR data-testid={`release-detail-${release.id}`}>
                        <TD colSpan={7} className="bg-muted/40">
                          <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[10rem_1fr]">
                            <dt className="text-muted-foreground">Release id</dt>
                            <dd className="font-mono">{release.id}</dd>
                            <dt className="text-muted-foreground">Created</dt>
                            <dd>{formatDate(release.created_at)}</dd>
                            <dt className="text-muted-foreground">Activated</dt>
                            <dd>{release.activated_at ? formatDate(release.activated_at) : '—'}</dd>
                            <dt className="text-muted-foreground">Files</dt>
                            <dd className="tabular-nums">{release.file_count ?? '—'}</dd>
                            {release.error ? (
                              <>
                                <dt className="text-muted-foreground">Error</dt>
                                <dd className="whitespace-pre-wrap break-words text-chart-5">{release.error}</dd>
                              </>
                            ) : null}
                            <dt className="text-muted-foreground">Overlaid revisions</dt>
                            <dd>
                              {release.revision_ids?.length ? (
                                <ul className="space-y-0.5">
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
                                        revisionId}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-muted-foreground">
                                  None — this build is exactly the published set.
                                </span>
                              )}
                            </dd>
                          </dl>
                        </TD>
                      </TR>
                    ) : null}
                  </Fragment>
                )
              })}
            </TableState>
          </TBody>
        </Table>
      </div>
    </Page>
  )
}
