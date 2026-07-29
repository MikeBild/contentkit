import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ck, type ContentKind, type PublishedList } from '@/api/ck'
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
  Label,
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

// ── Published + search ───────────────────────────────────────────────────────

export function PublishedPage() {
  const { site } = useSite()
  const [term, setTerm] = useState('')
  const [kind, setKind] = useState<'' | ContentKind>('')
  const [selected, setSelected] = useState<{ kind: ContentKind; locale: string; slug: string } | null>(null)

  const listQuery = { ...(kind ? { kind } : {}), limit: 50 }
  const list = useQuery({
    queryKey: keys.published.list(site, listQuery),
    queryFn: () => ck.published.list(site, listQuery as never),
    enabled: Boolean(site) && term.length === 0,
  })
  const search = useQuery({
    queryKey: ['search', site, term, kind],
    queryFn: () => ck.search(site, { q: term, ...(kind ? { kind } : {}) } as never),
    enabled: Boolean(site) && term.length > 1,
  })

  if (!site)
    return (
      <Page title="Published">
        <NoSite />
      </Page>
    )

  const entries = ((list.data as PublishedList | undefined)?.items ?? []) as {
    kind: ContentKind
    locale: string
    slug: string
    title?: string
    updated_at?: string
    tags?: string[]
  }[]
  const hits = ((search.data as { results?: unknown[] } | undefined)?.results ?? []) as {
    kind: ContentKind
    locale: string
    slug: string
    title?: string
    headline?: string
  }[]
  const searching = term.length > 1

  return (
    <Page title="Published" description="What the live release actually serves, plus full-text search over it.">
      <div className="mb-3 flex gap-2">
        <Input
          className="max-w-md"
          data-testid="published-search"
          placeholder="Search the published snapshot…"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <Select value={kind} onChange={(event) => setKind(event.target.value as ContentKind | '')}>
          <option value="">All kinds</option>
          {(['page', 'post', 'project', 'deck'] as ContentKind[]).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Kind</TH>
              <TH>Locale</TH>
              <TH>Slug</TH>
              <TH>{searching ? 'Match' : 'Updated'}</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            <TableState
              columns={6}
              isLoading={searching ? search.isPending : list.isPending}
              error={searching ? search.error : list.error}
              isEmpty={(searching ? hits : entries).length === 0}
              onRetry={() => (searching ? search.refetch() : list.refetch())}
              emptyMessage={searching ? 'No matches.' : 'Nothing published yet — build and activate a release.'}
            >
              {(searching ? hits : entries).map((entry) => (
                <TR
                  key={`${entry.kind}/${entry.locale}/${entry.slug}`}
                  data-testid="published-row"
                  data-slug={entry.slug}
                >
                  <TD className="max-w-[22rem] truncate font-medium">{entry.title || entry.slug}</TD>
                  <TD className="text-muted-foreground">{entry.kind}</TD>
                  <TD className="text-muted-foreground">{entry.locale}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">{entry.slug}</TD>
                  <TD className="text-muted-foreground">
                    {searching ? (
                      // The API returns ranked headlines with <mark>; rendering
                      // them as text keeps untrusted content out of the DOM.
                      <span className="text-xs">
                        {String((entry as { headline?: string }).headline ?? '').replace(/<\/?mark>/g, '·')}
                      </span>
                    ) : (
                      formatDate((entry as { updated_at?: string }).updated_at)
                    )}
                  </TD>
                  <TD>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="published-inspect"
                      onClick={() => setSelected({ kind: entry.kind, locale: entry.locale, slug: entry.slug })}
                    >
                      Inspect
                    </Button>
                  </TD>
                </TR>
              ))}
            </TableState>
          </TBody>
        </Table>
      </div>

      {selected ? <PublishedDetail site={site} target={selected} onClose={() => setSelected(null)} /> : null}
    </Page>
  )
}

function PublishedDetail({
  site,
  target,
  onClose,
}: {
  site: string
  target: { kind: ContentKind; locale: string; slug: string }
  onClose: () => void
}) {
  const document = useQuery({
    queryKey: keys.published.detail(site, target.kind, target.locale, target.slug),
    queryFn: () => ck.published.get(site, target.kind, target.locale, target.slug),
  })
  const [tab, setTab] = useState<'markdown' | 'semantic' | 'diagnostics' | 'composition'>('markdown')
  const data = document.data as Record<string, unknown> | undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle>
            {target.kind} · {target.locale} · {target.slug}
          </CardTitle>
          <div className="mt-2 flex gap-1">
            {(['markdown', 'semantic', 'diagnostics', 'composition'] as const).map((value) => (
              <Button key={value} size="sm" variant={tab === value ? 'default' : 'ghost'} onClick={() => setTab(value)}>
                {value}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {document.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : document.error ? (
            <p className="text-sm text-chart-5">
              {document.error instanceof Error ? document.error.message : 'Could not load the document'}
            </p>
          ) : tab === 'composition' ? (
            <img
              className="w-full rounded-lg border border-border"
              src={ck.published.compositionUrl(site, target.kind, target.locale, target.slug, 'svg')}
              alt="Rendered composition"
            />
          ) : (
            <pre className="scrollbar-thin max-h-[28rem] overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
              {tab === 'markdown'
                ? String(data?.markdown ?? '')
                : JSON.stringify(tab === 'semantic' ? data?.semantic : data?.diagnostics, null, 2)}
            </pre>
          )}
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

// ── Compositions ─────────────────────────────────────────────────────────────

export function CompositionsPage() {
  const { site } = useSite()
  const can = useCan()
  const patterns = useQuery({ queryKey: keys.patterns(), queryFn: () => ck.compositions.patterns() })
  const guides = useQuery({ queryKey: keys.guides, queryFn: () => ck.compositions.guides() })
  const [source, setSource] = useState('# Title\n\nA paragraph.\n')

  const compile = useMutation({ mutationFn: () => ck.compositions.compile(site, { markdown: source }) })
  const rows = patterns.data?.patterns ?? []
  const result = compile.data as Record<string, unknown> | undefined
  const diagnostics = (result?.diagnostics ?? []) as { severity?: string; message?: string }[]

  return (
    <Page
      title="Compositions"
      description="The deterministic pattern registry, and a compiler you can point at Markdown without persisting anything."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Compile a draft</CardTitle>
            <p className="text-sm text-muted-foreground">
              Nothing is stored: this returns the semantic tree, the chosen pattern and diagnostics only.
            </p>
          </CardHeader>
          <CardContent>
            <Textarea
              data-testid="composition-source"
              className="h-64 font-mono text-xs"
              spellCheck={false}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
            <div className="mt-3 flex justify-end">
              <Button
                data-testid="composition-compile"
                onClick={() => compile.mutate()}
                disabled={!site || !can('content:write') || compile.isPending}
              >
                {compile.isPending ? 'Compiling…' : 'Compile'}
              </Button>
            </div>
            {compile.error ? (
              <p className="mt-2 text-sm text-chart-5">
                {compile.error instanceof Error ? compile.error.message : 'Compile failed'}
              </p>
            ) : null}
            {diagnostics.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs">
                {diagnostics.map((diagnostic, index) => (
                  <li key={index} className="flex gap-2">
                    <Badge tone={diagnostic.severity === 'error' ? 'danger' : 'warning'}>{diagnostic.severity}</Badge>
                    <span className="text-muted-foreground">{diagnostic.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {result ? (
              <pre className="scrollbar-thin mt-3 max-h-64 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
                {JSON.stringify(result.composition ?? result, null, 2)}
              </pre>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pattern registry</CardTitle>
            <p className="text-sm text-muted-foreground">
              {guides.data?.guides?.length ?? 0} publishing guides · {rows.length} patterns
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Pattern</TH>
                  <TH>Category</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                <TableState
                  columns={3}
                  isLoading={patterns.isPending}
                  error={patterns.error}
                  isEmpty={rows.length === 0}
                  onRetry={() => patterns.refetch()}
                >
                  {rows.map((pattern) => {
                    const record = pattern as unknown as Record<string, string>
                    return (
                      <TR key={record.id}>
                        <TD className="font-mono text-xs">{record.id}</TD>
                        <TD className="text-muted-foreground">{record.category}</TD>
                        <TD>
                          <Badge tone={record.status === 'stable' ? 'success' : 'warning'}>{record.status}</Badge>
                        </TD>
                      </TR>
                    )
                  })}
                </TableState>
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}

// ── Decks ────────────────────────────────────────────────────────────────────

export function DecksPage() {
  const { site } = useSite()
  const can = useCan()
  const themes = useQuery({ queryKey: keys.deckThemes, queryFn: () => ck.decks.themes() })
  const templates = useQuery({ queryKey: keys.deckTemplates, queryFn: () => ck.decks.templates() })
  const [source, setSource] = useState('---\nlayout: deck\ntitle: A deck\n---\n\n# Slide one\n')
  const [job, setJob] = useState<string | null>(null)

  const plan = useMutation({ mutationFn: () => ck.decks.plan(site, { markdown: source }) })
  const compile = useMutation({
    mutationFn: () => ck.decks.compile(site, { markdown: source }),
    onSuccess: (result) => {
      // 202 answers with a job id; 200 answers with the deck itself.
      const id =
        (result as { job_id?: string; job?: { id?: string } })?.job_id ?? (result as { job?: { id?: string } })?.job?.id
      setJob(id ?? null)
    },
  })

  const jobStatus = useQuery({
    queryKey: ['deck-job', site, job],
    queryFn: () => ck.decks.job(site, job as string),
    enabled: Boolean(site && job),
    refetchInterval: (query) =>
      query.state.data?.status === 'done' || query.state.data?.status === 'failed' ? false : 2000,
  })

  return (
    <Page
      title="Decks"
      description="Plan, validate and render Slidev decks. Rendering may run asynchronously as a job."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Deck source</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              data-testid="deck-source"
              className="h-72 font-mono text-xs"
              spellCheck={false}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                data-testid="deck-plan"
                variant="outline"
                onClick={() => plan.mutate()}
                disabled={!site || plan.isPending}
              >
                Plan
              </Button>
              <Confirm
                title="Render this deck?"
                description="Rendering runs the real Slidev compiler and can take a while. Nothing is published by it."
                confirmLabel="Render"
                onConfirm={() => compile.mutateAsync()}
              >
                {(open) => (
                  <Button
                    data-testid="deck-render"
                    onClick={open}
                    disabled={!site || !can('deck:render') || compile.isPending}
                  >
                    Render
                  </Button>
                )}
              </Confirm>
            </div>
            {job ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Job {job.slice(0, 8)} · {jobStatus.data?.status ?? 'queued'}
                {jobStatus.data?.error ? <span className="text-chart-5"> · {jobStatus.data.error}</span> : null}
              </p>
            ) : null}
            {plan.data ? (
              <pre className="scrollbar-thin mt-3 max-h-64 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
                {JSON.stringify(plan.data, null, 2)}
              </pre>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Themes and templates</CardTitle>
          </CardHeader>
          <CardContent>
            <Label>Themes</Label>
            <pre className="scrollbar-thin mt-1 max-h-40 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
              {JSON.stringify(themes.data ?? {}, null, 2)}
            </pre>
            <Label className="mt-3 block">Templates</Label>
            <pre className="scrollbar-thin mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
              {JSON.stringify(templates.data ?? {}, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}

// ── Audio ────────────────────────────────────────────────────────────────────

export function AudioPage() {
  const { site } = useSite()
  const can = useCan()
  const jobs = useQuery({
    queryKey: keys.audio.jobs(site),
    queryFn: () => ck.content.audio.jobs(site),
    enabled: !!site,
  })

  if (!site)
    return (
      <Page title="Audio">
        <NoSite />
      </Page>
    )

  const rows = jobs.data?.jobs ?? []
  const budget = jobs.data?.budget

  return (
    <Page
      title="Audio"
      description="Read-aloud rendering jobs and the monthly character budget."
      actions={
        can('release:write') ? (
          <Confirm
            title="Backfill read-aloud audio?"
            description="Every published item without audio is queued for rendering. This consumes the monthly character budget."
            confirmLabel="Start backfill"
            onConfirm={async () => {
              await ck.content.audio.backfill(site)
              await jobs.refetch()
            }}
          >
            {(open) => (
              <Button data-testid="audio-backfill" onClick={open}>
                Backfill
              </Button>
            )}
          </Confirm>
        ) : null
      }
    >
      {budget ? (
        <p className="mb-3 text-sm text-muted-foreground">
          {budget.characters_used.toLocaleString()} of {budget.characters_limit.toLocaleString()} characters used this
          month.
        </p>
      ) : null}
      <div className="rounded-xl border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Status</TH>
              <TH>Characters</TH>
              <TH>Attempts</TH>
              <TH>Created</TH>
            </TR>
          </THead>
          <TBody>
            <TableState
              columns={5}
              isLoading={jobs.isPending}
              error={jobs.error}
              isEmpty={rows.length === 0}
              onRetry={() => jobs.refetch()}
              emptyMessage="No audio jobs. Enable settings.audio for this site to start."
            >
              {rows.map((job) => (
                <TR key={job.id} data-testid="audio-job-row" data-job={job.id}>
                  <TD className="max-w-[18rem] truncate">{job.title || job.slug || job.item_id.slice(0, 12)}</TD>
                  <TD>
                    <Badge tone={job.status === 'done' ? 'success' : job.status === 'failed' ? 'danger' : 'warning'}>
                      {job.status}
                    </Badge>
                  </TD>
                  <TD className="text-muted-foreground">{job.chars?.toLocaleString() ?? '—'}</TD>
                  <TD className="text-muted-foreground">{job.attempts}</TD>
                  <TD className="text-muted-foreground">{formatDate(job.created_at)}</TD>
                </TR>
              ))}
            </TableState>
          </TBody>
        </Table>
      </div>
    </Page>
  )
}

// ── System ───────────────────────────────────────────────────────────────────

export function SystemPage() {
  const can = useCan()
  const health = useQuery({
    queryKey: [...keys.system, 'health'],
    queryFn: () => ck.system.health(),
    refetchInterval: 15_000,
  })
  const ready = useQuery({
    queryKey: [...keys.system, 'ready'],
    queryFn: () => ck.system.ready(),
    refetchInterval: 15_000,
  })

  return (
    <Page title="System" description="Liveness, readiness and the two scheduled maintenance actions.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="scrollbar-thin max-h-40 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
              {JSON.stringify(health.data ?? health.error ?? {}, null, 2)}
            </pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Readiness</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="scrollbar-thin max-h-40 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
              {JSON.stringify(ready.data ?? ready.error ?? {}, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>

      {can('release:write') ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Maintenance</CardTitle>
            <p className="text-sm text-muted-foreground">
              Both of these normally run on a schedule. Trigger them by hand only when you know why.
            </p>
          </CardHeader>
          <CardContent className="flex gap-2">
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
    </Page>
  )
}
