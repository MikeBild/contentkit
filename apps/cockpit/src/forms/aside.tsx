import { Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { FieldDescription } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/lib/i18n-context'

/**
 * One visible line, and the paragraph behind it.
 *
 * Fields have `aside` on their own shell. The things that are not fields did
 * not: a card header explaining why an API key has no update endpoint, a step
 * explaining what the server does with a slug, a status line explaining what
 * immutability costs. Each of those was two or three sentences printed above the
 * thing they describe, read once and then scrolled past for the rest of the
 * console's life.
 *
 * The split is the point. `summary` is the sentence that answers the question
 * someone actually has in front of them; the children are the reasoning, one
 * keystroke away. Nothing is deleted and nothing is unreachable — the trigger is
 * a real button that names itself, and Radix moves focus into the content.
 */
export function Aside({
  title,
  summary,
  children,
  'data-testid': testId,
}: {
  /** Names the paragraph, both in the popover and to a screen reader. */
  title: string
  /** The one line that stays on screen. */
  summary: ReactNode
  children: ReactNode
  'data-testid': string
}) {
  const { t } = useI18n()
  return (
    <div className="flex items-baseline gap-1.5">
      <FieldDescription>{summary}</FieldDescription>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('field.aboutLabel', { label: title })}
            data-testid={testId}
          >
            <Info data-icon="inline-start" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" data-testid={`${testId}-content`}>
          <PopoverTitle>{title}</PopoverTitle>
          <PopoverDescription>{children}</PopoverDescription>
        </PopoverContent>
      </Popover>
    </div>
  )
}
