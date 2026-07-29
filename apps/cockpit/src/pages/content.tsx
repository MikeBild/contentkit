import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ck, type ContentItem, type ContentKind } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableState,
  Textarea,
} from '@/components/ui/primitives'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'
import { formatDate } from '@/lib/utils'

const KINDS: ContentKind[] = ['page', 'post', 'project', 'deck']

const TEMPLATE = `---
title: New article
slug: new-article
kind: post
locale: en
summary: One sentence that says what this is.
tags: [contentkit]
---

Write the article here.
`

export function ContentPage() {
  const { site } = useSite()
  const can = useCan()
  const client = useQueryClient()
  const [kind, setKind] = useState<'' | ContentKind>('')
  const [locale, setLocale] = useState('')
  const [selected, setSelected] = useState<ContentItem | null>(null)

  const query = { ...(kind ? { kind } : {}), ...(locale ? { locale } : {}) }
  const items = useQuery({
    queryKey: keys.content.list(site, query),
    queryFn: () => ck.content.list(site, query as never),
    enabled: Boolean(site),
  })

  if (!site)
    return (
      <Page title="Content">
        <NoSite />
      </Page>
    )

  const rows = items.data ?? []

  return (
    <Page
      title="Content"
      description="Revisions are immutable. Creating or editing writes a new draft revision; nothing reaches the live site until a release is built and activated."
      actions={can('content:write') ? <NewContent site={site} onCreated={() => items.refetch()} /> : null}
    >
      <div className="mb-3 flex gap-2">
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
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Kind</TH>
              <TH>Locale</TH>
              <TH>Slug</TH>
              <TH>Live</TH>
              <TH>Updated</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            <TableState
              columns={7}
              isLoading={items.isPending}
              error={items.error}
              isEmpty={rows.length === 0}
              onRetry={() => items.refetch()}
              emptyMessage="No content items match this filter."
            >
              {rows.map((item) => (
                <TR key={item.id} data-testid="content-row" data-item={item.id}>
                  <TD className="max-w-[22rem] truncate font-medium">{item.title || item.translation_key}</TD>
                  <TD className="text-muted-foreground">{item.kind}</TD>
                  <TD className="text-muted-foreground">{item.locale}</TD>
                  <TD className="text-muted-foreground">{item.slug || '—'}</TD>
                  <TD className="space-x-1 whitespace-nowrap">
                    {item.published_revision_id ? <Badge tone="success">published</Badge> : <Badge>draft only</Badge>}
                    {/* A published item whose newest revision is still a draft
                        has unreleased work — the single most useful thing to
                        see in an authoring list. */}
                    {item.published_revision_id && item.latest_revision_status === 'draft' ? (
                      <Badge tone="warning">newer draft</Badge>
                    ) : null}
                  </TD>
                  <TD className="text-muted-foreground">{formatDate(item.updated_at)}</TD>
                  <TD className="flex gap-2">
                    <Button
                      data-testid="content-revisions"
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(item)}
                    >
                      Revisions
                    </Button>
                    {can('content:write') && !item.published_revision_id ? (
                      <Confirm
                        title="Discard this draft?"
                        description={
                          <>
                            <strong>{item.title || item.translation_key}</strong> and every one of its revisions are
                            removed. It was never published, so nothing on the live site changes. This cannot be undone.
                          </>
                        }
                        confirmLabel="Discard draft"
                        destructive
                        onConfirm={async () => {
                          await ck.content.deleteDraft(item.id)
                          await client.invalidateQueries({ queryKey: keys.content.list(site, query) })
                        }}
                      >
                        {(open) => (
                          <Button data-testid="content-discard" size="sm" variant="ghost" onClick={open}>
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
                            <strong>{item.title || item.translation_key}</strong> stops being served after the next
                            release. Its revisions are kept.
                          </>
                        }
                        confirmLabel="Unpublish"
                        destructive
                        onConfirm={async () => {
                          await ck.content.unpublish(item.id)
                          await client.invalidateQueries({ queryKey: keys.content.list(site, query) })
                        }}
                      >
                        {(open) => (
                          <Button data-testid="content-unpublish" size="sm" variant="ghost" onClick={open}>
                            Unpublish
                          </Button>
                        )}
                      </Confirm>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TableState>
          </TBody>
        </Table>
      </div>

      {selected ? <Revisions item={selected} onClose={() => setSelected(null)} /> : null}
    </Page>
  )
}

function NewContent({ site, onCreated }: { site: string; onCreated: () => void }) {
  const [isOpen, setOpen] = useState(false)
  const [source, setSource] = useState(TEMPLATE)
  const create = useMutation({
    mutationFn: () => ck.content.create(site, source),
    onSuccess: () => {
      setOpen(false)
      onCreated()
    },
  })

  if (!isOpen)
    return (
      <Button data-testid="content-new" onClick={() => setOpen(true)}>
        New content
      </Button>
    )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>New content</CardTitle>
          <p className="text-sm text-muted-foreground">
            Markdown with frontmatter, exactly as the API takes it. This creates a draft revision only.
          </p>
        </CardHeader>
        <CardContent>
          <Textarea
            data-testid="content-markdown"
            className="h-[26rem] font-mono text-xs"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
          />
          {create.error ? (
            <p className="mt-2 text-sm text-chart-5">
              {create.error instanceof Error ? create.error.message : 'Could not create the revision'}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button data-testid="content-create-submit" onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Create draft'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Revisions({ item, onClose }: { item: ContentItem; onClose: () => void }) {
  const revisions = useQuery({
    queryKey: keys.content.revisions(item.id),
    queryFn: () => ck.content.revisions(item.id),
  })
  const rows = revisions.data ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>{item.title || item.translation_key}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {item.kind} · {item.locale}
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Status</TH>
                <TH>Slug</TH>
                <TH>Created</TH>
                <TH>Published</TH>
                <TH>Source hash</TH>
              </TR>
            </THead>
            <TBody>
              <TableState
                columns={5}
                isLoading={revisions.isPending}
                error={revisions.error}
                isEmpty={rows.length === 0}
                onRetry={() => revisions.refetch()}
              >
                {rows.map((revision) => (
                  <TR key={revision.id}>
                    <TD>
                      <Badge tone={revision.status === 'published' ? 'success' : 'neutral'}>{revision.status}</Badge>
                    </TD>
                    <TD className="text-muted-foreground">{revision.slug}</TD>
                    <TD className="text-muted-foreground">{formatDate(revision.created_at)}</TD>
                    <TD className="text-muted-foreground">{formatDate(revision.published_at)}</TD>
                    <TD className="font-mono text-xs text-muted-foreground">{revision.source_sha256?.slice(0, 12)}</TD>
                  </TR>
                ))}
              </TableState>
            </TBody>
          </Table>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
