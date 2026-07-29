import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  /** The server's own words, when there are any. Never paraphrased. */
  detail?: ReactNode
}

interface ToastApi {
  toast: (input: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const toneClasses: Record<ToastTone, string> = {
  info: 'border-accent/20 bg-accent/10',
  success: 'border-chart-2/20 bg-chart-2/10',
  warning: 'border-chart-3/20 bg-chart-3/10',
  danger: 'border-chart-5/20 bg-chart-5/10',
}

// Errors stay until they are dismissed. A 422 that names a field the form does
// not render is exactly the message that must not vanish after four seconds —
// it is the only evidence the operator gets that the save did nothing.
const DISMISS_AFTER: Record<ToastTone, number | null> = {
  info: 4000,
  success: 4000,
  warning: null,
  danger: null,
}

let sequence = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((entry) => entry.id !== id)), [])

  const toast = useCallback(
    (input: Omit<Toast, 'id'>) => {
      const id = ++sequence
      setToasts((all) => [...all, { ...input, id }])
      const after = DISMISS_AFTER[input.tone]
      if (after !== null) setTimeout(() => dismiss(id), after)
    },
    [dismiss],
  )

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // polite, not assertive: a save confirmation must not interrupt whatever
        // the operator is typing next.
        aria-live="polite"
        data-testid="ck-toasts"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((entry) => (
          <div
            key={entry.id}
            data-testid={`ck-toast-${entry.tone}`}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-xl border p-3 shadow-lg backdrop-blur',
              toneClasses[entry.tone],
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{entry.title}</div>
              {entry.detail ? <div className="mt-0.5 break-words text-xs text-muted-foreground">{entry.detail}</div> : null}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              data-testid={`ck-toast-dismiss-${entry.id}`}
              onClick={() => dismiss(entry.id)}
              className="shrink-0 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast outside ToastProvider')
  return context
}
