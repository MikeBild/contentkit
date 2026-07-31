import { AlertTriangle } from 'lucide-react'
import { AppLink } from '@/components/app-link'
import { RelativeTime } from '@/components/ui/relative-time'
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { ChainStep, ChainStepId, ChainTone, ReleaseChain as ReleaseChainState } from '@/lib/release-chain'
import { cn } from '@/lib/utils'

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
  if (isLoading) {
    return (
      <SkeletonGroup
        label="Loading the release chain…"
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

  if (variant === 'compact') {
    return (
      <div
        data-testid={testId}
        data-tone={chain.tone}
        data-calm={chain.calm}
        className={cn('flex items-center gap-2 text-xs', className)}
      >
        <ol className="flex items-center gap-1.5">
          {chain.steps.map((step, index) => (
            <li key={step.id} className="flex items-center gap-1.5">
              {index > 0 ? <Arrow /> : null}
              <span
                data-testid={`${testId}-step-${step.id}`}
                data-state={step.state}
                data-tone={step.tone}
                className={cn('flex items-center gap-1', TEXT[step.tone])}
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
        <span data-testid={`${testId}-headline`} className={cn('truncate', TEXT[chain.tone])}>
          {chain.headline}
        </span>
      </div>
    )
  }

  return (
    <section
      data-testid={testId}
      data-tone={chain.tone}
      data-calm={chain.calm}
      className={cn('rounded-xl border border-border bg-surface p-4', className)}
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Release chain</h2>
        <p
          data-testid={`${testId}-headline`}
          className={cn('flex items-center gap-1.5 text-right text-xs', TEXT[chain.tone])}
        >
          {chain.calm ? null : <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
          {chain.headline}
        </p>
      </header>

      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {chain.steps.map((step, index) => (
          <li key={step.id} className="flex items-stretch gap-2">
            {index > 0 ? <Arrow className="hidden self-center xl:block" /> : null}
            <Step step={step} testId={testId} />
          </li>
        ))}
      </ol>

      {chain.unverified ? (
        <p data-testid={`${testId}-unverified`} className="mt-3 text-[0.7rem] leading-relaxed text-muted-foreground">
          {chain.unverified}
        </p>
      ) : null}
    </section>
  )
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

/** The connector. It carries no information, so it is hidden from the accessibility tree. */
function Arrow({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('select-none text-xs text-border', className)}>
      ▸
    </span>
  )
}
