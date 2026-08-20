import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, ExternalLink, MoreHorizontal, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ck, type Decision, type PromotionReview } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { AppLink } from '@/components/app-link'
import { ContentHtml, useContentScheme } from '@/content/lazy'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { RelativeTime } from '@/components/ui/relative-time'
import { Spinner } from '@/components/ui/spinner'
import { SkeletonText } from '@/components/ui/skeleton'
import { TabPanel, Tabs } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useI18n, type TranslationKey } from '@/lib/i18n-context'
import { keys } from '@/lib/query'
import { useSite } from '@/lib/site'

type QueueState = 'open' | 'deferred' | 'dismissed' | 'decided'
type QueueKind = 'all' | Decision['kind']

/**
 * The kinds this build can name, and the label for each.
 *
 * WHY THIS IS A TABLE AND NOT A TEMPLATE STRING
 *
 * It used to be `\`decisions.kind.${kind}\` as TranslationKey`. The cast is the
 * whole defect: it told the compiler the key exists, so a kind the catalogue
 * never got a label for compiled cleanly, and `translate()` then called
 * `.replace()` on `undefined` and took the entire Entscheidungen page down with
 * it — no sidebar, no way back (LOCAL-CK-ART-UNBEKANNT). A type assertion that
 * disables the only check standing between a server enum and a blank page is not
 * a convenience, it is the bug.
 *
 * `satisfies Record<Decision['kind'], TranslationKey>` puts the check back and
 * points it at the right moment: the day the server grows a sixth kind,
 * `src/api/schema.d.ts` grows it too and THIS FILE STOPS COMPILING until someone
 * writes the label. That is the guard CK-R1 needs — introducing a kind server-side
 * must not be able to reach an older console as a crash.
 */
const KIND_KEYS = {
  draft_capture: 'decisions.kind.draft_capture',
  comment: 'decisions.kind.comment',
  contact: 'decisions.kind.contact',
  feedback: 'decisions.kind.feedback',
  promotion: 'decisions.kind.promotion',
} as const satisfies Record<Decision['kind'], TranslationKey>

const KINDS = Object.keys(KIND_KEYS) as Decision['kind'][]

/**
 * The label key for a kind, or `null` when this build has no name for it.
 *
 * The parameter is `string`, not `Decision['kind']`: the value arrives over the
 * wire from a server that may be newer than this bundle, and typing it as the
 * enum would be the same lie the cast told. Compile-time exhaustiveness above,
 * runtime honesty here — the two halves answer two different failures.
 */
function keyForKind(kind: string): TranslationKey | null {
  return KIND_KEYS[kind as Decision['kind']] ?? null
}

/**
 * The kind of one position, degraded to a single badge when it cannot be named.
 *
 * §2/§4: a kind this build does not know costs its own badge and nothing more.
 * The raw value stays, in mono beside the honest words, for the same reason the
 * overview keeps `release.promote` beside its sentence (CK-F3) — it is the string
 * an operator greps the server log for, and dropping it would trade a crash for
 * a shrug.
 */
function KindBadge({ kind, testId }: { kind: string; testId: string }) {
  const { t } = useI18n()
  const key = keyForKind(kind)
  if (key) return <Badge variant="secondary" data-testid={testId}>{t(key)}</Badge>
  return (
    <Badge variant="outline" data-testid={testId} data-kind-unnamed="true" className="gap-1.5">
      {t('decisions.kind.unnamed')}
      <code className="font-mono text-[0.9em] break-all opacity-80">{kind}</code>
    </Badge>
  )
}

const STATE_KEYS: Record<QueueState, TranslationKey> = {
  open: 'decisions.open',
  deferred: 'decisions.deferred',
  dismissed: 'decisions.dismissed',
  decided: 'decisions.decided',
}

/**
 * Nothing is open — §8.6's first half, and the only place in this console where
 * an empty list is good news.
 *
 * The green ring is the point. Every other empty state in the console is a muted
 * grey square meaning "there is nothing here"; this one means "there is nothing
 * left", which is a different sentence and has to look like one. The word is
 * still what carries it — the tick is decoration beside "Alles erledigt", never
 * instead of it (CUI-A11Y-5).
 */
function QueueCleared() {
  const { t } = useI18n()
  return (
    <Empty className="border" data-testid="decisions-empty-cleared">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-10 rounded-full bg-success/10 text-success">
          <CircleCheck className="size-5" />
        </EmptyMedia>
        <EmptyTitle>{t('decisions.emptyCleared')}</EmptyTitle>
        <EmptyDescription>{t('decisions.emptyClearedDescription')}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/**
 * Nothing matches — §8.6's second half, and §10's rule for a filtered list.
 *
 * Deliberately smaller than the one above: no ring, no icon plate, one line. The
 * emptiness here says nothing about the work, only about the filter, so it gets
 * the weight of a status line rather than of an announcement. It names the
 * filter that is hiding the queue and carries the way back, because a dead end
 * an operator has to un-click by guesswork is the defect §10 is about.
 */
function FilteredEmpty({ label, onReset }: { label: string[]; onReset: () => void }) {
  const { t, list } = useI18n()
  return (
    <div
      data-testid="decisions-empty-filtered"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-dashed px-4 py-3 text-sm"
    >
      <p className="text-muted-foreground">
        {t('decisions.emptyFiltered')}{' '}
        <span className="text-foreground">{t('decisions.activeFilter', { filter: list(label) })}</span>
      </p>
      <Button data-testid="decisions-reset-filter" variant="outline" size="sm" onClick={onReset}>
        {t('decisions.showAll')}
      </Button>
    </div>
  )
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'untitled-draft'
  )
}

function captureMarkdown(decision: Decision, locale: string) {
  const text = String(decision.source.text || '')
  const title =
    text
      .split(/\r?\n/)
      .find(Boolean)
      ?.replace(/^#+\s*/, '')
      .slice(0, 120) || 'Untitled draft'
  const key = slug(title)
  return `---\ntitle: ${JSON.stringify(title)}\nkind: post\nlocale: ${locale}\ntranslationKey: ${key}\nslug: ${key}\nsummary: ""\n---\n\n${text}`
}

function RenderedMarkdown({ site, id, markdown }: { site: string; id: string; markdown: string }) {
  const scheme = useContentScheme()
  const rendered = useQuery({
    queryKey: keys.render(site, id, scheme),
    queryFn: () => ck.render(site, { markdown, scheme }),
    enabled: Boolean(markdown),
    staleTime: Infinity,
    retry: false,
  })
  if (rendered.isPending) return <Spinner />
  if (rendered.error) return <p className="text-sm text-muted-foreground">{rendered.error.message}</p>
  return rendered.data ? <ContentHtml html={rendered.data.html} scheme={scheme} /> : null
}

function ChangeDiff({ site, review, index }: { site: string; review: PromotionReview; index: number }) {
  const { t } = useI18n()
  const [tab, setTab] = useState<'before' | 'after'>('after')
  const change = review.changes[index]
  if (!change) return null
  const oldMarkdown = String(change.old?.markdown || '')
  const newMarkdown = String(change.new?.markdown || '')
  return (
    <div className="flex flex-col gap-3">
      <div className="md:hidden">
        <Tabs
          group={`decision-diff-${index}`}
          data-testid="decision-diff-tabs"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { id: 'before', label: t('decisions.before'), disabled: !oldMarkdown },
            { id: 'after', label: t('decisions.after'), disabled: !newMarkdown },
          ]}
        />
        <TabPanel
          active={tab === 'before'}
          group={`decision-diff-${index}`}
          id="before"
          data-testid="decision-diff-panel-before"
          className="pt-3"
        >
          {oldMarkdown ? (
            <RenderedMarkdown site={site} id={`${review.id}-${index}-old`} markdown={oldMarkdown} />
          ) : null}
        </TabPanel>
        <TabPanel
          active={tab === 'after'}
          group={`decision-diff-${index}`}
          id="after"
          data-testid="decision-diff-panel-after"
          className="pt-3"
        >
          {newMarkdown ? (
            <RenderedMarkdown site={site} id={`${review.id}-${index}-new`} markdown={newMarkdown} />
          ) : null}
        </TabPanel>
      </div>
      <div className="hidden min-w-0 gap-4 md:grid md:grid-cols-2">
        <section aria-label={t('decisions.before')} className="min-w-0 rounded-lg border p-3">
          <p className="mb-3 text-xs font-medium text-muted-foreground">{t('decisions.before')}</p>
          {oldMarkdown ? <RenderedMarkdown site={site} id={`${review.id}-${index}-old`} markdown={oldMarkdown} /> : '—'}
        </section>
        <section aria-label={t('decisions.after')} className="min-w-0 rounded-lg border p-3">
          <p className="mb-3 text-xs font-medium text-muted-foreground">{t('decisions.after')}</p>
          {newMarkdown ? <RenderedMarkdown site={site} id={`${review.id}-${index}-new`} markdown={newMarkdown} /> : '—'}
        </section>
      </div>
    </div>
  )
}

function PromotionDetails({ site, reviewId }: { site: string; reviewId: string }) {
  const { t } = useI18n()
  const review = useQuery({
    queryKey: keys.promotionReview(site, reviewId),
    queryFn: () => ck.promotionReviews.get(site, reviewId),
  })
  const [openChange, setOpenChange] = useState<number | null>(0)
  if (review.isPending) return <Spinner />
  if (review.error)
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>{t('common.requestFailed')}</AlertTitle>
        <AlertDescription>{review.error.message}</AlertDescription>
      </Alert>
    )
  if (!review.data) return null
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t('decisions.changes', { count: review.data.changes.length })}</Badge>
        {review.data.preview_url ? (
          <Button asChild variant="outline" size="sm">
            <a data-testid="decision-preview-link" href={review.data.preview_url} target="_blank" rel="noreferrer">
              {t('decisions.preview')}
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        ) : null}
      </div>
      {review.data.changes.map((change, index) => (
        <Collapsible
          key={`${change.content_item_id}-${change.effect}`}
          open={openChange === index}
          onOpenChange={(open) => setOpenChange(open ? index : null)}
        >
          <CollapsibleTrigger asChild>
            <Button
              data-testid={`decision-change-${index}`}
              variant="ghost"
              className="h-auto w-full justify-between whitespace-normal text-left"
            >
              <span>{change.title}</span>
              <Badge variant="secondary">{change.effect}</Badge>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <ChangeDiff site={site} review={review.data} index={index} />
          </CollapsibleContent>
        </Collapsible>
      ))}
      <Button asChild>
        <AppLink
          data-testid="decision-activate-review"
          to="/releases"
          search={{ site, promotion_review: review.data.id } as never}
        >
          {t('decisions.activate')}
        </AppLink>
      </Button>
    </div>
  )
}

function DecisionCard({
  decision,
  site,
  locale,
  testId,
}: {
  decision: Decision
  site: string
  locale: string
  testId: string
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [markdown, setMarkdown] = useState(() => captureMarkdown(decision, locale))
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['decisions', site] })
  const action = useMutation({
    mutationFn: async (name: string) => {
      if (name === 'approve') return ck.moderation.moderate(decision.source_id, 'approved')
      if (name === 'reject') {
        if (decision.kind === 'promotion') return ck.promotionReviews.reject(site, decision.source_id)
        return ck.moderation.moderate(decision.source_id, 'rejected')
      }
      if (name === 'read') return ck.moderation.updateContact(decision.source_id, 'read')
      if (name === 'close') return ck.moderation.updateContact(decision.source_id, 'closed')
      if (name === 'reset') return ck.moderation.resetFeedback(decision.source_id)
      if (name === 'triage') return ck.draftCaptures.triage(site, decision.source_id, markdown)
      if (name === 'discard') return ck.draftCaptures.discard(site, decision.source_id)
      if (name === 'defer')
        return ck.decisions.transition(site, decision.id, {
          version: decision.version,
          action: 'defer',
          remind_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
      return ck.decisions.transition(site, decision.id, {
        version: decision.version,
        action: name === 'restore' ? 'restore' : 'dismiss',
      })
    },
    onSuccess: invalidate,
  })
  const overdue = Date.parse(decision.due_at) <= Date.now() && decision.state !== 'decided'
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <KindBadge kind={decision.kind} testId={`${testId}-kind`} />
          {overdue ? <Badge variant="destructive">{t('decisions.overdue')}</Badge> : null}
          <RelativeTime
            value={decision.opened_at}
            className="text-xs text-muted-foreground"
            data-testid={`${testId}-age`}
          />
        </div>
        <CardTitle className="break-words">{decision.title}</CardTitle>
        {decision.summary ? (
          <CardDescription className="whitespace-pre-wrap break-words">{decision.summary}</CardDescription>
        ) : null}
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid={`${testId}-actions`} variant="ghost" size="icon" aria-label={t('common.actions')}>
                <MoreHorizontal data-icon="inline-start" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {decision.state === 'open' ? (
                  <>
                    <DropdownMenuItem onSelect={() => action.mutate('defer')}>{t('decisions.defer')}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => action.mutate('dismiss')}>
                      {t('decisions.dismiss')}
                    </DropdownMenuItem>
                  </>
                ) : decision.state !== 'decided' ? (
                  <DropdownMenuItem onSelect={() => action.mutate('restore')}>
                    {t('decisions.restore')}
                  </DropdownMenuItem>
                ) : null}
                {decision.kind === 'draft_capture' && decision.state === 'open' ? (
                  <DropdownMenuItem variant="destructive" onSelect={() => action.mutate('discard')}>
                    {t('decisions.discardDraft')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      {decision.state === 'open' ? (
        <CardContent className="flex flex-col gap-3">
          {action.error ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>{t('decisions.actionError')}</AlertTitle>
              <AlertDescription>{action.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {decision.kind === 'comment' ? (
            <div className="flex flex-wrap gap-2">
              <Button
                data-testid={`${testId}-approve`}
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate('approve')}
              >
                {action.isPending ? <Spinner data-icon="inline-start" /> : null}
                {t('decisions.approve')}
              </Button>
              <Button
                data-testid={`${testId}-reject`}
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate('reject')}
              >
                {action.isPending ? <Spinner data-icon="inline-start" /> : null}
                {t('decisions.reject')}
              </Button>
            </div>
          ) : null}
          {decision.kind === 'contact' ? (
            <div className="flex flex-wrap gap-2">
              <Button
                data-testid={`${testId}-read`}
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate('read')}
              >
                {action.isPending ? <Spinner data-icon="inline-start" /> : null}
                {t('decisions.markRead')}
              </Button>
              <Button
                data-testid={`${testId}-close`}
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate('close')}
              >
                {action.isPending ? <Spinner data-icon="inline-start" /> : null}
                {t('decisions.close')}
              </Button>
            </div>
          ) : null}
          {decision.kind === 'feedback' ? (
            <Button
              data-testid={`${testId}-reset`}
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() => action.mutate('reset')}
            >
              {action.isPending ? <Spinner data-icon="inline-start" /> : null}
              {t('decisions.reset')}
            </Button>
          ) : null}
          {decision.kind === 'draft_capture' ? (
            <Collapsible open={expanded} onOpenChange={setExpanded}>
              <CollapsibleTrigger asChild>
                <Button data-testid={`${testId}-triage`} size="sm" variant="outline">
                  {t('decisions.triage')}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`capture-${decision.id}`}>{t('decisions.markdown')}</FieldLabel>
                    <Textarea
                      data-testid={`${testId}-markdown`}
                      id={`capture-${decision.id}`}
                      value={markdown}
                      onChange={(event) => setMarkdown(event.target.value)}
                      className="min-h-80 font-mono"
                    />
                  </Field>
                  <Button
                    data-testid={`${testId}-save`}
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() => action.mutate('triage')}
                  >
                    {action.isPending ? <Spinner data-icon="inline-start" /> : null}
                    {t('decisions.saveContent')}
                  </Button>
                </FieldGroup>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
          {decision.kind === 'promotion' ? (
            <div className="flex flex-col gap-3">
              <PromotionDetails site={site} reviewId={decision.source_id} />
              <Button
                data-testid={`${testId}-reject-promotion`}
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate('reject')}
              >
                {action.isPending ? <Spinner data-icon="inline-start" /> : null}
                {t('decisions.reject')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  )
}

export function DecisionsPage() {
  const { t } = useI18n()
  const { site, current } = useSite()
  const [state, setState] = useState<QueueState>('open')
  const [kind, setKind] = useState<QueueKind>('all')
  const query = useQuery({
    queryKey: keys.decisions(site, { state, kind }),
    queryFn: () => ck.decisions.list(site, { state, ...(kind === 'all' ? {} : { kind }) }),
    enabled: Boolean(site),
  })
  const items = useMemo(() => query.data?.items ?? [], [query.data])
  // §8.6 asks for two empty states, and the thing that separates them is whether
  // the operator narrowed the view. An untouched queue that is empty is the good
  // news; the same emptiness behind a shelf or a kind chip is a fact about the
  // filter, and saying "Alles erledigt" over it would be a console congratulating
  // itself for something it was told not to look at.
  const filtered = state !== 'open' || kind !== 'all'
  const filterLabel = [
    state === 'open' ? null : t(STATE_KEYS[state]),
    kind === 'all' ? null : t(KIND_KEYS[kind]),
  ].filter((entry): entry is string => Boolean(entry))
  const split = Date.now() - 3 * 24 * 60 * 60 * 1000
  const waitingLonger = state === 'open' ? items.filter((item) => Date.parse(item.opened_at) <= split) : []
  const currentItems = state === 'open' ? items.filter((item) => Date.parse(item.opened_at) > split) : items
  if (!site)
    return (
      <Page title={t('decisions.title')}>
        <NoSite />
      </Page>
    )
  return (
    <Page title={t('decisions.title')} description={t('decisions.description')}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <ToggleGroup
          type="single"
          value={state}
          onValueChange={(value) => value && setState(value as QueueState)}
          className="justify-start"
        >
          <ToggleGroupItem data-testid="decisions-state-open" value="open">
            {t('decisions.open')} {query.data?.counts.open ?? ''}
          </ToggleGroupItem>
          <ToggleGroupItem data-testid="decisions-state-deferred" value="deferred">
            {t('decisions.deferred')}
          </ToggleGroupItem>
          <ToggleGroupItem data-testid="decisions-state-dismissed" value="dismissed">
            {t('decisions.dismissed')}
          </ToggleGroupItem>
          <ToggleGroupItem data-testid="decisions-state-decided" value="decided">
            {t('decisions.decided')}
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          value={kind}
          onValueChange={(value) => value && setKind(value as QueueKind)}
          className="justify-start"
        >
          <ToggleGroupItem data-testid="decisions-kind-all" value="all">
            {t('decisions.allKinds')}
          </ToggleGroupItem>
          {KINDS.map((entry) => (
            <ToggleGroupItem data-testid={`decisions-kind-${entry.replaceAll('_', '-')}`} key={entry} value={entry}>
              {t(KIND_KEYS[entry])}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {query.error ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{t('decisions.loadError')}</AlertTitle>
            <AlertDescription>{query.error.message}</AlertDescription>
          </Alert>
        ) : query.isPending ? (
          <SkeletonText lines={8} data-testid="decisions-skeleton" />
        ) : items.length === 0 ? (
          filtered ? (
            <FilteredEmpty
              label={filterLabel}
              onReset={() => {
                setState('open')
                setKind('all')
              }}
            />
          ) : (
            <QueueCleared />
          )
        ) : (
          <>
            {currentItems.map((decision, index) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                site={site}
                locale={current?.default_locale || 'en'}
                testId={`decision-current-${index}`}
              />
            ))}
            {waitingLonger.length ? (
              <section className="flex flex-col gap-3" aria-labelledby="decisions-waiting-longer">
                <h2 id="decisions-waiting-longer" className="text-sm font-semibold text-muted-foreground">
                  {t('decisions.overdue')}
                </h2>
                {waitingLonger.map((decision, index) => (
                  <DecisionCard
                    key={decision.id}
                    decision={decision}
                    site={site}
                    locale={current?.default_locale || 'en'}
                    testId={`decision-waiting-${index}`}
                  />
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>
    </Page>
  )
}
