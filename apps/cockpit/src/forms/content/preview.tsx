import { CircleCheck, FileQuestion, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ck, type RenderResult } from '@/api/ck'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { ContentHtml, useContentScheme } from '@/content/lazy'
import { StatusBadge } from '@/forms/status-badge'
import { useI18n } from '@/lib/i18n-context'
import { SEMANTIC_DIRECTIVES } from './body'
import { contentRoute, effectiveLayout } from './fields'
import type { FrontmatterUI } from './frontmatter'

/**
 * The outline the editor can draw without asking anything.
 *
 * It is deliberately structural rather than visual: headings, directive blocks,
 * diagrams, and the two things that are easy to forget because they live in the
 * frontmatter rather than in the text. Its job is to answer "is this document
 * shaped the way I think it is" in the moment between keystrokes, where a server
 * round trip has not happened yet and a second Markdown renderer must never.
 */
export function StructurePane({
  fm,
  body,
  preset,
  'data-testid': testId = 'ck-structure',
}: {
  fm: FrontmatterUI
  body: string
  preset: string
  'data-testid'?: string
}) {
  const { t } = useI18n()
  const outline = outlineOf(body, {
    diagram: t('content.preview.diagram'),
    chart: t('content.preview.chart'),
    code: t('content.preview.code'),
    emptyHeading: t('content.preview.emptyHeading'),
    semanticBlock: t('content.preview.semanticBlock'),
    unknownDirective: t('content.preview.unknownDirective'),
  })
  const layout = effectiveLayout(fm, preset)

  return (
    <div data-testid={testId} className="flex flex-col gap-4 text-sm">
      <dl className="grid gap-2 sm:grid-cols-2">
        <Fact label={t('content.preview.resolvedLayout')}>
          {fm.layout ? (
            <>{t('content.preview.authored')} <code>{fm.layout}</code></>
          ) : (
            <>
              {t('content.preview.preset')} <code>{preset || 'portfolio'}</code> → <code>{layout}</code>
            </>
          )}
        </Fact>
        <Fact label={t('content.preview.route')}>
          <code data-testid={`${testId}-route`}>{contentRoute(fm, preset)}</code>
        </Fact>
      </dl>

      {fm.tldr.length ? (
        <section data-testid={`${testId}-tldr`} className="rounded-lg border border-border p-3">
          <h3 className="text-xs font-medium text-muted-foreground">{t('content.tldrLabel')}</h3>
          <ul className="mt-1 list-disc pl-4 text-xs">
            {fm.tldr.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {fm.faq.length ? (
        <section data-testid={`${testId}-faq`} className="rounded-lg border border-border p-3">
          <h3 className="text-xs font-medium text-muted-foreground">{t('content.faqLabel')}</h3>
          <ul className="mt-1 flex flex-col gap-1 text-xs">
            {fm.faq.map((entry, index) => (
              <li key={index} className="truncate">
                {entry.q || t('content.preview.noQuestion')}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="text-xs font-medium text-muted-foreground">{t('content.preview.outline')}</h3>
        {outline.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t('content.preview.emptyOutline')}</p>
        ) : (
          <ul data-testid={`${testId}-outline`} className="mt-1 flex flex-col gap-0.5 text-xs">
            {outline.map((entry, index) => (
              <li
                key={index}
                className="flex items-center gap-2 truncate"
                style={{ paddingLeft: `${(entry.depth - 1) * 0.75}rem` }}
              >
                <StatusBadge tone={entry.tone}>{entry.tag}</StatusBadge>
                <span className="truncate">{entry.text}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{entry.line}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xs">{children}</dd>
    </div>
  )
}

interface OutlineEntry {
  tag: string
  text: string
  depth: number
  line: number
  tone: 'neutral' | 'info' | 'warning'
}

const HEADING = /^(#{1,6})\s+(.*)$/
const DIRECTIVE = /^(:{3,})\s*([a-z][a-z0-9-]*)/
const FENCE = /^```+\s*([a-z][a-z0-9-]*)/

/** Line-based on purpose: a parser here would be the second renderer, again. */
function outlineOf(
  body: string,
  labels: {
    diagram: string
    chart: string
    code: string
    emptyHeading: string
    semanticBlock: string
    unknownDirective: string
  },
): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  let inFence = false
  body.split('\n').forEach((raw, index) => {
    const line = raw.trimEnd()
    const fence = FENCE.exec(line)
    if (line.startsWith('```')) {
      if (!inFence && fence) {
        entries.push({
          tag: fence[1]!,
          text: fence[1] === 'mermaid' ? labels.diagram : fence[1] === 'chart' ? labels.chart : labels.code,
          depth: 2,
          line: index + 1,
          tone: fence[1] === 'mermaid' || fence[1] === 'chart' ? 'info' : 'neutral',
        })
      }
      inFence = !inFence
      return
    }
    if (inFence) return
    const heading = HEADING.exec(line)
    if (heading) {
      entries.push({
        tag: `h${heading[1]!.length}`,
        text: heading[2]!.replace(/[`*_~]/g, '') || labels.emptyHeading,
        depth: heading[1]!.length,
        line: index + 1,
        tone: 'neutral',
      })
      return
    }
    const directive = DIRECTIVE.exec(line)
    if (directive) {
      const known = (SEMANTIC_DIRECTIVES as readonly string[]).includes(directive[2]!)
      entries.push({
        tag: directive[2]!,
        text: known ? labels.semanticBlock : labels.unknownDirective,
        depth: 2,
        line: index + 1,
        tone: known ? 'info' : 'warning',
      })
    }
  })
  return entries
}

/**
 * The real thing: the site's own publishing pipeline, over the document being
 * typed.
 *
 * Debounced rather than per keystroke, and the answer is discarded unless it is
 * the newest one — `ck.render` takes no abort signal, so a slow render for text
 * that has since changed must lose on arrival instead of overwriting the pane.
 * A 422 here is the same verdict `POST /v1/sites/{site}/content` would give, so
 * the operator reads it before a revision exists rather than after.
 */
export function ServerPreview({
  site,
  source,
  locale,
  disabled,
  'data-testid': testId = 'ck-preview',
}: {
  site: string
  /** The whole document, frontmatter included — the renderer validates both. */
  source: string
  locale: string
  disabled?: boolean
  'data-testid'?: string
}) {
  const { t } = useI18n()
  const scheme = useContentScheme()
  const [result, setResult] = useState<RenderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setPending] = useState(false)
  const generation = useRef(0)

  useEffect(() => {
    if (disabled || !site || !source.trim()) return
    const mine = ++generation.current
    setPending(true)
    const timer = setTimeout(async () => {
      try {
        const rendered = await ck.render(site, { markdown: source, locale: locale || undefined, scheme })
        if (generation.current !== mine) return
        setResult(rendered)
        setError(null)
      } catch (failure) {
        if (generation.current !== mine) return
        setError(failure instanceof Error ? failure.message : t('content.preview.renderErrorFallback'))
      } finally {
        if (generation.current === mine) setPending(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [site, source, locale, scheme, disabled, t])

  const diagnostics = result?.diagnostics ?? []

  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span data-testid={`${testId}-state`}>
          {isPending
            ? t('content.preview.rendering')
            : error
              ? t('content.preview.rejected')
              : t('content.preview.rendered')}
        </span>
        {result ? (
          <>
            {result.chart_count ? (
              <StatusBadge tone="info">{t('content.preview.charts', { count: result.chart_count })}</StatusBadge>
            ) : null}
            {result.has_mermaid ? <StatusBadge tone="info">{t('content.preview.diagrams')}</StatusBadge> : null}
          </>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" data-testid={`${testId}-error`}>
          <TriangleAlert />
          <AlertTitle>{t('content.preview.refused')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {diagnostics.length ? (
        <ul data-testid={`${testId}-diagnostics`} className="flex flex-col gap-1">
          {diagnostics.map((entry, index) => (
            <li key={index} className="flex items-start gap-2 rounded-lg border border-border p-2 text-xs">
              <StatusBadge tone={entry.severity === 'error' ? 'danger' : entry.severity === 'warning' ? 'warning' : 'neutral'}>
                {entry.code}
              </StatusBadge>
              <span className="min-w-0 flex-1">{entry.message ?? entry.code}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {result ? <ContentHtml html={result.html} scheme={scheme} testId={`${testId}-html`} /> : null}
      {!result && !error && !isPending ? (
        <p className="text-xs text-muted-foreground">{t('content.preview.empty')}</p>
      ) : null}
    </div>
  )
}

/**
 * The composition and deck validators, run on demand.
 *
 * They answer a different question from the renderer: not "does this produce a
 * page" but "does this produce the visual composition it claims to be", which is
 * the check a release runs and the one that fails a build hours later.
 */
export function ValidatePane({
  site,
  source,
  kind,
  layout,
  disabled,
  'data-testid': testId = 'ck-validate',
}: {
  site: string
  source: string
  kind: string
  layout: string
  disabled?: boolean
  'data-testid'?: string
}) {
  const { t } = useI18n()
  const [verdict, setVerdict] = useState<{ ok: boolean; message: string } | null>(null)
  const [isPending, setPending] = useState(false)
  const applicable = layout === 'composition' || kind === 'deck'

  if (!applicable) {
    return (
      <Empty className="border" data-testid={`${testId}-not-applicable`}>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileQuestion />
          </EmptyMedia>
          <EmptyTitle>{t('content.preview.validationEmpty')}</EmptyTitle>
          <EmptyDescription>{t('content.preview.validationEmptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div data-testid={testId} className="flex flex-col gap-2">
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        data-testid={`${testId}-run`}
        disabled={disabled || isPending || !site}
        onClick={async () => {
          setPending(true)
          try {
            if (kind === 'deck') await ck.decks.validate(site, { markdown: source })
            else await ck.compositions.validate(site, { markdown: source })
            setVerdict({ ok: true, message: t('content.preview.accepted') })
          } catch (failure) {
            setVerdict({
              ok: false,
              message: failure instanceof Error ? failure.message : t('content.preview.validationRefused'),
            })
          } finally {
            setPending(false)
          }
        }}
      >
        {isPending ? <Spinner data-icon="inline-start" /> : null}
        {kind === 'deck' ? t('content.preview.validateDeck') : t('content.preview.validateComposition')}
      </Button>
      {verdict ? (
        // Accepted or refused, and the server's own words for the second. Both
        // validators describe their success body in prose only, so there is no
        // generated type for it — and asserting one by hand is exactly the
        // guessing that has already broken this console twice.
        <Alert variant={verdict.ok ? 'default' : 'destructive'} data-testid={`${testId}-verdict`}>
          {verdict.ok ? <CircleCheck /> : <TriangleAlert />}
          <AlertDescription>{verdict.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
