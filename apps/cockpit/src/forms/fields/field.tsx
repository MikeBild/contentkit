import { useId, type ReactNode } from 'react'
import { Label } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

/**
 * Every field in the console takes these. They are spelled out once so a field
 * cannot quietly do without one — a control with no `label`, or an error the
 * screen reader never hears, is the failure mode this wrapper exists to make
 * impossible.
 */
export interface FieldShellProps {
  label: string
  /** What the value does. Not what to type — that is `placeholder`. */
  help?: ReactNode
  required?: boolean
  disabled?: boolean
  /** Blocks the save. Rendered in chart-5 with a matching border on the control. */
  error?: string
  /** Accepted but questionable. Rendered in chart-3 and never blocks. */
  warning?: string
  /** Live state about the value itself: a character count, a resolved URL. */
  hint?: ReactNode
  /**
   * The sentence that says "empty is not broken" — what the server does when
   * this is left unset ("Falls back to the site name"). Without it every
   * optional field reads as an unfinished one.
   */
  fallback?: ReactNode
  className?: string
  /** `ck-<area>-<element>[-<id>]`, kebab-case. */
  'data-testid': string
}

/** Passed to the control so labelling, description and invalid state are wired for it. */
export interface ControlProps {
  id: string
  'aria-describedby': string | undefined
  'aria-invalid': boolean | undefined
  disabled: boolean | undefined
  'data-testid': string
}

export function FieldShell({
  label,
  help,
  required,
  disabled,
  error,
  warning,
  hint,
  fallback,
  className,
  'data-testid': testId,
  children,
}: FieldShellProps & { children: (control: ControlProps) => ReactNode }) {
  const id = useId()
  const helpId = `${id}-help`
  const messageId = `${id}-message`
  // Order matters: the operator hears the description before the complaint.
  const describedBy = [help || fallback ? helpId : null, error || warning ? messageId : null].filter(Boolean).join(' ')

  return (
    <div data-testid={testId} className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-foreground">
          {label}
          {required ? <span className="ml-0.5 text-chart-5"> *</span> : null}
        </Label>
        {hint ? (
          <span data-testid={`${testId}-hint`} className="text-xs tabular-nums text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>

      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
        disabled,
        'data-testid': `${testId}-control`,
      })}

      {help || fallback ? (
        <p id={helpId} className="text-xs text-muted-foreground">
          {help}
          {help && fallback ? ' ' : null}
          {fallback ? <span className="italic">{fallback}</span> : null}
        </p>
      ) : null}

      {/* `role="alert"` is the difference between an error a sighted operator
          sees turn red and an error a screen-reader operator is told about. The
          id makes it the control's description, which is only read when the
          control is reached; the live region is what interrupts to say the save
          was refused. Both are needed — the id alone leaves an operator who has
          already tabbed past the field with no idea anything happened. */}
      {error ? (
        <p role="alert" id={messageId} data-testid={`${testId}-error`} className="text-xs text-chart-5">
          {error}
        </p>
      ) : warning ? (
        <p id={messageId} data-testid={`${testId}-warning`} className="text-xs text-chart-3">
          {warning}
        </p>
      ) : null}
    </div>
  )
}

/** The one border rule for an invalid control, so no field invents its own. */
export function invalidBorder(error: string | undefined) {
  return error ? 'border-chart-5 focus-visible:ring-chart-5' : undefined
}
