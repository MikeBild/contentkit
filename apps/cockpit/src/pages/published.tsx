import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ck, type ContentKind, type PublishedList } from '@/api/ck'
import { NoSite, Page } from '@/app/shell'
import { useI18n } from '@/lib/i18n-context'
import { TabCountBadge } from '@/components/tab-count'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SkeletonText } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TabPanel, Tabs } from '@/components/ui/tabs'
import { TableState } from '@/forms/table-state'
import { ContentHtml, useContentScheme } from '@/content/lazy'
import { keys } from '@/lib/query'
import { ANY } from '@/lib/select-any'
import { useSite } from '@/lib/site'

export function PublishedPage() {
  const { t, dateTime } = useI18n()
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
      <Page title={t('page.published.title')}>
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
    <Page title={t('page.published.title')} description={t('page.published.description')}>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          className="max-w-md"
          data-testid="published-search"
          placeholder={t('published.search')}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        {/* `published-kind` moves onto the trigger: `Select` is the headless root
            and renders no DOM node, so the id has to name the control that is
            actually on screen. */}
        <Select
          value={kind || ANY}
          onValueChange={(next) => setKind(next === ANY ? '' : (next as ContentKind))}
        >
          <SelectTrigger
            className="w-40"
            data-testid="published-kind"
            aria-label={t('published.filterKind')}
          >
            <SelectValue placeholder={t('published.allKinds')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ANY}>{t('published.allKinds')}</SelectItem>
              {(['page', 'post', 'project', 'deck'] as ContentKind[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`content.kind.${value}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <Card className="py-0">
        <div className="scrollbar-thin overflow-x-auto">
          <Table
            mobileLabels={[
              t('published.title'),
              t('published.kind'),
              t('published.locale'),
              t('published.slug'),
              searching ? t('published.match') : t('published.updated'),
              '',
            ]}
          >
            <TableHeader>
              <TableRow>
                <TableHead>{t('published.title')}</TableHead>
                <TableHead>{t('published.kind')}</TableHead>
                <TableHead>{t('published.locale')}</TableHead>
                <TableHead>{t('published.slug')}</TableHead>
                <TableHead>{searching ? t('published.match') : t('published.updated')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                columns={6}
                isLoading={searching ? search.isPending : list.isPending}
                error={searching ? search.error : list.error}
                isEmpty={(searching ? hits : entries).length === 0}
                onRetry={() => (searching ? search.refetch() : list.refetch())}
                emptyTitle={searching ? t('published.noMatches') : t('published.empty')}
                emptyMessage={
                  searching ? t('published.noMatchesDescription') : t('published.emptyDescription')
                }
              >
                {(searching ? hits : entries).map((entry) => (
                  <TableRow
                    key={`${entry.kind}/${entry.locale}/${entry.slug}`}
                    data-testid="published-row"
                    data-slug={entry.slug}
                  >
                    {/* Bounded and wrapping rather than truncated. §6 says a cut
                        name keeps the whole of itself in a `title`; §3 says a
                        native `title` is not a tooltip, and
                        `cockpit-forms-density.test.mjs` enforces §3 with no
                        exemption — so the only way to satisfy both is not to cut
                        the name at all. */}
                    <TableCell className="max-w-[22rem] font-medium break-words">
                      {entry.title || entry.slug}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t(`content.kind.${entry.kind}`)}</TableCell>
                    <TableCell className="text-muted-foreground">{entry.locale}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{entry.slug}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {searching ? (
                        // The API returns ranked headlines with <mark>; rendering
                        // them as text keeps untrusted content out of the DOM.
                        <span className="text-xs">
                          {String((entry as { headline?: string }).headline ?? '').replace(/<\/?mark>/g, '·')}
                        </span>
                      ) : (
                        (entry as { updated_at?: string }).updated_at
                          ? dateTime((entry as { updated_at?: string }).updated_at!)
                          : '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="published-inspect"
                        onClick={() => setSelected({ kind: entry.kind, locale: entry.locale, slug: entry.slug })}
                      >
                        {t('published.inspect')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableState>
            </TableBody>
          </Table>
        </div>
      </Card>

      {selected ? <PublishedDetail site={site} target={selected} onClose={() => setSelected(null)} /> : null}
    </Page>
  )
}

/**
 * The five views, in the order the strip offers them, and the type of "which one
 * is open". The strip itself is written out in the JSX below rather than mapped
 * from here, because one of the five carries a badge and a tab is a definition
 * rather than a row in a table.
 */
const PUBLISHED_VIEWS = ['rendered', 'markdown', 'semantic', 'diagnostics', 'composition'] as const

type PublishedView = (typeof PUBLISHED_VIEWS)[number]

function PublishedDetail({
  site,
  target,
  onClose,
}: {
  site: string
  target: { kind: ContentKind; locale: string; slug: string }
  onClose: () => void
}) {
  const { t } = useI18n()
  const document = useQuery({
    queryKey: keys.published.detail(site, target.kind, target.locale, target.slug),
    queryFn: () => ck.published.get(site, target.kind, target.locale, target.slug),
  })
  // Rendered first, and first by default: an inspector's question is almost
  // always "what does this look like", and the answer costs nothing — the
  // published read API already returns the release's own HTML, which this page
  // used to throw away. No /render call belongs here; asking ContentKit to
  // re-render a document it has already rendered could only disagree with it.
  const [tab, setTab] = useState<PublishedView>('rendered')
  const scheme = useContentScheme()
  const data = document.data as Record<string, unknown> | undefined

  /*
    Lifted, not fetched. Four of these five tabs are views of one document that
    has already been read, so the only number worth a badge is the one thing the
    reader would otherwise have to click to find out: whether the release said
    anything about this document while rendering it.

    `undefined` until the read lands and `undefined` again if it fails — which is
    the third state, and it is why this is not written `?? 0`. A clean document
    counts zero and shows nothing; a document whose read failed also shows
    nothing, and the panel below carries the error that tells them apart.
  */
  const diagnostics = Array.isArray(data?.diagnostics) ? data.diagnostics.length : undefined
  const diagnosticsBadge = <TabCountBadge count={diagnostics} data-testid="published-count-diagnostics" />

  return (
    // Was a hand-rolled `fixed inset-0 z-50 … bg-black/40` overlay: no focus
    // trap, no Escape, no accessible name, and a black tint written as a colour
    // literal. The vendored Radix Dialog supplies all four, and the panel keeps
    // the id — `published-dialog` names the panel rather than the backdrop,
    // which is the element a browser test wants anyway.
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {/* A reader, not a writer: nothing is in flight, so no busy guard. The
          heading is the document's own coordinates and there is no second
          sentence to add, so the description is explicitly declined rather than
          invented. */}
      <DialogContent data-testid="published-dialog" className="sm:max-w-4xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {t(`content.kind.${target.kind}`)} · {target.locale} · {target.slug}
          </DialogTitle>
        </DialogHeader>
        <div className="scrollbar-thin flex flex-col gap-3 overflow-y-auto">
          {/* Five views of one document, one at a time: a tablist, not five
              buttons. The buttons this replaced were `variant="default"` when
              selected, which is the console's word for "the change this surface
              exists to make" — and switching a read-only view changes nothing.
              The ids are unchanged: `Tabs` composes `${testId}-${id}`. */}
          <Tabs
            data-testid="published-tab"
            value={tab}
            onValueChange={setTab}
            className="overflow-x-auto"
            tabs={[
              { id: 'rendered', label: t('published.rendered') },
              { id: 'markdown', label: t('published.markdown') },
              { id: 'semantic', label: t('published.semantic') },
              { id: 'diagnostics', label: t('published.diagnostics'), badge: diagnosticsBadge },
              { id: 'composition', label: t('published.composition') },
            ]}
          />
          {document.isPending ? (
            <SkeletonText lines={10} label={t('published.loading')} data-testid="published-skeleton" />
          ) : document.error ? (
            <Alert variant="destructive" data-testid="published-error">
              <TriangleAlert />
              <AlertTitle>{t('published.error')}</AlertTitle>
              <AlertDescription>
                {document.error instanceof Error ? document.error.message : t('published.errorFallback')}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <TabPanel active={tab === 'rendered'} data-testid="published-panel-rendered">
                {/* The release's charts ship as a <picture> with both palettes, so
                    they follow the operating system while the surrounding surface
                    follows the console — the one place the two can disagree. */}
                <ContentHtml
                  className="scrollbar-thin max-h-[28rem] overflow-auto rounded-lg border border-border p-4"
                  testId="published-rendered"
                  scheme={scheme}
                  html={String(data?.html ?? '')}
                />
              </TabPanel>
              <TabPanel active={tab === 'composition'} data-testid="published-panel-composition">
                <img
                  className="w-full rounded-lg border border-border"
                  src={ck.published.compositionUrl(site, target.kind, target.locale, target.slug, 'svg')}
                  alt={t('published.compositionAlt')}
                />
              </TabPanel>
              {(['markdown', 'semantic', 'diagnostics'] as const).map((view) => (
                <TabPanel key={view} active={tab === view} data-testid={`published-panel-${view}`}>
                  <pre className="scrollbar-thin max-h-[28rem] overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
                    {view === 'markdown'
                      ? String(data?.markdown ?? '')
                      : JSON.stringify(view === 'semantic' ? data?.semantic : data?.diagnostics, null, 2)}
                  </pre>
                </TabPanel>
              ))}
            </>
          )}
        </div>
        <DialogFooter>
          <Button data-testid="published-close" variant="outline" onClick={onClose}>
            {t('published.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
