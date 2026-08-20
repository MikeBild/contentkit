import { AlertTriangle } from 'lucide-react'
import { AppLink } from '@/components/app-link'
import { ContextHelp } from '@/components/context-help'
import { RelativeTime } from '@/components/ui/relative-time'
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { ChainStep, ChainStepId, ChainTone, ReleaseChain as ReleaseChainState } from '@/lib/release-chain'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n-context'

/**
 * The release chain as a state, not as a sentence.
 *
 *     Drafts ──▶ Release built ──▶ Active ──▶ Live
 *       ●              ○             ○          ○
 *   3 waiting      no build      6 days ago
 *
 * Everything on screen comes out of `deriveReleaseChain`; this file decides only
 * how it looks. That is what makes the compact variant free: the header form and
 * the card form render the same four steps from the same derivation, so there is
 * no second rule that can disagree with the first.
 *
 * Colour is spent only where something is wrong. A satisfied step is muted with a
 * hollow dot, because a row of four green ticks on a site with nothing to do is
 * decoration — and decoration is what teaches an operator to stop reading the
 * thing that will one day be shouting.
 */

/** Where a step's detail lives. The chain summarises; the page it links to explains. */
const DESTINATION: Record<ChainStepId, '/content' | '/releases'> = {
  drafts: '/content',
  built: '/releases',
  active: '/releases',
  live: '/releases',
}

const DOT: Record<ChainTone, string> = {
  done: 'bg-transparent border-border',
  idle: 'bg-transparent border-border border-dashed',
  unknown: 'bg-transparent border-muted-foreground border-dotted',
  attention: 'bg-warning border-warning',
  blocked: 'bg-destructive border-destructive',
}

const TEXT: Record<ChainTone, string> = {
  done: 'text-muted-foreground',
  idle: 'text-muted-foreground',
  unknown: 'text-muted-foreground italic',
  attention: 'text-warning',
  blocked: 'text-destructive',
}

/**
 * The line between two links, coloured by the link it leads INTO.
 *
 * A chain is drawn, not punctuated. What stood here was the character "▸",
 * rendered at one breakpoint in the card and between every chip in the strip,
 * and a glyph in a text run is a separator: it says "and then" and it cannot say
 * anything else. A line can — it is where the handing-over happens, so it takes
 * the state of the step it hands over to, and a chain that is stuck somewhere is
 * visibly stuck at the joint rather than only at the box after it.
 *
 * Never louder than the link it points at: the tones are damped, because the
 * connector is the evidence and the step is the statement.
 */
const LINE: Record<ChainTone, string> = {
  done: 'bg-border',
  idle: 'bg-border',
  unknown: 'bg-muted-foreground/40',
  attention: 'bg-warning/60',
  blocked: 'bg-destructive/60',
}

export interface ReleaseChainProps {
  chain: ReleaseChainState
  /** 'card' is the overview's own block; 'compact' is the strip for a page header. */
  variant?: 'card' | 'compact'
  isLoading?: boolean
  className?: string
  'data-testid'?: string
}

export function ReleaseChain({
  chain,
  variant = 'card',
  isLoading = false,
  className,
  'data-testid': testId = 'ck-release-chain',
}: ReleaseChainProps) {
  const { t } = useI18n()
  if (isLoading) {
    return (
      <SkeletonGroup
        label={t('releaseChain.loading')}
        data-testid={`${testId}-loading`}
        className={cn(variant === 'compact' ? 'gap-1' : 'rounded-xl border border-border bg-surface p-4', className)}
      >
        <Skeleton className="h-4 w-64" />
        <div className="flex gap-2">
          {STEP_ORDER.map((id) => (
            <Skeleton key={id} className={variant === 'compact' ? 'h-3 w-20' : 'h-10 flex-1'} />
          ))}
        </div>
      </SkeletonGroup>
    )
  }

  const shownChain = localizeChain(chain, t)

  if (variant === 'compact') {
    return (
      <div
        data-testid={testId}
        data-tone={shownChain.tone}
        data-calm={shownChain.calm}
        className={cn('flex items-center gap-2 text-xs', className)}
      >
        <ol className="flex flex-wrap items-center gap-y-1">
          {shownChain.steps.map((step, index) => (
            <li key={step.id} className="flex items-center">
              {index > 0 ? <Connector tone={step.tone} testId={`${testId}-link-${step.id}`} compact /> : null}
              <span
                data-testid={`${testId}-step-${step.id}`}
                data-state={step.state}
                data-tone={step.tone}
                className={cn(
                  // A link, not a word with a dot in front of it: the outline is
                  // what makes four labels in a row read as four things joined
                  // rather than as one sentence with bullets in it.
                  'flex items-center gap-1 rounded-full border px-2 py-0.5',
                  step.tone === 'blocked'
                    ? 'border-destructive/40 bg-destructive/5'
                    : step.tone === 'attention'
                      ? 'border-warning/40 bg-warning/5'
                      : 'border-border',
                  TEXT[step.tone],
                )}
              >
                <Dot tone={step.tone} testId={`${testId}-dot-${step.id}`} />
                {/*
                  The strip has room for the label and not for the detail, so the
                  detail is a disclosure rather than a native `title`: the card
                  variant below prints it, and a header that hides it behind a
                  hover hides it from every operator not holding a mouse. The
                  trigger is the label alone — wrapping the whole step would put
                  this tooltip around RelativeTime's own, which is two bubbles for
                  one hover. `TooltipProvider` is opened locally as well as at the
                  app root: the strip renders in page headers with their own trees.
                */}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        data-testid={`${testId}-detail-trigger-${step.id}`}
                        className="rounded whitespace-nowrap focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {step.label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent data-testid={`${testId}-detail-${step.id}`}>
                      {step.label}: {step.detail}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {/*
                  One date survives into the strip, and it is this one. A calm
                  chain has nothing to count, but "since when" is still a fact the
                  operator is owed — it is the difference between a site activated
                  an hour ago and one nobody has released in six months.
                */}
                {step.id === 'active' && step.at ? (
                  <RelativeTime
                    value={step.at}
                    data-testid={`${testId}-since-${step.id}`}
                    className="text-muted-foreground"
                  />
                ) : null}
              </span>
            </li>
          ))}
        </ol>
        <span data-testid={`${testId}-headline`} className={cn('truncate', TEXT[shownChain.tone])}>
          {shownChain.headline}
        </span>
        {shownChain.unverified ? (
          <ContextHelp label={t('releaseChain.unverifiedLabel')} testId={`${testId}-unverified-help`}>
            {shownChain.unverified}
          </ContextHelp>
        ) : null}
      </div>
    )
  }

  return (
    <section
      data-testid={testId}
      data-tone={shownChain.tone}
      data-calm={shownChain.calm}
      className={cn('rounded-xl border border-border bg-surface p-4', className)}
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold tracking-tight">{t('releaseChain.title')}</h2>
          {shownChain.unverified ? (
            <ContextHelp label={t('releaseChain.unverifiedLabel')} testId={`${testId}-unverified-help`}>
              {shownChain.unverified}
            </ContextHelp>
          ) : null}
        </div>
        <p
          data-testid={`${testId}-headline`}
          className={cn('flex items-center gap-1.5 text-right text-xs', TEXT[shownChain.tone])}
        >
          {shownChain.calm ? null : <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
          {shownChain.headline}
        </p>
      </header>

      {/*
        Four links and three lines, in one run at every width. The grid this
        replaced wrapped to two columns below 1280px and drew its connector only
        above it, so on most screens the chain was four boxes in a square with
        nothing joining them — the shape of a dashboard, not of a chain.
      */}
      <ol className="flex flex-col sm:flex-row sm:items-stretch">
        {shownChain.steps.map((step, index) => (
          <li key={step.id} className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center">
            {index > 0 ? <Connector tone={step.tone} testId={`${testId}-link-${step.id}`} /> : null}
            <Step step={step} testId={testId} />
          </li>
        ))}
      </ol>

    </section>
  )
}

type Translator = ReturnType<typeof useI18n>['t']

function localizeDetail(step: ChainStep, t: Translator): string {
  if (step.id === 'drafts' && step.state === 'waiting') {
    const drafts = /^(\d+) drafts? waiting/.exec(step.detail)?.[1]
    const scheduled = /(?:^| · )(\d+) scheduled/.exec(step.detail)?.[1]
    return [
      drafts ? t(Number(drafts) === 1 ? 'releaseChain.detail.draftWaiting' : 'releaseChain.detail.draftsWaiting', { count: drafts }) : null,
      scheduled ? t('releaseChain.detail.scheduled', { count: scheduled }) : null,
    ].filter(Boolean).join(' · ')
  }
  if (step.id === 'built' && step.state === 'behind') {
    return t(step.count === 1 ? 'releaseChain.detail.publishedMissing' : 'releaseChain.detail.publishedMissingMany', {
      count: step.count ?? 0,
    })
  }
  if (step.id === 'live' && step.state === 'served') {
    const host = / at (.+)$/.exec(step.detail)?.[1]
    return t(host ? 'releaseChain.detail.filesAt' : 'releaseChain.detail.files', {
      count: step.count ?? 0,
      host: host ?? '',
    })
  }

  const keys: Record<string, Parameters<Translator>[0]> = {
    'drafts:unknown': 'releaseChain.detail.notReadable',
    'drafts:empty': 'releaseChain.detail.noContent',
    'drafts:clear': 'releaseChain.detail.nothingWaiting',
    'built:unknown': 'releaseChain.detail.notReadable',
    'built:none': 'releaseChain.detail.noBuild',
    'built:building': 'releaseChain.detail.buildingNow',
    'built:failed': 'releaseChain.detail.lastBuildFailed',
    'built:ready': 'releaseChain.detail.builtNeverActivated',
    'built:stale': 'releaseChain.detail.newerNotServed',
    'built:unordered': 'releaseChain.detail.unordered',
    'built:current': 'releaseChain.detail.newestLive',
    'active:unknown': 'releaseChain.detail.notReadable',
    'active:active': 'releaseChain.detail.activeSince',
    'live:unknown': 'releaseChain.detail.notReadable',
    'live:nothing': 'releaseChain.detail.nothingServed',
    'live:empty': 'releaseChain.detail.noFiles',
  }
  if (step.id === 'active' && step.state === 'none') {
    if (step.detail.includes('content list')) return t('releaseChain.detail.noActiveUnreadable')
    if (step.detail === 'nothing to activate yet') return t('releaseChain.detail.nothingToActivate')
    if (step.detail === 'nothing published yet') return t('releaseChain.detail.nothingPublished')
    return t('releaseChain.detail.noActive')
  }
  if (step.id === 'live' && step.state === 'unknown' && step.detail.includes('file count')) {
    return t('releaseChain.detail.noFileCount')
  }
  const key = keys[`${step.id}:${step.state}`]
  return key ? t(key) : step.detail
}

function localizeChain(chain: ReleaseChainState, t: Translator): ReleaseChainState {
  const labels: Record<ChainStepId, Parameters<Translator>[0]> = {
    drafts: 'releaseChain.step.drafts',
    built: 'releaseChain.step.built',
    active: 'releaseChain.step.active',
    live: 'releaseChain.step.live',
  }
  const steps = chain.steps.map((step) => ({ ...step, label: t(labels[step.id]), detail: localizeDetail(step, t) }))
  const exceptions = steps.filter((step) => step.tone === 'attention' || step.tone === 'blocked')
  const gap = steps.some((step) => step.tone === 'unknown') ? t('releaseChain.headline.gap') : null
  let headline: string
  if (exceptions.length > 0) {
    const parts = [exceptions.slice(0, 2).map((step) => step.detail).join(' · ')]
    if (exceptions.length > 2) parts.push(t('releaseChain.headline.more', { count: exceptions.length - 2 }))
    if (gap) parts.push(gap)
    headline = parts.join(' · ')
  } else {
    const calm: Record<string, Parameters<Translator>[0]> = {
      'Part of this chain could not be read.': 'releaseChain.headline.gapSentence',
      'Nothing written, nothing built.': 'releaseChain.headline.nothingWritten',
      'Nothing is built, so nothing is being served.': 'releaseChain.headline.nothingBuilt',
      'Everything published is in the build this site serves.': 'releaseChain.headline.allPublished',
      'The newest build is the one this site serves; whether it holds everything published could not be checked.':
        'releaseChain.headline.newestUnchecked',
    }
    headline = t(calm[chain.headline] ?? 'releaseChain.headline.newestUnchecked')
  }
  return {
    ...chain,
    steps,
    exceptions,
    headline,
    unverified: chain.unverified ? t('releaseChain.unverified') : null,
  }
}

const STEP_ORDER: ChainStepId[] = ['drafts', 'built', 'active', 'live']

/**
 * One step: what it is, what state it is in, and when.
 *
 * The whole step is the link, so the exception and the place it is fixed are the
 * same target — an operator who can see "3 drafts waiting" should not then have
 * to find the content page in the sidebar.
 */
function Step({ step, testId }: { step: ChainStep; testId: string }) {
  return (
    <AppLink
      to={DESTINATION[step.id]}
      data-testid={`${testId}-step-${step.id}`}
      data-state={step.state}
      data-tone={step.tone}
      className={cn(
        'flex flex-1 flex-col gap-1 rounded-lg border p-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        step.tone === 'blocked'
          ? 'border-destructive/40 bg-destructive/5'
          : step.tone === 'attention'
            ? 'border-warning/40 bg-warning/5'
            : 'border-border',
      )}
    >
      <span className="flex items-center gap-2 text-xs font-medium">
        <Dot tone={step.tone} testId={`${testId}-dot-${step.id}`} />
        {step.label}
        {/*
          The count is the exception's size, and it is rendered only when the
          endpoint answered one: `count: null` means the evidence is missing, and
          a missing number drawn as 0 is the failure mode UsageStats spells out
          with value_state. So `null` prints nothing at all here.
        */}
        {typeof step.count === 'number' && step.count > 0 ? (
          <span
            data-testid={`${testId}-count-${step.id}`}
            className={cn('tabular-nums', step.tone === 'attention' || step.tone === 'blocked' ? '' : 'text-muted-foreground')}
          >
            ({step.count})
          </span>
        ) : null}
      </span>
      <span data-testid={`${testId}-state-${step.id}`} className={cn('text-[0.7rem] leading-tight', TEXT[step.tone])}>
        {step.detail}
        {step.at ? (
          <>
            {' '}
            <RelativeTime value={step.at} data-testid={`${testId}-since-${step.id}`} className="text-inherit" />
          </>
        ) : null}
      </span>
    </AppLink>
  )
}

function Dot({ tone, testId }: { tone: ChainTone; testId: string }) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      aria-hidden="true"
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2', DOT[tone])}
    />
  )
}

/**
 * One line between two links.
 *
 * Hidden from the accessibility tree: an ordered list already says these four
 * are a sequence, and a screen reader that also heard three connectors would
 * hear the ordering twice. The tone is redundant on purpose — the step it points
 * at carries the same state in words, so the colour is confirmation and never
 * the only telling (§2).
 *
 * Stacked below `sm`, in a row from `sm` up, and the vertical form is indented
 * to sit under the status dot of the link above it so the run reads as one line
 * rather than as three unrelated ticks.
 */
function Connector({ tone, testId, compact = false }: { tone: ChainTone; testId: string; compact?: boolean }) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center',
        compact ? 'justify-center' : 'justify-start pl-[0.9rem] sm:justify-center sm:pl-0',
      )}
    >
      <span
        className={cn(
          'rounded-full',
          compact ? 'mx-1.5 h-px w-3' : 'my-1 h-4 w-0.5 sm:mx-2 sm:my-0 sm:h-0.5 sm:w-6',
          LINE[tone],
        )}
      />
    </span>
  )
}
