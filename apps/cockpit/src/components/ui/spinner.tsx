import { Loader2Icon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const SIZES = {
  sm: 'size-3',
  default: 'size-4',
  lg: 'size-6',
}

/**
 * Work in flight, without moving the words.
 *
 * The console signalled a running mutation by replacing the button's label —
 * 'Create key' → 'Creating…' — which changes the width of the control under the
 * pointer, drops the noun that said *what* was being created, and has nothing at
 * all to say for a button whose label is an icon. The label stays put and this
 * appears beside it. `Button` lays its children out itself, so an icon in a
 * button carries `data-icon` and no size class:
 *
 *     <Button disabled={create.isPending} aria-busy={create.isPending}>
 *       {create.isPending ? <Spinner data-icon="inline-start" /> : null}
 *       Create key
 *     </Button>
 *
 * Stock shadcn's spinner is one icon carrying `role="status"` and a hardcoded
 * English `aria-label`. Beside a button that already says "Create key" that is a
 * second voice, announcing a word that names nothing in particular. So the icon
 * here is always hidden, and the announcement is a sentence the caller supplies:
 * `label` — or `aria-label`, the way the DOM spells the same claim — turns the
 * picture into a `status` region carrying those words and nothing else.
 *
 * It keeps spinning under `prefers-reduced-motion`, unlike the skeleton's pulse:
 * the pulse is decoration, whereas a spinner that has stopped says the opposite
 * of what it is there to say.
 */
export function Spinner({
  label,
  'aria-label': ariaLabel,
  size = 'default',
  className,
  'data-testid': testId = 'ck-spinner',
  ...props
}: Omit<ComponentProps<'svg'>, 'ref'> & {
  /** Present only where the spinner stands alone; then it is announced. */
  label?: string
  size?: keyof typeof SIZES
  'data-testid'?: string
}) {
  const announcement = label ?? ariaLabel

  // One icon, so there is one place to change it. Named or not, it is
  // `aria-hidden`: either the sr-only sentence below is what gets read, or the
  // words already beside it in the button are.
  const icon = (
    <Loader2Icon
      aria-hidden="true"
      data-slot="spinner"
      // The testid lands on the icon itself when it stands inside a button: an
      // extra wrapper there would be one more box between the label and its
      // indicator. Where there is a wrapper, the wrapper is what a test names
      // and the icon derives its own.
      data-testid={announcement ? `${testId}-icon` : testId}
      className={cn('animate-spin', SIZES[size], className)}
      {...props}
    />
  )

  if (!announcement) return icon

  return (
    <span role="status" data-testid={testId} className="inline-flex items-center gap-2 text-muted-foreground">
      {icon}
      <span className="sr-only">{announcement}</span>
    </span>
  )
}
