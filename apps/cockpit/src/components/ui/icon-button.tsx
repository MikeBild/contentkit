import type { ComponentProps } from 'react'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

type IconButtonProps = Omit<ComponentProps<typeof Button>, 'aria-label' | 'data-testid'> & {
  label: string
  'data-testid': string
}

/**
 * The one grammar for icon-only actions: a localized accessible name plus the
 * same short name on hover and keyboard focus. The span keeps the explanation
 * hoverable when the underlying action is disabled.
 */
export function IconButton({ label, 'data-testid': testId, ...props }: IconButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild data-testid={`${testId}-tooltip-trigger`}>
          <span className="inline-flex">
            <Button aria-label={label} data-testid={testId} {...props} />
          </span>
        </TooltipTrigger>
        <TooltipContent data-testid={`${testId}-tooltip`}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
