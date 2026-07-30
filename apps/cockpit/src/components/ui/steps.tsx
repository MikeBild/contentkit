import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface StepDescriptor<T extends string> {
  id: T
  /** The question this step answers, in the operator's words. */
  label: string
  /** What the step has decided so far, so it need not be reopened to find out. */
  summary?: string
  /**
   * What still blocks moving past this step. A step with a problem is not
   * passable, and every step after it is unreachable — the message is what says
   * why, instead of a disabled button with no explanation.
   */
  problem?: string
}

/**
 * A linear form as its steps, with the reason a step blocks written on it.
 *
 * Two behaviours are the point. Backwards is always open: a decision three
 * steps ago is exactly what an operator wants to revisit once the consequence
 * shows up. Forwards stops at the first unresolved step, because a later
 * question offered while an earlier one is unanswered reads as optional — and
 * the answer that then never arrives is the one the server rejects.
 */
export function Steps<T extends string>({
  steps,
  value,
  onChange,
  className,
  'data-testid': testId = 'ck-steps',
}: {
  steps: readonly StepDescriptor<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
  'data-testid'?: string
}) {
  const blockedAt = steps.findIndex((step) => step.problem)
  const activeAt = Math.max(
    steps.findIndex((step) => step.id === value),
    0,
  )

  return (
    <ol data-testid={testId} className={cn('scrollbar-thin flex gap-2 overflow-x-auto', className)}>
      {steps.map((step, index) => {
        const active = index === activeAt
        const unreachable = blockedAt >= 0 && index > blockedAt
        const passed = index < activeAt && !step.problem
        // A problem is only reported once its step has been visited. Announcing
        // "a name is required" on step one while the operator is still reading
        // step one is a complaint about something nobody has been asked yet.
        const problem = step.problem && index <= activeAt ? step.problem : undefined
        return (
          <li key={step.id} className="min-w-44 flex-1">
            <button
              type="button"
              aria-current={active ? 'step' : undefined}
              disabled={unreachable}
              title={unreachable ? steps[blockedAt]!.problem : undefined}
              data-testid={`${testId}-${step.id}`}
              onClick={() => onChange(step.id)}
              className={cn(
                'flex w-full flex-col gap-1 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50',
                active ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted/60',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span
                  className={cn(
                    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] tabular-nums',
                    passed ? 'bg-chart-2 text-background' : active ? 'bg-accent text-background' : 'bg-muted',
                  )}
                >
                  {passed ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                {step.label}
              </span>
              <span className={cn('truncate text-xs', problem ? 'text-chart-3' : 'text-muted-foreground')}>
                {problem ?? step.summary ?? '—'}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
