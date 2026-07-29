import { useMutation, useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { ck, type ContentKind, type PublishedList } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { Confirm } from '@/components/confirm'
import { Dialog } from '@/components/ui/dialog'
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
import { ContentHtml, useContentScheme } from '@/content/lazy'
import {
  AUDIO_JOB_STATUS,
  PATTERN_CATEGORY,
  PATTERN_SCOPE,
  PATTERN_STATUS,
  type AudioJobStatus,
} from '@/forms/contracts/enums.generated'
import { NumberField } from '@/forms/fields'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'

const FieldGallery = lazy(() => import('@/forms/gallery').then((module) => ({ default: module.FieldGallery })))
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
        <Select
          data-testid="published-kind"
          aria-label="Filter the published snapshot by kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as ContentKind | '')}
        >
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
  // Rendered first, and first by default: an inspector's question is almost
  // always "what does this look like", and the answer costs nothing — the
  // published read API already returns the release's own HTML, which this page
  // used to throw away. No /render call belongs here; asking ContentKit to
  // re-render a document it has already rendered could only disagree with it.
  const [tab, setTab] = useState<'rendered' | 'markdown' | 'semantic' | 'diagnostics' | 'composition'>('rendered')
  const scheme = useContentScheme()
  const data = document.data as Record<string, unknown> | undefined

  return (
    <div
      data-testid="published-dialog"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <Card className="w-full max-w-4xl">
        <CardHeader>
          <CardTitle>
            {target.kind} · {target.locale} · {target.slug}
          </CardTitle>
          <div className="mt-2 flex gap-1">
            {(['rendered', 'markdown', 'semantic', 'diagnostics', 'composition'] as const).map((value) => (
              <Button
                key={value}
                data-testid={`published-tab-${value}`}
                size="sm"
                variant={tab === value ? 'default' : 'ghost'}
                onClick={() => setTab(value)}
              >
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
          ) : tab === 'rendered' ? (
            // The release's charts ship as a <picture> with both palettes, so
            // they follow the operating system while the surrounding surface
            // follows the console — the one place the two can disagree.
            <ContentHtml
              className="scrollbar-thin max-h-[28rem] overflow-auto rounded-lg border border-border p-4"
              testId="published-rendered"
              scheme={scheme}
              html={String(data?.html ?? '')}
            />
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
            <Button data-testid="published-close" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Compositions ─────────────────────────────────────────────────────────────

const PATTERN_FILTERS = [
  { key: 'category' as const, label: 'Category', options: PATTERN_CATEGORY },
  { key: 'scope' as const, label: 'Scope', options: PATTERN_SCOPE },
  { key: 'status' as const, label: 'Status', options: PATTERN_STATUS },
]

/** The two free-text filters the registry accepts; neither is a closed set. */
const PATTERN_TEXT_FILTERS = [
  { key: 'nodeType' as const, label: 'Node type', placeholder: 'metric, chart, table…' },
  { key: 'capability' as const, label: 'Capability', placeholder: 'svg, print, zoom…' },
]

const CANVAS = ['portrait', 'landscape', 'square', 'flow'] as const

type PatternQuery = {
  category?: string
  scope?: 'document' | 'node'
  status?: 'experimental' | 'stable' | 'deprecated'
  nodeType?: string
  canvas?: (typeof CANVAS)[number]
  capability?: string
}

export function CompositionsPage() {
  const { site } = useSite()
  const can = useCan()
  const [filters, setFilters] = useState<PatternQuery>({})
  const [pattern, setPattern] = useState<string | null>(null)
  const [guide, setGuide] = useState<string | null>(null)
  const [source, setSource] = useState('# Title\n\nA paragraph.\n')

  const patterns = useQuery({ queryKey: keys.patterns(filters), queryFn: () => ck.compositions.patterns(filters) })
  const guides = useQuery({ queryKey: keys.guides, queryFn: () => ck.compositions.guides() })

  const compile = useMutation({ mutationFn: () => ck.compositions.compile(site, { markdown: source }) })
  const validate = useMutation({ mutationFn: () => ck.compositions.validate(site, { markdown: source }) })
  const recommend = useMutation({ mutationFn: () => ck.compositions.recommend(site, { markdown: source }) })

  const rows = patterns.data?.patterns ?? []
  const guideRows = guides.data?.guides ?? []
  const diagnostics = compile.data?.diagnostics ?? []
  const compiled = compile.data

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
              aria-label="Markdown to compile"
              className="h-64 font-mono text-xs"
              spellCheck={false}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                data-testid="composition-recommend"
                variant="outline"
                onClick={() => recommend.mutate()}
                disabled={!site || !can('content:write') || recommend.isPending}
              >
                {recommend.isPending ? 'Asking…' : 'Recommend'}
              </Button>
              <Button
                data-testid="composition-validate"
                variant="outline"
                onClick={() => validate.mutate()}
                disabled={!site || !can('content:write') || validate.isPending}
              >
                {validate.isPending ? 'Checking…' : 'Validate'}
              </Button>
              <Button
                data-testid="composition-compile"
                onClick={() => compile.mutate()}
                disabled={!site || !can('content:write') || compile.isPending}
              >
                {compile.isPending ? 'Compiling…' : 'Compile'}
              </Button>
            </div>

            {[
              { label: 'Compile', state: compile },
              { label: 'Validate', state: validate },
              { label: 'Recommend', state: recommend },
            ]
              .filter((entry) => entry.state.error)
              .map((entry) => (
                <p key={entry.label} data-testid={`composition-error-${entry.label.toLowerCase()}`} className="mt-2 text-sm text-chart-5">
                  {entry.label}: {entry.state.error instanceof Error ? entry.state.error.message : 'failed'}
                </p>
              ))}

            {compiled ? (
              <dl
                data-testid="composition-result"
                className="mt-3 grid gap-x-6 gap-y-1 rounded-lg border border-border p-3 text-xs sm:grid-cols-[9rem_1fr]"
              >
                <dt className="text-muted-foreground">Title</dt>
                <dd>{compiled.semantic.title}</dd>
                <dt className="text-muted-foreground">Nodes</dt>
                <dd className="font-mono">
                  {compiled.semantic.nodes.map((node) => node.type).join(', ') || '—'}
                </dd>
                <dt className="text-muted-foreground">Presentation</dt>
                <dd>
                  {compiled.rendering.html_presentation} · {compiled.rendering.fidelity}
                </dd>
                <dt className="text-muted-foreground">Accessible text</dt>
                <dd>{compiled.accessible_text}</dd>
              </dl>
            ) : null}

            {diagnostics.length > 0 ? (
              <ul data-testid="composition-diagnostics" className="mt-3 space-y-1 text-xs">
                {diagnostics.map((diagnostic, index) => (
                  <li key={`${diagnostic.code}-${index}`} className="flex gap-2">
                    <Badge tone={diagnostic.severity === 'error' ? 'danger' : 'warning'}>{diagnostic.severity}</Badge>
                    <span className="text-muted-foreground">
                      <span className="font-mono">{diagnostic.code}</span> · {diagnostic.message}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pattern registry</CardTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              {PATTERN_FILTERS.map((filter) => (
                <Select
                  key={filter.key}
                  data-testid={`pattern-filter-${filter.key}`}
                  aria-label={`Filter patterns by ${filter.label.toLowerCase()}`}
                  value={filters[filter.key] ?? ''}
                  onChange={(event) =>
                    setFilters({ ...filters, [filter.key]: event.target.value || undefined } as PatternQuery)
                  }
                >
                  <option value="">All {filter.label.toLowerCase()}</option>
                  {filter.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ))}
              <Select
                data-testid="pattern-filter-canvas"
                aria-label="Filter patterns by canvas"
                value={filters.canvas ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, canvas: (event.target.value || undefined) as PatternQuery['canvas'] })
                }
              >
                <option value="">All canvases</option>
                {CANVAS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
              {PATTERN_TEXT_FILTERS.map((filter) => (
                <Input
                  key={filter.key}
                  className="w-40"
                  data-testid={`pattern-filter-${filter.key}`}
                  aria-label={filter.label}
                  placeholder={filter.placeholder}
                  value={filters[filter.key] ?? ''}
                  onChange={(event) =>
                    setFilters({ ...filters, [filter.key]: event.target.value || undefined } as PatternQuery)
                  }
                />
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Pattern</TH>
                  <TH>Category</TH>
                  <TH>Scope</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                <TableState
                  columns={4}
                  isLoading={patterns.isPending}
                  error={patterns.error}
                  isEmpty={rows.length === 0}
                  onRetry={() => patterns.refetch()}
                  emptyMessage="No pattern matches these filters."
                >
                  {rows.map((descriptor) => (
                    <TR key={descriptor.id} data-testid="pattern-row" data-pattern={descriptor.id}>
                      <TD>
                        <button
                          type="button"
                          data-testid={`pattern-open-${descriptor.id}`}
                          onClick={() => setPattern(descriptor.id)}
                          className="font-mono text-xs underline decoration-dotted underline-offset-2 hover:text-foreground"
                        >
                          {descriptor.id}
                        </button>
                      </TD>
                      <TD className="text-muted-foreground">{descriptor.category}</TD>
                      <TD className="text-muted-foreground">{descriptor.scope}</TD>
                      <TD>
                        <Badge tone={descriptor.status === 'stable' ? 'success' : 'warning'}>{descriptor.status}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TableState>
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Publishing guides</CardTitle>
            <p className="text-sm text-muted-foreground">
              What each authoring construct is for, when to reject it, and which patterns it is compatible with.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Guide</TH>
                  <TH>Kind</TH>
                  <TH>Summary</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                <TableState
                  columns={4}
                  isLoading={guides.isPending}
                  error={guides.error}
                  isEmpty={guideRows.length === 0}
                  onRetry={() => guides.refetch()}
                >
                  {guideRows.map((entry) => (
                    <TR key={entry.id} data-testid="guide-row" data-guide={entry.id}>
                      <TD>
                        <button
                          type="button"
                          data-testid={`guide-open-${entry.id}`}
                          onClick={() => setGuide(entry.id)}
                          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                        >
                          {entry.title}
                        </button>
                      </TD>
                      <TD className="text-muted-foreground">{entry.kind}</TD>
                      <TD className="max-w-[32rem] text-muted-foreground">{entry.summary}</TD>
                      <TD>
                        <Badge tone={entry.status === 'stable' ? 'success' : 'warning'}>{entry.status}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TableState>
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {pattern ? <PatternDetail pattern={pattern} onClose={() => setPattern(null)} /> : null}
      {guide ? <GuideDetail guide={guide} onClose={() => setGuide(null)} /> : null}
    </Page>
  )
}

function Bullets({ label, items }: { label: string; items: readonly string[] | undefined }) {
  if (!items?.length) return null
  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
        {items.map((entry, index) => (
          <li key={`${entry}-${index}`}>{entry}</li>
        ))}
      </ul>
    </div>
  )
}

function PatternDetail({ pattern, onClose }: { pattern: string; onClose: () => void }) {
  const descriptor = useQuery({
    queryKey: [...keys.patterns(), pattern],
    queryFn: () => ck.compositions.pattern(pattern),
  })
  const data = descriptor.data

  return (
    <Dialog open size="xl" onClose={onClose} data-testid="pattern-dialog" title={pattern}>
      {descriptor.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : descriptor.error ? (
        <p className="text-sm text-chart-5">
          {descriptor.error instanceof Error ? descriptor.error.message : 'Could not load the pattern'}
        </p>
      ) : data ? (
        <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Category</dt>
            <dd>{data.category}</dd>
            <dt className="text-muted-foreground">Scope</dt>
            <dd>{data.scope}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{data.status}</dd>
            <dt className="text-muted-foreground">Version</dt>
            <dd>{data.version}</dd>
            <dt className="text-muted-foreground">Accepts</dt>
            <dd>
              {data.accepts.node_types.join(', ')} · {data.accepts.min_items}–{data.accepts.max_items} items
            </dd>
            <dt className="text-muted-foreground">Outputs</dt>
            <dd>{data.capabilities.outputs.join(', ')}</dd>
            <dt className="text-muted-foreground">Question</dt>
            <dd>{data.narrative.question}</dd>
            <dt className="text-muted-foreground">Reader takeaway</dt>
            <dd>{data.narrative.reader_takeaway}</dd>
          </dl>
          <Bullets label="Story arc" items={data.narrative.story_arc} />
          <Bullets label="Fallbacks" items={data.fallbacks} />
          <div>
            <h4 className="text-xs font-medium text-muted-foreground">Slots</h4>
            <ul className="mt-1 space-y-0.5 text-sm">
              {data.slots.map((slot) => (
                <li key={slot.name}>
                  <span className="font-mono text-xs">{slot.name}</span> · {slot.accepts.join(', ')} · {slot.min}–
                  {slot.max}
                  {slot.required ? ' · required' : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}

function GuideDetail({ guide, onClose }: { guide: string; onClose: () => void }) {
  const detail = useQuery({ queryKey: [...keys.guides, guide], queryFn: () => ck.compositions.guide(guide) })
  const data = detail.data

  return (
    <Dialog open size="xl" onClose={onClose} data-testid="guide-dialog" title={data?.title ?? guide}>
      {detail.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : detail.error ? (
        <p className="text-sm text-chart-5">
          {detail.error instanceof Error ? detail.error.message : 'Could not load the guide'}
        </p>
      ) : data ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{data.summary}</p>
          <Bullets label="Use when" items={data.selection.use_when} />
          <Bullets label="Reject when" items={data.selection.reject_when} />
          <Bullets label="Required input" items={data.input_contract.required} />
          <Bullets label="Optional input" items={data.input_contract.optional} />
          <Bullets label="Constraints" items={data.input_contract.constraints} />
          <Bullets label="Guidance" items={data.authoring.guidance} />
          <div>
            <h4 className="text-xs font-medium text-muted-foreground">Syntax</h4>
            <pre className="scrollbar-thin mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
              {data.authoring.syntax}
            </pre>
          </div>
          <Bullets label="Compatible patterns" items={data.compatible_patterns} />
        </div>
      ) : null}
    </Dialog>
  )
}

// ── Decks ────────────────────────────────────────────────────────────────────

const DECK_PLACEHOLDER = [
  '---',
  'kind: deck',
  'layout: deck',
  'title: A deck',
  'locale: en',
  'slug: a-deck',
  '---',
  '',
  '# Slide one',
  '',
  'The opening claim.',
  '',
  '---',
  '',
  '# Slide two',
  '',
  'What follows from it.',
  '',
].join('\n')

export function DecksPage() {
  const { site } = useSite()
  const can = useCan()
  const themes = useQuery({ queryKey: keys.deckThemes, queryFn: () => ck.decks.themes() })
  const templates = useQuery({ queryKey: keys.deckTemplates, queryFn: () => ck.decks.templates() })
  // The placeholder has to be a deck the server actually accepts, or the page
  // teaches its first lesson wrong: planning demands `kind: deck` (a `layout`
  // alone is refused), and frontmatter validation demands a title, a locale and
  // a slug before it looks at anything deck-specific.
  const [source, setSource] = useState(DECK_PLACEHOLDER)
  const [job, setJob] = useState<string | null>(null)

  const validate = useMutation({ mutationFn: () => ck.decks.validate(site, { markdown: source }) })
  const compile = useMutation({
    // Always asynchronous. A synchronous compile answers 200 with the deck
    // itself, which this page has nowhere to put — the operator confirmed a
    // render and then watched nothing happen. `async` answers 202 with a job id,
    // which is what the status line and the download link below are built on.
    mutationFn: () => ck.decks.compile(site, { markdown: source, async: true }),
    onSuccess: (result) => {
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

  const result = useQuery({
    queryKey: ['deck-job', site, job, 'result'],
    queryFn: () => ck.decks.jobResult(site, job as string),
    enabled: Boolean(site && job) && jobStatus.data?.status === 'done',
  })

  // Frontmatter is the deck's own source of truth for theme and template, so a
  // card writes into it rather than into a hidden request field the operator
  // would have to remember alongside the text they can see.
  const applyFrontmatter = (key: string, value: string) =>
    setSource((current) =>
      new RegExp(`^${key}:.*$`, 'm').test(current)
        ? current.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`)
        : current.replace(/^---\n/, `---\n${key}: ${value}\n`),
    )

  const diagnostics = ((validate.data as { diagnostics?: { severity?: string; message?: string }[] } | undefined)
    ?.diagnostics ?? []) as { severity?: string; message?: string }[]

  return (
    <Page title="Decks" description="Plan, validate and render Slidev decks. Rendering may run asynchronously as a job.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Deck source</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              data-testid="deck-source"
              aria-label="Deck Markdown"
              className="h-72 font-mono text-xs"
              spellCheck={false}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                data-testid="deck-validate"
                variant="outline"
                onClick={() => validate.mutate()}
                disabled={!site || validate.isPending}
              >
                {validate.isPending ? 'Checking…' : 'Validate'}
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

            {validate.error ? (
              <p data-testid="deck-validate-error" className="mt-2 text-sm text-chart-5">
                {validate.error instanceof Error ? validate.error.message : 'Validation failed'}
              </p>
            ) : null}
            {diagnostics.length ? (
              <ul data-testid="deck-diagnostics" className="mt-3 space-y-1 text-xs">
                {diagnostics.map((diagnostic, index) => (
                  <li key={index} className="flex gap-2">
                    <Badge tone={diagnostic.severity === 'error' ? 'danger' : 'warning'}>{diagnostic.severity}</Badge>
                    <span className="text-muted-foreground">{diagnostic.message}</span>
                  </li>
                ))}
              </ul>
            ) : validate.isSuccess ? (
              <p data-testid="deck-diagnostics-clean" className="mt-3 text-xs text-chart-2">
                No diagnostics — the deck compiles as written.
              </p>
            ) : null}

            {job ? (
              <div data-testid="deck-job" className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
                <span>
                  Job {job.slice(0, 8)} · {jobStatus.data?.status ?? 'queued'}
                  {jobStatus.data?.error ? <span className="text-chart-5"> · {jobStatus.data.error}</span> : null}
                </span>
                {/*
                  The result was reachable only by calling the API by hand. A
                  render nobody can download is a render that did not happen.
                */}
                {result.data ? (
                  <a
                    data-testid="deck-job-download"
                    className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                    download={`deck-${job}.json`}
                    href={URL.createObjectURL(
                      new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }),
                    )}
                  >
                    Download result
                  </a>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Themes and templates</CardTitle>
            <p className="text-sm text-muted-foreground">
              Choosing one writes it into the deck's frontmatter above — the only place it takes effect.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Theme</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {(themes.data?.themes ?? []).map((name) => (
                  <Button
                    key={name}
                    size="sm"
                    variant="outline"
                    data-testid={`deck-theme-${name}`}
                    onClick={() => applyFrontmatter('theme', name)}
                  >
                    {name}
                    {name === themes.data?.default ? ' · default' : ''}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <Label>Template</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                {(templates.data?.ids ?? []).map((id) => (
                  <Button
                    key={id}
                    size="sm"
                    variant="outline"
                    data-testid={`deck-template-${id}`}
                    onClick={() => applyFrontmatter('template', id)}
                  >
                    {id}
                    {id === templates.data?.default ? ' · default' : ''}
                  </Button>
                ))}
              </div>
            </div>
            {themes.error || templates.error ? (
              <p className="text-sm text-chart-5">Could not load the deck registry.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </Page>
  )
}

// ── Audio ────────────────────────────────────────────────────────────────────

const AUDIO_LIMITS = [50, 100, 250, 500]

export function AudioPage() {
  const { site, current } = useSite()
  const can = useCan()
  const [status, setStatus] = useState<AudioJobStatus | ''>('')
  const [limit, setLimit] = useState(100)
  const [limitChars, setLimitChars] = useState<number | undefined>(undefined)

  const query = { ...(status ? { status } : {}), limit }
  const jobs = useQuery({
    queryKey: [...keys.audio.jobs(site), query],
    queryFn: () => ck.content.audio.jobs(site, query),
    enabled: Boolean(site),
  })

  if (!site)
    return (
      <Page title="Audio">
        <NoSite />
      </Page>
    )

  const rows = jobs.data?.jobs ?? []
  const summary = jobs.data?.summary

  return (
    <Page
      title="Audio"
      description="Read-aloud rendering jobs and the monthly character budget."
      actions={
        can('release:write') ? (
          <Confirm
            title="Backfill read-aloud audio?"
            description={
              <>
                Every published post of <strong>{site}</strong> without audio is queued for rendering. This spends the
                monthly character budget
                {limitChars === undefined ? '' : `, capped at ${limitChars.toLocaleString()} characters for this run`}.
              </>
            }
            confirmLabel="Start backfill"
            onConfirm={async () => {
              await ck.content.audio.backfill(site, limitChars === undefined ? {} : { limit_chars: limitChars })
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
      {summary ? (
        <div data-testid="audio-summary" className="mb-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>
            {summary.chars_this_month.toLocaleString()} characters used this month
            {summary.monthly_char_budget
              ? ` of ${summary.monthly_char_budget.toLocaleString()} · ${(summary.budget_remaining ?? 0).toLocaleString()} left`
              : ' · no budget configured'}
          </span>
          {AUDIO_JOB_STATUS.map((name) => (
            <span key={name}>
              {name}: {summary[name] ?? 0}
            </span>
          ))}
        </div>
      ) : null}

      {can('release:write') ? (
        <div className="mb-3 max-w-sm">
          <NumberField
            data-testid="audio-limit-chars"
            label="Backfill character cap"
            integer
            unit="characters"
            min={1}
            allowUnset
            unsetLabel="Whole budget"
            help="Stops the run once this many characters have been queued."
            fallback={`Unset uses the site's configured budget${current?.settings?.audio ? '' : ', which this site has not set'}.`}
            value={limitChars}
            onChange={setLimitChars}
          />
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        <Select
          data-testid="audio-status-filter"
          aria-label="Filter audio jobs by status"
          value={status}
          onChange={(event) => setStatus(event.target.value as AudioJobStatus | '')}
        >
          <option value="">All statuses</option>
          {AUDIO_JOB_STATUS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          data-testid="audio-limit-filter"
          aria-label="Number of audio jobs to load"
          value={String(limit)}
          onChange={(event) => setLimit(Number(event.target.value))}
        >
          {AUDIO_LIMITS.map((value) => (
            <option key={value} value={value}>
              Last {value}
            </option>
          ))}
        </Select>
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Status</TH>
              <TH>Characters</TH>
              <TH>Attempts</TH>
              <TH>Created</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            <TableState
              columns={6}
              isLoading={jobs.isPending}
              error={jobs.error}
              isEmpty={rows.length === 0}
              onRetry={() => jobs.refetch()}
              emptyMessage={status ? `No ${status} jobs.` : 'No audio jobs. Enable settings.audio for this site to start.'}
            >
              {rows.map((job) => (
                <TR key={job.id} data-testid="audio-job-row" data-job={job.id}>
                  <TD className="max-w-[18rem] truncate">{job.title || job.slug || job.item_id.slice(0, 12)}</TD>
                  <TD>
                    <Badge tone={job.status === 'done' ? 'success' : job.status === 'failed' ? 'danger' : 'warning'}>
                      {job.status}
                    </Badge>
                    {job.error ? <span className="ml-2 text-xs text-chart-5">{job.error}</span> : null}
                  </TD>
                  <TD className="tabular-nums text-muted-foreground">{job.chars?.toLocaleString() ?? '—'}</TD>
                  <TD className="tabular-nums text-muted-foreground">{job.attempts}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDate(job.created_at)}</TD>
                  <TD>
                    {can('release:write') && job.status === 'failed' ? (
                      <Confirm
                        title="Retry this job?"
                        description={
                          <>
                            <strong>{job.title || job.slug || job.item_id}</strong> is queued again with its backoff
                            clock reset. This spends the monthly character budget and ends in a rebuild.
                          </>
                        }
                        confirmLabel="Retry"
                        onConfirm={async () => {
                          await ck.content.audio.retry(site, job.id)
                          await jobs.refetch()
                        }}
                      >
                        {(open) => (
                          <Button size="sm" variant="outline" data-testid={`audio-retry-${job.id}`} onClick={open}>
                            Retry
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
    </Page>
  )
}

// ── System ───────────────────────────────────────────────────────────────────

function StatusTile({
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
    <Card data-testid={testId}>
      <CardContent className="p-5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
          <Badge tone={tone}>{value}</Badge>
        </p>
        {detail ? <div className="mt-2 text-sm text-muted-foreground">{detail}</div> : null}
      </CardContent>
    </Card>
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

  return (
    <Page title="System" description="Liveness, readiness and the two scheduled maintenance actions.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile
          testId="system-health"
          label="Liveness"
          value={health.isPending ? 'checking' : health.error ? 'unreachable' : 'ok'}
          tone={health.error ? 'danger' : 'success'}
          detail={health.error instanceof Error ? health.error.message : 'The process answers /health.'}
        />
        <StatusTile
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
        <StatusTile
          testId="system-builds"
          label="Release builds in flight"
          value={String(readiness?.inflight ?? '—')}
          tone={(readiness?.inflight ?? 0) > 0 ? 'warning' : 'success'}
          detail="A restart waits for these to finish."
        />
        <StatusTile
          testId="system-decks"
          label="Deck renders"
          value={`${readiness?.deck_inflight ?? 0} running`}
          tone={(readiness?.deck_queued ?? 0) > 0 ? 'warning' : 'success'}
          detail={`${readiness?.deck_queued ?? 0} queued`}
        />
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

      {/* The field inventory, rendered once each. Dev build only — it is a
          drawing board, not an operator surface, and the dynamic import keeps
          it out of everything the production bundle actually loads. */}
      {import.meta.env.DEV ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Field gallery</CardTitle>
            <p className="text-sm text-muted-foreground">
              Every form field the console has, with live state. Not shown in a production build.
            </p>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
              <FieldGallery />
            </Suspense>
          </CardContent>
        </Card>
      ) : null}
    </Page>
  )
}
