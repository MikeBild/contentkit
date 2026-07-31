import type { ReactNode } from 'react'
import { toast as sonner, type ExternalToast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { useTheme } from '@/lib/theme'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface Toast {
  tone: ToastTone
  title: string
  /** The server's own words, when there are any. Never paraphrased. */
  detail?: ReactNode
}

/**
 * How long each tone stays.
 *
 * Errors and warnings stay until they are dismissed. A 422 that names a field
 * the form does not render is exactly the message that must not vanish after
 * four seconds — it is the only evidence the operator gets that the save did
 * nothing. A confirmation is the opposite: leave those up and the corner fills
 * with stale news that has to be cleared by hand.
 */
const DURATION: Record<ToastTone, number> = {
  info: 4000,
  success: 4000,
  warning: Number.POSITIVE_INFINITY,
  danger: Number.POSITIVE_INFINITY,
}

/**
 * The console's four tones, each landing on sonner's own method for it.
 *
 * One line per tone rather than a computed method name, because this is where a
 * severity could quietly be downgraded — `danger` reaching `sonner.warning` would
 * look right on screen and be wrong about what happened — and one table is where
 * that is visible.
 */
const EMIT: Record<ToastTone, (title: string, options: ExternalToast) => string | number> = {
  info: (title, options) => sonner.info(title, options),
  success: (title, options) => sonner.success(title, options),
  warning: (title, options) => sonner.warning(title, options),
  danger: (title, options) => sonner.error(title, options),
}

/**
 * Raise a toast in the console's own vocabulary.
 *
 * The vocabulary is kept — `{ tone, title, detail }` — rather than exposing
 * sonner's method names to twenty call sites: `tone` is the word the rest of the
 * console uses for severity, and it is the thing `DURATION` and `EMIT` are both
 * keyed by, so a new tone is one row in each and nothing else.
 */
export function toast({ tone, title, detail }: Toast) {
  const duration = DURATION[tone]
  return EMIT[tone](title, {
    description: detail,
    duration,
    // A toast that never expires and has no way out is an unremovable one.
    closeButton: !Number.isFinite(duration),
  })
}

export function useToast() {
  return { toast, dismiss: (id?: string | number) => sonner.dismiss(id) }
}

/**
 * Mounts the one toaster the console has.
 *
 * The provider is a mount point and nothing more — sonner keeps the queue in its
 * own store, so there is no context of ours, no state and no dismissal schedule
 * to keep in step with it.
 *
 * `theme` is passed explicitly, and that is load-bearing: `ui/sonner.tsx` is
 * stock, which means it reads its theme from next-themes, and this console does
 * not use next-themes — `lib/theme.ts` is the store that owns the `.dark` class.
 * Stock spreads `{...props}` after its own `theme=`, so the value passed here is
 * what wins; without it a manual light choice under a dark OS leaves the toasts
 * dark.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { resolved } = useTheme()

  return (
    <>
      {children}
      <Toaster
        theme={resolved}
        position="bottom-right"
        // The name the browser checks already know the corner by.
        data-testid="ck-toasts"
      />
    </>
  )
}
