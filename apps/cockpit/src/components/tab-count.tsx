import { Badge } from '@/components/ui/badge'
import { tabCountLabel, type TabCount } from '@/lib/tab-counts'

/**
 * The number on a tab, when there is one.
 *
 * The whole rule is in `lib/tab-counts.ts` — `lib/` is the base layer and may
 * not import a component, so the decision and the ink it is printed with are two
 * files. This is the ink: a `Badge`, the same one `compositions.tsx` and
 * `content.tsx` already put in their strips, so six strips render one thing.
 *
 * It returns `null` rather than being conditionally rendered by its caller. Four
 * call sites writing `count > 0 ? <Badge/> : undefined` are four chances to
 * write `count ?? 0`, and the fourth one would ship a strip claiming zeroes it
 * never measured.
 */
export function TabCountBadge({
  count,
  noun,
  atLeast,
  variant = 'outline',
  'data-testid': testId,
}: {
  count: TabCount
  /** "pending", "failed" — what the number counts, when it is not the whole list. */
  noun?: string
  /** The count saturated its query's limit, so it is a floor: renders as "200+". */
  atLeast?: boolean
  /** `destructive` for a count of things that went wrong; `outline` for a count of things. */
  variant?: 'outline' | 'destructive'
  'data-testid': string
}) {
  const label = tabCountLabel(count, { noun, atLeast })
  if (label === null) return null
  return (
    <Badge variant={variant} data-testid={testId}>
      {label}
    </Badge>
  )
}
