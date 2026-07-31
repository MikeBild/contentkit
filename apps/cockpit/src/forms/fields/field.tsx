import { InfoIcon, TriangleAlertIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Every field in the console takes these. They are spelled out once so a field
 * cannot quietly do without one — a control with no `label`, or an error the
 * screen reader never hears, is the failure mode this wrapper exists to make
 * impossible.
 *
 * Four of them are prose, and which one a sentence belongs in is decided by how
 * the reader gets to it, not by how important it is:
 *
 *   help         one line, on screen, read before acting        FieldDescription
 *   definition   what a word in the label means                 Tooltip
 *   about        a paragraph, a list, a refusal condition       Popover
 *   warning      a consequence of the value as it stands        Alert
 *
 * `help` is the only one that costs vertical space unasked, which is why it is
 * capped at one sentence and why the other three exist at all. All four reach
 * the control: `help`, `fallback` and `warning` through `aria-describedby`, and
 * the two affordances through focusable buttons that name themselves.
 */
export interface FieldShellProps {
  label: string
  /** What the value does, in one sentence. Not what to type — that is `placeholder`. */
  help?: ReactNode
  /** What a term in the label means. Shown on the label's own info affordance. */
  definition?: string
  /** The paragraph, list or refusal condition behind the label's “more” affordance. */
  about?: ReactNode
  required?: boolean
  disabled?: boolean
  /** Blocks the save. Marks the Field invalid and the control `aria-invalid`. */
  error?: string
  /** Accepted but questionable. Rendered as an Alert and never blocks. */
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
  definition,
  about,
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
    <Field
      data-testid={testId}
      // The two attributes that are the whole of validation here: `data-invalid`
      // on the Field, which is what the CVA reads, and `aria-invalid` on the
      // control, which is what a screen reader reads. Neither implies the other,
      // so both are set from the same `error`.
      data-invalid={error ? true : undefined}
      className={cn('gap-1.5', className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-1">
          <FieldLabel htmlFor={id}>
            {label}
            {required ? <span className="text-destructive"> *</span> : null}
          </FieldLabel>
          {/* Both affordances are real buttons rather than the label itself: a
              `<label>` is not focusable, so a definition hung on it is a
              definition only a mouse can reach. `TooltipProvider` is opened here
              as well as at the app root — nesting is legal, and a field rendered
              in a test or a dialog that mounts outside the Shell would otherwise
              throw rather than degrade. */}
          {definition ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    data-testid={`${testId}-definition`}
                    aria-label={`${label} — what this means`}
                  >
                    <InfoIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{definition}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
          {about ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  data-testid={`${testId}-about`}
                  aria-label={`${label} — more about this field`}
                >
                  <InfoIcon />
                </Button>
              </PopoverTrigger>
              <PopoverContent data-testid={`${testId}-about-content`} align="start">
                <PopoverTitle>{label}</PopoverTitle>
                <PopoverDescription>{about}</PopoverDescription>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
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
        <FieldDescription id={helpId} className="text-xs">
          {help}
          {help && fallback ? ' ' : null}
          {fallback ? <span className="italic">{fallback}</span> : null}
        </FieldDescription>
      ) : null}

      {/* `FieldError` is `role="alert"`, which is the difference between an error
          a sighted operator sees turn red and an error a screen-reader operator
          is told about. The id makes it the control's description, which is only
          read when the control is reached; the live region is what interrupts to
          say the save was refused. Both are needed — the id alone leaves an
          operator who has already tabbed past the field with no idea anything
          happened. A warning is the same shape one severity down: an Alert, not a
          line of coloured text, because what it says is a consequence. */}
      {error ? (
        <FieldError id={messageId} data-testid={`${testId}-error`} className="text-xs">
          {error}
        </FieldError>
      ) : warning ? (
        <Alert id={messageId} data-testid={`${testId}-warning`}>
          <TriangleAlertIcon />
          <AlertDescription className="text-xs">{warning}</AlertDescription>
        </Alert>
      ) : null}
    </Field>
  )
}
