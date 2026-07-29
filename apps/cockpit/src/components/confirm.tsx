import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/primitives'

/**
 * Every mutation in the console goes through this.
 *
 * ContentKit's MCP surface refuses to publish, activate, unpublish or touch a
 * credential without a native human confirmation, and the model is explicitly
 * forbidden from inferring one. The console holds itself to the same bar: the
 * dialog names the exact target and effect, and dismissing it changes nothing.
 */
export function Confirm({
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
  children,
}: {
  title: string
  description: ReactNode
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => Promise<unknown> | unknown
  children: (open: () => void) => ReactNode
}) {
  const [isOpen, setOpen] = useState(false)
  const [isBusy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      setOpen(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The operation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {children(() => {
        setError(null)
        setOpen(true)
      })}
      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(event) => {
            if (event.target === event.currentTarget && !isBusy) setOpen(false)
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl">
            <h2 className="text-sm font-semibold">{title}</h2>
            <div className="mt-2 text-sm text-muted-foreground">{description}</div>
            {error ? <p className="mt-3 text-sm text-chart-5">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={isBusy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant={destructive ? 'destructive' : 'default'}
                size="sm"
                disabled={isBusy}
                onClick={run}
              >
                {isBusy ? 'Working…' : confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
