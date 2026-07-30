import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ck, type ContentItem, type ContentKind, type Revision } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import { DataTable, firstPage, useTableView, type DataColumn } from '@/components/ui/data-table'
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableState,
} from '@/components/ui/primitives'
import { RelativeTime } from '@/components/ui/relative-time'
import { SkeletonFields, SkeletonText } from '@/components/ui/skeleton'
import { Tabs, TabPanel } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { ContentHtml, useContentScheme } from '@/content/lazy'
import { ContentEditor } from '@/forms/content/editor'
import { Revisions } from '@/forms/content/revisions'
import { siteSettingsContract } from '@/forms/site/contract'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'
import { compareText, compareTime, encodeSort } from '@/lib/table-view'

const KINDS: ContentKind[] = ['page', 'post', 'project', 'deck']

const TEMPLATE = `---
title: New article
kind: post
locale: en
summary: One sentence that says what this is.
---

Write the article here.
`

/**
 * What to call a row.
 *
 * Title lives on the newest revision; an item whose revision carries none is
 * identified by its translation_key, which is the only thing that is never
 * missing. Sorting and every confirmation dialog use this same answer, so a
 * document cannot be listed under one name and destroyed under another.
 */
function name(item: ContentItem): string {
  return item.title || item.translation_key
}

/**
 * The authoring list.
 *
 * `GET /v1/sites/{site}/content` answers a bare array: no `limit`, no `cursor`,
 * no `order`. Two consequences, both visible in this file.
 *
 * The window is the console's own, over a result it holds completely — which is
 * why the pager may print a total (the server sent every row, so counting them
 * is reading, not guessing) and why the header sorts are honest: they reorder all
 * of the items before the window is taken, not the twenty-five inside it. Both
 * facts are `paging`, which this file deliberately does not pass: `'whole'` is the
 * default of `DataTable` and of `useTableView`, and taking that default is how the
 * page claims it. The claim is not on trust — test/unit/cockpit-lists.test.mjs
 * reads docs/openapi.json, and the moment `contentList` grows a `cursor` or a
 * `limit` it demands `paging="cursor"` here, which withdraws every client-side
 * sort rather than leaving the controls lying.
 *
 * The order the endpoint does impose is `created_at` descending — a field the list
 * did not use to show at all, so "newest first" named a column that was not
 * there. `Created` is now a column, hidden by default: the default order is at
 * least expressible, and the operator can look at it without a second request.
 */
export function ContentPage() {
  const { site } = useSite()
  const can = useCan()
  const client = useQueryClient()
  const [kind, setKind] = useState<'' | ContentKind>('')
  const [locale, setLocale] = useState('')
  const [open, setOpen] = useState<{ itemId: string | null } | null>(null)

  const query = { ...(kind ? { kind } : {}), ...(locale ? { locale } : {}) }
  const items = useQuery({
    queryKey: keys.content.list(site, query),
    queryFn: () => ck.content.list(site, query as never),
    enabled: Boolean(site),
  })

  const columns = useMemo<DataColumn<ContentItem>[]>(
    () => [
      {
        id: 'title',
        label: 'Title',
        // The only field that says which document a row is, and the row's
        // heading for a screen reader. It cannot be put away.
        required: true,
        compare: (left, right) => compareText(name(left), name(right)),
        className: 'max-w-[22rem] truncate font-medium',
        cell: (item) => name(item),
      },
      {
        id: 'kind',
        label: 'Kind',
        compare: (left, right) => compareText(left.kind, right.kind),
        className: 'text-muted-foreground',
        cell: (item) => item.kind,
      },
      {
        id: 'locale',
        label: 'Locale',
        compare: (left, right) => compareText(left.locale, right.locale),
        className: 'text-muted-foreground',
        cell: (item) => item.locale,
      },
      {
        id: 'slug',
        label: 'Slug',
        compare: (left, right) => compareText(left.slug, right.slug),
        className: 'text-muted-foreground',
        cell: (item) => item.slug || '—',
      },
      {
        id: 'live',
        label: 'Live',
        // Deliberately not comparable. The cell is two independent facts —
        // whether the item is published, and whether newer work is waiting — and
        // an invented rank over the pair would order the list by something no
        // column shows. "Which documents have unreleased work" is a filter the
        // API can answer; it is not a direction.
        className: 'space-x-1 whitespace-nowrap',
        cell: (item) => (
          <>
            {item.published_revision_id ? <Badge tone="success">published</Badge> : <Badge>draft only</Badge>}
            {/* A published item whose newest revision is still a draft
                has unreleased work — the single most useful thing to
                see in an authoring list. */}
            {item.published_revision_id && item.latest_revision_status === 'draft' ? (
              <Badge tone="warning">newer draft</Badge>
            ) : null}
          </>
        ),
      },
      {
        id: 'updated',
        label: 'Updated',
        compare: (left, right) => compareTime(left.updated_at, right.updated_at),
        descFirst: true,
        className: 'text-muted-foreground',
        // "vor 2 Stunden" is what the operator reads; the instant is in `title`
        // and in `<time datetime>`, because deciding whether an edit landed
        // before or after a release needs the timestamp, not a rounding of it.
        cell: (item) => <RelativeTime value={item.updated_at} data-testid="content-updated" />,
      },
      {
        id: 'created',
        label: 'Created',
        compare: (left, right) => compareTime(left.created_at, right.created_at),
        descFirst: true,
        // The endpoint's own order. Off by default because it is the same for
        // every row on a normal day; available because it is the answer to "why
        // is the list in this order".
        hiddenByDefault: true,
        className: 'text-muted-foreground',
        cell: (item) => <RelativeTime value={item.created_at} data-testid="content-created" />,
      },
      {
        id: 'actions',
        label: 'Row actions',
        required: true,
        headerHidden: true,
        className: 'flex gap-2',
        cell: (item) => (
          <>
            <Button
              data-testid="content-open"
              size="sm"
              variant="outline"
              onClick={() => setOpen({ itemId: item.id })}
            >
              {can('content:write') ? 'Edit' : 'Inspect'}
            </Button>
            {can('content:write') && !item.published_revision_id ? (
              <Confirm
                title="Discard this draft?"
                description={
                  <>
                    <strong>{name(item)}</strong> and every one of its revisions are removed. It was never published,
                    so nothing on the live site changes. This cannot be undone.
                  </>
                }
                confirmLabel="Discard draft"
                destructive
                onConfirm={async () => {
                  await ck.content.deleteDraft(item.id)
                  await client.invalidateQueries({ queryKey: keys.content.list(site, query) })
                }}
              >
                {(openConfirm) => (
                  <Button data-testid="content-discard" size="sm" variant="ghost" onClick={openConfirm}>
                    Discard
                  </Button>
                )}
              </Confirm>
            ) : null}
            {can('release:write') && item.published_revision_id ? (
              <Confirm
                title="Remove from the live site?"
                description={
                  <>
                    <strong>{name(item)}</strong> stops being served after the next release. Its revisions are kept.
                  </>
                }
                confirmLabel="Unpublish"
                destructive
                onConfirm={async () => {
                  await ck.content.unpublish(item.id)
                  await client.invalidateQueries({ queryKey: keys.content.list(site, query) })
                }}
              >
                {(openConfirm) => (
                  <Button data-testid="content-unpublish" size="sm" variant="ghost" onClick={openConfirm}>
                    Unpublish
                  </Button>
                )}
              </Confirm>
            ) : null}
          </>
        ),
      },
    ],
    // `query` is rebuilt every render; the two filters it is made of are the
    // dependency that actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, client, site, kind, locale],
  )

  const { view, setView } = useTableView('content', columns)
  const [page, setPage] = useState(firstPage)

  // A cursor names a position in one particular result. Another site, a new
  // filter or a new order is a different result, so the walk starts over rather
  // than resuming three windows into a list that no longer has three windows.
  //
  // The site is in here because switching it does not remount this page: the
  // switcher only rewrites `?site=`, so `page` would survive into a workspace the
  // operator has just opened and print "Page 3" over its first rows.
  //
  // The sort dependency is the encoded sort, not the object: `useCan` hands out a
  // new function every render, so every derived value here is a new identity every
  // render, and an object dependency would reset the walk on the render after
  // every click on Next.
  const order = encodeSort(view.sort) ?? ''
  useEffect(() => setPage(firstPage), [site, kind, locale, order])

  if (!site)
    return (
      <Page title="Content">
        <NoSite />
      </Page>
    )

  if (open) {
    return (
      <ContentDetail
        site={site}
        itemId={open.itemId}
        // Every item, deliberately — not the window on screen. The editor derives
        // the sibling slugs a translation may point at and the locales it may be
        // written in from this, and a list that only knew page 3 would offer the
        // author a subset of their own site.
        allItems={items.data ?? []}
        onClose={async () => {
          setOpen(null)
          await client.invalidateQueries({ queryKey: keys.content.list(site, query) })
        }}
        onCreated={(itemId) => setOpen({ itemId })}
      />
    )
  }

  const rows = items.data ?? []

  return (
    <Page
      title="Content"
      description="Revisions are immutable. Creating or editing writes a new draft revision; nothing reaches the live site until a release is built and activated."
      actions={
        can('content:write') ? (
          <Button data-testid="content-new" onClick={() => setOpen({ itemId: null })}>
            New content
          </Button>
        ) : null
      }
    >
      <DataTable
        testId="content"
        columns={columns}
        rows={rows}
        rowKey={(item) => item.id}
        rowTestId="content-row"
        rowAttributes={(item) => ({ 'data-item': item.id })}
        isLoading={items.isPending}
        error={items.error}
        onRetry={() => items.refetch()}
        emptyMessage="No content items match this filter."
        view={view}
        onViewChange={setView}
        page={page}
        onPageChange={setPage}
        toolbar={
          <>
            <Select
              data-testid="content-kind-filter"
              value={kind}
              onChange={(event) => setKind(event.target.value as ContentKind | '')}
            >
              <option value="">All kinds</option>
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Input
              className="w-40"
              data-testid="content-locale-filter"
              placeholder="locale"
              value={locale}
              onChange={(event) => setLocale(event.target.value.trim())}
            />
          </>
        }
      />
    </Page>
  )
}

type DetailTab = 'editor' | 'revisions' | 'audio' | 'live'

/**
 * One document, in the four states it can be looked at in.
 *
 * The source of truth is the newest revision's Markdown — not the item row,
 * which only carries the fields the ingest lifted out of it. The editor is
 * therefore seeded from `revisions[0].markdown`, and "restore an older
 * revision" is the same seed with a different row.
 */
function ContentDetail({
  site,
  itemId,
  allItems,
  onClose,
  onCreated,
}: {
  site: string
  /** `null` while creating: there is no item until the first save. */
  itemId: string | null
  allItems: readonly ContentItem[]
  onClose: () => void
  onCreated: (itemId: string) => void
}) {
  const can = useCan()
  const client = useQueryClient()
  const { current } = useSite()
  const [tab, setTab] = useState<DetailTab>('editor')
  // A restored revision is an unsaved draft in the editor, so the seed has to
  // survive a refetch of the list it did not come from.
  const [restored, setRestored] = useState<Revision | null>(null)

  const item = useQuery({
    queryKey: ['content', 'item', itemId],
    queryFn: () => ck.content.get(itemId!),
    enabled: Boolean(itemId),
  })
  const revisions = useQuery({
    queryKey: keys.content.revisions(itemId ?? ''),
    queryFn: () => ck.content.revisions(itemId!),
    enabled: Boolean(itemId),
  })
  const groups = useQuery({
    queryKey: keys.access.groups(site),
    queryFn: () => ck.access.groups(site),
    enabled: can('access:admin'),
  })

  // The site's own configuration, read through the settings contract rather
  // than re-derived: the pickers must offer exactly what the settings editor
  // wrote, or a document names a version the release does not know.
  const settings = useMemo(
    () =>
      siteSettingsContract.detect(
        current
          ? {
              name: current.name,
              description: current.description ?? '',
              base_url: current.base_url,
              default_locale: current.default_locale,
              settings: current.settings,
            }
          : undefined,
      ).settings,
    [current],
  )

  const source = restored?.markdown ?? revisions.data?.[0]?.markdown ?? (itemId ? '' : TEMPLATE)
  const loading = Boolean(itemId) && (item.isPending || revisions.isPending)
  const failure = item.error ?? revisions.error

  const siblings = useMemo(
    () =>
      allItems
        .filter((entry) => entry.id !== itemId && entry.slug)
        .map((entry) => entry.slug!)
        .filter(Boolean),
    [allItems, itemId],
  )
  const locales = useMemo(
    () => [...new Set([current?.default_locale, ...allItems.map((entry) => entry.locale)].filter(Boolean) as string[])],
    [allItems, current],
  )

  const title = item.data?.title || item.data?.translation_key || (itemId ? 'Content' : 'New content')

  return (
    <Page
      title={title}
      description={item.data ? `${item.data.kind} · ${item.data.locale}` : 'A new draft. Nothing exists until it is saved.'}
      actions={
        <Button variant="outline" data-testid="content-back" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
          Back to the list
        </Button>
      }
    >
      <Tabs
        data-testid="content-tabs"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { id: 'editor', label: 'Editor' },
          { id: 'revisions', label: 'Revisions', badge: revisions.data ? <Badge>{revisions.data.length}</Badge> : undefined, disabled: !itemId },
          { id: 'audio', label: 'Audio', disabled: !itemId },
          { id: 'live', label: 'Live', disabled: !item.data?.published_revision_id },
        ]}
        className="mb-4"
      />

      <TabPanel active={tab === 'editor'} data-testid="content-tab-editor">
        {loading ? (
          // The word "Loading…" was one line high where a form of forty fields
          // was about to appear, so every control the operator was already
          // reaching for moved out from under the pointer the moment it landed.
          <SkeletonFields fields={6} label="Loading the document…" data-testid="content-editor-skeleton" />
        ) : failure ? (
          <p className="text-sm text-chart-5">{failure instanceof Error ? failure.message : 'Could not load'}</p>
        ) : (
          <ContentEditor
            // A restored revision replaces the editor's baseline, so the form
            // has to be rebuilt rather than told its initial value changed.
            key={`${itemId ?? 'new'}:${restored?.id ?? revisions.data?.[0]?.id ?? 'blank'}`}
            site={site}
            item={item.data ?? null}
            source={source}
            preset={settings.presentation.preset || 'portfolio'}
            docsVersions={settings.presentation.docs.versions}
            reportSeries={settings.presentation.report_series}
            siblings={siblings}
            locales={locales}
            accessGroups={(groups.data ?? []).map((group) => group.slug)}
            canWrite={can('content:write')}
            canPreview={can('release:preview')}
            onSaved={async (saved) => {
              setRestored(null)
              await client.invalidateQueries({ queryKey: keys.content.revisions(saved) })
              await client.invalidateQueries({ queryKey: ['content', 'item', saved] })
              if (!itemId) onCreated(saved)
            }}
          />
        )}
      </TabPanel>

      <TabPanel active={tab === 'revisions'} data-testid="content-tab-revisions">
        {itemId ? (
          <Revisions
            item={itemId}
            canWrite={can('content:write')}
            onOpen={(revision) => {
              setRestored(revision)
              setTab('editor')
            }}
          />
        ) : null}
      </TabPanel>

      <TabPanel active={tab === 'audio'} data-testid="content-tab-audio">
        {itemId && item.data ? <AudioPanel site={site} item={item.data} /> : null}
      </TabPanel>

      <TabPanel active={tab === 'live'} data-testid="content-tab-live">
        {item.data?.published_revision_id ? <LivePanel site={site} item={item.data} /> : null}
      </TabPanel>
    </Page>
  )
}

/**
 * Narration for one document.
 *
 * The job list is the only part of this with a schema, so it is the only part
 * that is read: the per-item endpoints are driven for their effect and reported
 * by whether they succeeded, never by a response shape guessed from the code.
 */
function AudioPanel({ site, item }: { site: string; item: ContentItem }) {
  const can = useCan()
  const client = useQueryClient()
  const { toast } = useToast()
  const jobs = useQuery({ queryKey: keys.audio.jobs(site), queryFn: () => ck.content.audio.jobs(site) })
  const mine = (jobs.data?.jobs ?? []).filter((job) => job.item_id === item.id)

  async function run(action: 'create' | 'remove') {
    try {
      if (action === 'create') await ck.content.audio.create(item.id, { force: true })
      else await ck.content.audio.remove(item.id)
      toast({ tone: 'success', title: action === 'create' ? 'Narration queued' : 'Narration removed' })
      await client.invalidateQueries({ queryKey: keys.audio.jobs(site) })
    } catch (failure) {
      toast({
        tone: 'danger',
        title: action === 'create' ? 'Narration could not be queued' : 'Narration could not be removed',
        detail: failure instanceof Error ? failure.message : undefined,
      })
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        <p className="text-sm text-muted-foreground">
          Narration is produced for published posts only, and only while the site has read-aloud switched on. It spends
          the monthly character budget.
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            data-testid="content-audio-create"
            disabled={!can('content:write') || !item.published_revision_id}
            onClick={() => void run('create')}
          >
            Narrate this document
          </Button>
          <Confirm
            title="Remove the narration?"
            description="The audio file and its job are deleted. The next release serves the page without a player."
            confirmLabel="Remove narration"
            destructive
            onConfirm={() => run('remove')}
          >
            {(open) => (
              <Button
                size="sm"
                variant="ghost"
                data-testid="content-audio-remove"
                disabled={!can('content:write')}
                onClick={open}
              >
                Remove narration
              </Button>
            )}
          </Confirm>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>Status</TH>
              <TH>Attempts</TH>
              <TH>Characters</TH>
              <TH>Error</TH>
              <TH>Updated</TH>
            </TR>
          </THead>
          <TBody>
            <TableState
              columns={5}
              isLoading={jobs.isPending}
              error={jobs.error}
              isEmpty={mine.length === 0}
              onRetry={() => jobs.refetch()}
              emptyMessage="No narration job for this document."
            >
              {mine.map((job) => (
                <TR key={job.id} data-testid="content-audio-job" data-job={job.id}>
                  <TD>
                    <Badge tone={job.status === 'failed' ? 'danger' : job.status === 'done' ? 'success' : 'neutral'}>
                      {job.status}
                    </Badge>
                  </TD>
                  <TD className="text-muted-foreground">{job.attempts}</TD>
                  <TD className="text-muted-foreground">{job.chars ?? '—'}</TD>
                  <TD className="max-w-[20rem] truncate text-chart-5">{job.error ?? ''}</TD>
                  <TD className="text-muted-foreground">
                    <RelativeTime value={job.updated_at} data-testid="content-audio-job-updated" />
                  </TD>
                </TR>
              ))}
            </TableState>
          </TBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/** What the live site actually serves, straight from the published read API. */
function LivePanel({ site, item }: { site: string; item: ContentItem }) {
  const scheme = useContentScheme()
  const published = useQuery({
    queryKey: keys.published.detail(site, item.kind, item.locale, item.slug ?? ''),
    queryFn: () => ck.published.get(site, item.kind as ContentKind, item.locale, item.slug!),
    enabled: Boolean(item.slug),
  })

  if (published.isPending)
    return (
      <Card>
        <CardContent className="pt-5">
          <SkeletonText lines={8} label="Loading the published document…" data-testid="content-live-skeleton" />
        </CardContent>
      </Card>
    )
  if (published.error)
    return (
      <p className="text-sm text-chart-5">
        {published.error instanceof Error ? published.error.message : 'Could not load the published document'}
      </p>
    )

  return (
    <Card>
      <CardContent className="pt-5">
        <p className="mb-3 text-xs text-muted-foreground">
          The active release's own output. It changes only when a release is built and activated.
        </p>
        <ContentHtml html={published.data.html} scheme={scheme} testId="content-live-html" />
      </CardContent>
    </Card>
  )
}
