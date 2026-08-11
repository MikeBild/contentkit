import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ck } from '@/api/ck'
import { Page } from '@/app/shell'
import { useI18n } from '@/lib/i18n-context'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SkeletonFields } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TabPanel, Tabs } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { StatusBadge } from '@/forms/status-badge'
import { TableState } from '@/forms/table-state'
import { PATTERN_CATEGORY, PATTERN_SCOPE, PATTERN_STATUS } from '@/forms/contracts/enums.generated'
import { keys } from '@/lib/query'
import { ANY } from '@/lib/select-any'
import { useCan } from '@/lib/session'
import { useSite } from '@/lib/site'

const CANVAS = ['portrait', 'landscape', 'square', 'flow'] as const

type PatternQuery = {
  category?: string
  scope?: 'document' | 'node'
  status?: 'experimental' | 'stable' | 'deprecated'
  nodeType?: string
  canvas?: (typeof CANVAS)[number]
  capability?: string
}

/**
 * Three parallel readings of one subject, so a tab strip rather than three cards.
 *
 * The compiler, the pattern registry and the publishing guides all answer "what
 * will ContentKit do with this Markdown", and an author is in exactly one of them
 * at a time: writing a draft, looking up which pattern a node type reaches, or
 * reading when a construct is rejected. They were three cards in a two-column
 * grid, which put a 64-line textarea beside a filtered table and pushed the guides
 * — the only one that is prose — below the fold on every screen the console is
 * used on.
 *
 * `TabPanel` keeps every panel mounted, which is what makes this safe here: the
 * draft in the textarea and the compile result beside it survive a look at the
 * registry and back.
 *
 * It is also what made the tabs cost something, and the cost is paid above:
 * mounted-but-hidden means a panel is out of the accessibility tree, so a
 * compile that failed while the reader was on Patterns was an `Alert` in a
 * `hidden` div — no toast, no badge, and `role="alert"` announcing to nobody,
 * because a live region that is not rendered does not speak. A refusal the
 * reader has to change tabs to discover has not been reported. So the three
 * refusals belong to the page rather than to the Compile panel, and they are
 * rendered above the strip where they are on screen whichever tab is open; the
 * strip says which panel they came from, in the same place and the same grammar
 * as the Patterns and Guides counts.
 */
type CompositionTab = 'compile' | 'patterns' | 'guides'

/** Names this page's strip, so each tab and its panel can address each other. */
const GROUP = 'composition'

export function CompositionsPage() {
  const { t } = useI18n()
  const { site } = useSite()
  const can = useCan()
  const [tab, setTab] = useState<CompositionTab>('compile')
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
  const patternFilters = [
    { key: 'category' as const, label: t('composition.filter.category'), options: PATTERN_CATEGORY },
    { key: 'scope' as const, label: t('composition.filter.scope'), options: PATTERN_SCOPE },
    { key: 'status' as const, label: t('composition.filter.status'), options: PATTERN_STATUS },
  ]
  const patternTextFilters = [
    { key: 'nodeType' as const, label: t('composition.filter.nodeType'), placeholder: t('composition.filter.nodeTypePlaceholder') },
    { key: 'capability' as const, label: t('composition.filter.capability'), placeholder: t('composition.filter.capabilityPlaceholder') },
  ]

  /**
   * Every refusal on this page, in the order the buttons stand in.
   *
   * One list read twice — once above the strip, where the refusal is announced,
   * and once on the Compile tab, where it says which panel produced it. Two
   * derivations of "did anything fail" would be two answers the moment one of
   * them gained a fourth mutation.
   */
  const failures = [
    { id: 'compile', label: t('composition.compile'), state: compile },
    { id: 'validate', label: t('composition.validate'), state: validate },
    { id: 'recommend', label: t('composition.recommend'), state: recommend },
  ].filter((entry) => entry.state.error)

  return (
    <Page
      title={t('page.compositions.title')}
      description={t('composition.description')}
    >
      {/*
        Above the strip, not inside a panel: this is the page's own answer to a
        button the reader pressed, and `TabPanel` hides rather than unmounts, so
        an Alert in the Compile panel is a live region nobody hears while the
        reader is anywhere else. Rendered here it is on screen on all three tabs
        and `role="alert"` — which `Alert` carries — interrupts on arrival.
      */}
      {failures.length > 0 ? (
        <div data-testid="composition-failures" className="mb-4 flex flex-col gap-2">
          {failures.map((entry) => (
            <Alert
              key={entry.id}
              variant="destructive"
              data-testid={`composition-error-${entry.id}`}
            >
              <TriangleAlert />
              <AlertTitle>{t('composition.failed', { action: entry.label })}</AlertTitle>
              <AlertDescription>
                {entry.state.error instanceof Error ? entry.state.error.message : t('common.operationFailed')}
              </AlertDescription>
            </Alert>
          ))}
        </div>
      ) : null}

      <Tabs
        data-testid="composition-tabs"
        group={GROUP}
        value={tab}
        onValueChange={setTab}
        // The strip scrolls rather than widening the page: three tabs and two
        // badges do not fit at 390px, and §6 lets a table scroll sideways and
        // nothing else.
        className="mb-4 overflow-x-auto"
        tabs={[
          {
            id: 'compile',
            label: t('composition.compile'),
            /*
              The strip already says how many patterns and how many guides are
              behind their tabs; this is the same sentence for the one state
              Compile has that the reader cares about from another tab. It is a
              word and a number rather than a red dot — §8: nothing is conveyed
              by colour alone — so the tab's accessible name reads "Compile 1
              failed", which is also what a screen reader gets when it walks the
              strip.
            */
            badge:
              failures.length > 0 ? (
                <Badge variant="destructive" data-testid="composition-tab-compile-failed">
                  {t('composition.failedCount', { count: failures.length })}
                </Badge>
              ) : undefined,
          },
          {
            id: 'patterns',
            label: t('composition.patterns'),
            badge: patterns.data ? <Badge variant="outline">{rows.length}</Badge> : undefined,
          },
          {
            id: 'guides',
            label: t('composition.guides'),
            badge: guides.data ? <Badge variant="outline">{guideRows.length}</Badge> : undefined,
          },
        ]}
      />

      <TabPanel
        active={tab === 'compile'}
        group={GROUP}
        id="compile"
        data-testid="composition-tab-compile"
        className="flex flex-col gap-3"
      >
        {/* The card this was a CardDescription of is gone; the sentence is not.
            It belongs to the three buttons below rather than to the page, which
            is why it sits with the control and not in the Page description. */}
        <p className="text-sm text-muted-foreground">
          {t('composition.compileHint')}
        </p>
        <Textarea
          data-testid="composition-source"
          aria-label={t('composition.sourceLabel')}
          className="h-64 font-mono text-xs"
          spellCheck={false}
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
        <div className="flex flex-wrap justify-end gap-2">
          {/* Button has no `isPending`: the sanctioned shape is a Spinner
              carrying `data-icon` plus `disabled`, and the label stays the
              verb rather than becoming a second progress report. */}
          <Button
            data-testid="composition-recommend"
            variant="outline"
            onClick={() => recommend.mutate()}
            disabled={!site || !can('content:write') || recommend.isPending}
          >
            {recommend.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t('composition.recommend')}
          </Button>
          <Button
            data-testid="composition-validate"
            variant="outline"
            onClick={() => validate.mutate()}
            disabled={!site || !can('content:write') || validate.isPending}
          >
            {validate.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t('composition.validate')}
          </Button>
          <Button
            data-testid="composition-compile"
            onClick={() => compile.mutate()}
            disabled={!site || !can('content:write') || compile.isPending}
          >
            {compile.isPending ? <Spinner data-icon="inline-start" /> : null}
            {t('composition.compile')}
          </Button>
        </div>

        {compiled ? (
          <dl
            data-testid="composition-result"
            className="grid gap-x-6 gap-y-1 rounded-lg border border-border p-3 text-xs sm:grid-cols-[9rem_1fr]"
          >
            <dt className="text-muted-foreground">{t('composition.result.title')}</dt>
            <dd>{compiled.semantic.title}</dd>
            <dt className="text-muted-foreground">{t('composition.result.nodes')}</dt>
            <dd className="font-mono">{compiled.semantic.nodes.map((node) => node.type).join(', ') || '—'}</dd>
            <dt className="text-muted-foreground">{t('composition.result.presentation')}</dt>
            <dd>
              {compiled.rendering.html_presentation} · {compiled.rendering.fidelity}
            </dd>
            <dt className="text-muted-foreground">{t('composition.result.accessibleText')}</dt>
            <dd>{compiled.accessible_text}</dd>
          </dl>
        ) : null}

        {diagnostics.length > 0 ? (
          <ul data-testid="composition-diagnostics" className="flex flex-col gap-1 text-xs">
            {diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${index}`} className="flex gap-2">
                <StatusBadge tone={diagnostic.severity === 'error' ? 'danger' : 'warning'}>
                  {diagnostic.severity}
                </StatusBadge>
                <span className="text-muted-foreground">
                  <span className="font-mono">{diagnostic.code}</span> · {diagnostic.message}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </TabPanel>

      <TabPanel
        active={tab === 'patterns'}
        group={GROUP}
        id="patterns"
        data-testid="composition-tab-patterns"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap gap-2">
          {/* Each filter's id sits on its trigger — `Select` renders no DOM —
              and the sentinel is what stands in for "no filter", which the
              handler turns straight back into `undefined`. */}
          {patternFilters.map((filter) => (
            <Select
              key={filter.key}
              value={filters[filter.key] ?? ANY}
              onValueChange={(next) =>
                setFilters({ ...filters, [filter.key]: next === ANY ? undefined : next } as PatternQuery)
              }
            >
              <SelectTrigger
                className="w-40"
                data-testid={`pattern-filter-${filter.key}`}
                aria-label={t('composition.filter.by', { filter: filter.label.toLocaleLowerCase() })}
              >
                <SelectValue placeholder={t('composition.filter.all', { filter: filter.label.toLocaleLowerCase() })} />
              </SelectTrigger>
              {/* An option is a control a reader picks and a browser check has
                  to address, so it carries a name of its own — UI-UX.md §8. */}
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ANY} data-testid={`pattern-filter-${filter.key}-any`}>
                    {t('composition.filter.all', { filter: filter.label.toLocaleLowerCase() })}
                  </SelectItem>
                  {filter.options.map((option) => (
                    <SelectItem key={option} value={option} data-testid={`pattern-filter-${filter.key}-${option}`}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ))}
          <Select
            value={filters.canvas ?? ANY}
            onValueChange={(next) =>
              setFilters({ ...filters, canvas: next === ANY ? undefined : (next as PatternQuery['canvas']) })
            }
          >
            <SelectTrigger className="w-40" data-testid="pattern-filter-canvas" aria-label={t('composition.filter.by', { filter: t('composition.filter.canvas') })}>
              <SelectValue placeholder={t('composition.filter.canvases')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ANY} data-testid="pattern-filter-canvas-any">
                  {t('composition.filter.canvases')}
                </SelectItem>
                {CANVAS.map((option) => (
                  <SelectItem key={option} value={option} data-testid={`pattern-filter-canvas-${option}`}>
                    {option}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {patternTextFilters.map((filter) => (
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

        <Card className="py-0">
          <div className="scrollbar-thin overflow-x-auto">
            <Table
              mobileLabels={[
                t('composition.table.pattern'),
                t('composition.filter.category'),
                t('composition.filter.scope'),
                t('composition.filter.status'),
              ]}
            >
              <TableHeader>
                <TableRow>
                  <TableHead>{t('composition.table.pattern')}</TableHead>
                  <TableHead>{t('composition.filter.category')}</TableHead>
                  <TableHead>{t('composition.filter.scope')}</TableHead>
                  <TableHead>{t('composition.filter.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState
                  columns={4}
                  isLoading={patterns.isPending}
                  error={patterns.error}
                  isEmpty={rows.length === 0}
                  onRetry={() => patterns.refetch()}
                  emptyTitle={t('composition.patterns.empty')}
                  emptyMessage={t('composition.patterns.emptyDescription')}
                >
                  {rows.map((descriptor) => (
                    <TableRow key={descriptor.id} data-testid="pattern-row" data-pattern={descriptor.id}>
                      <TableCell>
                        {/*
                          It opens a dialog on this page; the URL does not move.
                          Styled as a link it promised a destination it has never
                          had, so it wears the same grammar every other row
                          control that reveals a record wears — `published-inspect`,
                          `content-open`, `ck-group-members-*`.
                        */}
                        <Button
                          variant="outline"
                          size="xs"
                          className="font-mono text-xs"
                          data-testid={`pattern-open-${descriptor.id}`}
                          onClick={() => setPattern(descriptor.id)}
                        >
                          {descriptor.id}
                        </Button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{descriptor.category}</TableCell>
                      <TableCell className="text-muted-foreground">{descriptor.scope}</TableCell>
                      <TableCell>
                        <StatusBadge tone={descriptor.status === 'stable' ? 'success' : 'warning'}>
                          {descriptor.status}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableState>
              </TableBody>
            </Table>
          </div>
        </Card>
      </TabPanel>

      <TabPanel
        active={tab === 'guides'}
        group={GROUP}
        id="guides"
        data-testid="composition-tab-guides"
        className="flex flex-col gap-3"
      >
        <p className="text-sm text-muted-foreground">
          {t('composition.guides.hint')}
        </p>
        <Card className="py-0">
          <div className="scrollbar-thin overflow-x-auto">
            <Table
              mobileLabels={[
                t('composition.table.guide'),
                t('composition.table.kind'),
                t('composition.table.summary'),
                t('composition.filter.status'),
              ]}
            >
              <TableHeader>
                <TableRow>
                  <TableHead>{t('composition.table.guide')}</TableHead>
                  <TableHead>{t('composition.table.kind')}</TableHead>
                  <TableHead>{t('composition.table.summary')}</TableHead>
                  <TableHead>{t('composition.filter.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableState
                  columns={4}
                  isLoading={guides.isPending}
                  error={guides.error}
                  isEmpty={guideRows.length === 0}
                  onRetry={() => guides.refetch()}
                  emptyTitle={t('composition.guides.empty')}
                  emptyMessage={t('composition.guides.emptyDescription')}
                >
                  {guideRows.map((entry) => (
                    <TableRow key={entry.id} data-testid="guide-row" data-guide={entry.id}>
                      <TableCell>
                        {/* A dialog, not a destination — see the pattern table above. */}
                        <Button
                          variant="outline"
                          size="xs"
                          className="text-left"
                          data-testid={`guide-open-${entry.id}`}
                          onClick={() => setGuide(entry.id)}
                        >
                          {entry.title}
                        </Button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{entry.kind}</TableCell>
                      <TableCell className="max-w-[32rem] text-muted-foreground">{entry.summary}</TableCell>
                      <TableCell>
                        <StatusBadge tone={entry.status === 'stable' ? 'success' : 'warning'}>
                          {entry.status}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableState>
              </TableBody>
            </Table>
          </div>
        </Card>
      </TabPanel>

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
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-sm">
        {items.map((entry, index) => (
          <li key={`${entry}-${index}`}>{entry}</li>
        ))}
      </ul>
    </div>
  )
}

function PatternDetail({ pattern, onClose }: { pattern: string; onClose: () => void }) {
  const { t } = useI18n()
  const descriptor = useQuery({
    queryKey: [...keys.patterns(), pattern],
    queryFn: () => ck.compositions.pattern(pattern),
  })
  const data = descriptor.data

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {/* A registry reader: nothing is in flight, so no busy guard.
          `aria-describedby={undefined}` because this dialog has no descriptive
          sentence — the descriptor itself is the content. Radix warns about a
          missing Description otherwise, and inventing one to silence a warning
          would put a sentence on screen that says nothing. */}
      <DialogContent data-testid="pattern-dialog" className="sm:max-w-4xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{pattern}</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-thin overflow-y-auto">
          {descriptor.isPending ? (
            <SkeletonFields fields={5} label={t('composition.loadingPattern')} data-testid="pattern-skeleton" />
          ) : descriptor.error ? (
            <Alert variant="destructive" data-testid="pattern-error">
              <TriangleAlert />
              <AlertTitle>{t('composition.patternError')}</AlertTitle>
              <AlertDescription>
                {descriptor.error instanceof Error ? descriptor.error.message : t('composition.patternErrorFallback')}
              </AlertDescription>
            </Alert>
          ) : data ? (
            <div className="flex flex-col gap-4">
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">{t('composition.filter.category')}</dt>
                <dd>{data.category}</dd>
                <dt className="text-muted-foreground">{t('composition.filter.scope')}</dt>
                <dd>{data.scope}</dd>
                <dt className="text-muted-foreground">{t('composition.filter.status')}</dt>
                <dd>{data.status}</dd>
                <dt className="text-muted-foreground">{t('composition.detail.version')}</dt>
                <dd>{data.version}</dd>
                <dt className="text-muted-foreground">{t('composition.detail.accepts')}</dt>
                <dd>
                  {data.accepts.node_types.join(', ')} · {data.accepts.min_items}–{data.accepts.max_items} {t('composition.detail.items')}
                </dd>
                <dt className="text-muted-foreground">{t('composition.detail.outputs')}</dt>
                <dd>{data.capabilities.outputs.join(', ')}</dd>
                <dt className="text-muted-foreground">{t('composition.detail.question')}</dt>
                <dd>{data.narrative.question}</dd>
                <dt className="text-muted-foreground">{t('composition.detail.takeaway')}</dt>
                <dd>{data.narrative.reader_takeaway}</dd>
              </dl>
              <Bullets label={t('composition.detail.storyArc')} items={data.narrative.story_arc} />
              <Bullets label={t('composition.detail.fallbacks')} items={data.fallbacks} />
              <div>
                <h4 className="text-xs font-medium text-muted-foreground">{t('composition.detail.slots')}</h4>
                <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                  {data.slots.map((slot) => (
                    <li key={slot.name}>
                      <span className="font-mono text-xs">{slot.name}</span> · {slot.accepts.join(', ')} · {slot.min}–
                      {slot.max}
                      {slot.required ? ` · ${t('composition.detail.required')}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" data-testid="pattern-close" onClick={onClose}>
            {t('composition.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GuideDetail({ guide, onClose }: { guide: string; onClose: () => void }) {
  const { t } = useI18n()
  const detail = useQuery({ queryKey: [...keys.guides, guide], queryFn: () => ck.compositions.guide(guide) })
  const data = detail.data

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {/* Same as the pattern viewer: a reader, and the guide's own summary is
          the first thing in the body, so there is no separate description. */}
      <DialogContent data-testid="guide-dialog" className="sm:max-w-4xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{data?.title ?? guide}</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-thin overflow-y-auto">
          {detail.isPending ? (
            <SkeletonFields fields={5} label={t('composition.loadingGuide')} data-testid="guide-skeleton" />
          ) : detail.error ? (
            <Alert variant="destructive" data-testid="guide-error">
              <TriangleAlert />
              <AlertTitle>{t('composition.guideError')}</AlertTitle>
              <AlertDescription>
                {detail.error instanceof Error ? detail.error.message : t('composition.guideErrorFallback')}
              </AlertDescription>
            </Alert>
          ) : data ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{data.summary}</p>
              <Bullets label={t('composition.detail.useWhen')} items={data.selection.use_when} />
              <Bullets label={t('composition.detail.rejectWhen')} items={data.selection.reject_when} />
              <Bullets label={t('composition.detail.requiredInput')} items={data.input_contract.required} />
              <Bullets label={t('composition.detail.optionalInput')} items={data.input_contract.optional} />
              <Bullets label={t('composition.detail.constraints')} items={data.input_contract.constraints} />
              <Bullets label={t('composition.detail.guidance')} items={data.authoring.guidance} />
              <div>
                <h4 className="text-xs font-medium text-muted-foreground">{t('composition.detail.syntax')}</h4>
                <pre className="scrollbar-thin mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
                  {data.authoring.syntax}
                </pre>
              </div>
              <Bullets label={t('composition.detail.compatiblePatterns')} items={data.compatible_patterns} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" data-testid="guide-close" onClick={onClose}>
            {t('composition.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
