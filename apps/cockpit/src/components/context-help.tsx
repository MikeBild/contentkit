import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Short, optional context next to a heading or field; never carries required safety information. */
export function ContextHelp({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          data-testid={testId}
          className="shrink-0 text-muted-foreground"
        >
          <CircleHelp data-icon="inline-start" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{children}</TooltipContent>
    </Tooltip>
  )
}
