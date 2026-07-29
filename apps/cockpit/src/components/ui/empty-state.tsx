import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * "Nothing here yet" and "nothing matches these filters" are different facts and
 * need different offers: the first wants the action that creates the first row,
 * the second wants the filters cleared. Rendering one message for both is how a
 * list ends up looking broken to someone who simply typed a narrow search.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  'data-testid': testId = 'ck-empty-state',
}: {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  'data-testid'?: string
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-10 text-center',
        className,
      )}
    >
      {Icon ? <Icon className="h-6 w-6 text-muted-foreground" /> : null}
      <div>
        <div className="text-sm font-medium">{title}</div>
        {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {action}
    </div>
  )
}
