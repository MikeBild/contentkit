import type { ComponentProps } from 'react'
import { Badge } from '@/components/ui/badge'

/**
 * A domain status, said in the vocabulary `Badge` actually has.
 *
 * The hand-rolled Badge carried a five-value `tone` (`neutral | info | success |
 * warning | danger`) and painted each one with a chart colour. The shared Badge
 * now carries low-emphasis semantic variants for those readings. Every badge
 * still states its status in words, so colour and extra icons are never the only
 * way to distinguish a state.
 *
 * One module rather than a mapping repeated at every call site: two files that
 * disagree about what "warning" looks like is exactly how a console stops being
 * readable.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const VARIANT: Record<StatusTone, ComponentProps<typeof Badge>['variant']> = {
  neutral: 'secondary',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
}

export function StatusBadge({
  tone = 'neutral',
  children,
  ...props
}: Omit<ComponentProps<typeof Badge>, 'variant'> & { tone?: StatusTone }) {
  return (
    <Badge variant={VARIANT[tone]} {...props}>
      {children}
    </Badge>
  )
}
