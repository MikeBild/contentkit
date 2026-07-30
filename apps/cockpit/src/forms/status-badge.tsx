import { AlertTriangle } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/badge'

/**
 * A domain status, said in the vocabulary `Badge` actually has.
 *
 * The hand-rolled Badge carried a five-value `tone` (`neutral | info | success |
 * warning | danger`) and painted each one with a chart colour. shadcn's Badge
 * carries `variant` and — as `ui/chip.tsx` already records — **`destructive` is
 * the only severity in it**. Rather than reintroducing colour through
 * `className`, which the house rules forbid, the five readings are mapped onto
 * the four visually distinct variants the component ships with, and the one
 * reading that has nowhere to go — "accepted, but look at me" — earns an icon
 * instead of a colour.
 *
 * One module rather than a mapping repeated at every call site: two files that
 * disagree about what "warning" looks like is exactly how a console stops being
 * readable.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const VARIANT: Record<StatusTone, ComponentProps<typeof Badge>['variant']> = {
  neutral: 'secondary',
  info: 'outline',
  success: 'default',
  warning: 'outline',
  danger: 'destructive',
}

export function StatusBadge({
  tone = 'neutral',
  children,
  ...props
}: Omit<ComponentProps<typeof Badge>, 'variant'> & { tone?: StatusTone }) {
  return (
    <Badge variant={VARIANT[tone]} {...props}>
      {/* No sizing class: Badge's own `[&>svg]:size-3!` decides, and `data-icon`
          is what earns the leading padding it reserves. */}
      {tone === 'warning' ? <AlertTriangle data-icon="inline-start" aria-hidden /> : null}
      {children}
    </Badge>
  )
}
