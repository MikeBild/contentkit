import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const SIZES = {
  sm: 'h-3 w-3',
  default: 'h-4 w-4',
  lg: 'h-6 w-6',
}

/**
 * Work in flight, without moving the words.
 *
 * The console signalled a running mutation by replacing the button's label —
 * 'Create key' → 'Creating…' — which changes the width of the control under the
 * pointer, drops the noun that said *what* was being created, and has nothing at
 * all to say for a button whose label is an icon. The label stays put and this
 * appears beside it. `Button` already lays its children out with `gap-2`, so
 * nothing in the variants has to change:
 *
 *     <Button disabled={create.isPending} aria-busy={create.isPending}>
 *       {create.isPending ? <Spinner /> : null}
 *       Create key
 *     </Button>
 *
 * The other half of that is the caller's: `aria-busy` on the control, because a
 * spinner is a picture and pictures are not announced. Which is also why this is
 * `aria-hidden` unless it is the only thing on screen — then `label` makes it a
 * status with a sentence behind it.
 *
 * It keeps spinning under `prefers-reduced-motion`, unlike the skeleton's pulse:
 * the pulse is decoration, whereas a spinner that has stopped says the opposite
 * of what it is there to say.
 */
export function Spinner({
  label,
  size = 'default',
  className,
  'data-testid': testId = 'ck-spinner',
}: {
  /** Present only where the spinner stands alone; then it is announced. */
  label?: string
  size?: keyof typeof SIZES
  className?: string
  'data-testid'?: string
}) {
  // The testid lands on the icon itself when it stands inside a button: an extra
  // wrapper there would be one more box between the label and its indicator.
  if (!label)
    return (
      <Loader2 aria-hidden="true" data-testid={testId} className={cn('animate-spin', SIZES[size], className)} />
    )
  return (
    <span role="status" data-testid={testId} className="inline-flex items-center gap-2 text-muted-foreground">
      <Loader2 aria-hidden="true" className={cn('animate-spin', SIZES[size], className)} />
      <span className="sr-only">{label}</span>
    </span>
  )
}
