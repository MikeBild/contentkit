import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './primitives'

// shadcn-shaped, vendored: same reason as primitives.tsx, plus one of its own —
// the console had five hand-built `fixed inset-0 z-50` modals and not one of
// them handled Escape or kept the focus inside. Radix would bring a portal we
// do not need (nothing here clips or transforms) in exchange for a dependency
// tree; the two behaviours that were actually missing are below.

const panelVariants = cva(
  'relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl',
  {
    variants: {
      size: {
        sm: 'max-w-md',
        default: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-4xl',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

// A sheet is the same dialog anchored to an edge: same trap, same Escape, same
// labelling. Splitting them into two components would have duplicated all of it.
const sheetVariants = cva(
  'relative flex flex-col overflow-hidden border-border bg-surface shadow-xl inset-y-0 h-dvh w-full max-w-xl',
  {
    variants: {
      side: {
        right: 'ml-auto border-l',
        left: 'mr-auto border-r',
      },
    },
    defaultVariants: { side: 'right' },
  },
)

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Escape closes, Tab cycles inside, and focus returns to whatever opened the
 * dialog. The last part matters more than it looks: without it a keyboard
 * operator who closes a row's dialog is dropped back at the top of the
 * document and has to walk the whole list again.
 */
function useModalBehaviour(open: boolean, onClose: () => void, panel: React.RefObject<HTMLDivElement | null>) {
  const opener = useRef<Element | null>(null)
  // The close handler is read through a ref rather than listed as a dependency.
  // Callers routinely pass a fresh arrow on every render, and this effect is not
  // idempotent: re-running it restores focus to the opener and then moves it to
  // the panel's first control. In a dialog holding a controlled input that fires
  // once per keystroke, so the caret leaves the field after the first character
  // — and a Space typed into a name then activates the close button instead.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close.current()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return
      const targets = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      )
      if (targets.length === 0) return
      const first = targets[0]!
      const last = targets[targets.length - 1]!
      if (document.activeElement !== (event.shiftKey ? first : last)) return
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }

    document.addEventListener('keydown', onKeyDown, true)
    const restore = opener.current
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (restore instanceof HTMLElement && document.contains(restore)) restore.focus()
    }
  }, [open, panel])
}

interface OverlayProps {
  open: boolean
  onClose: () => void
  /** Names the dialog for assistive technology and titles the header. */
  title: string
  description?: ReactNode
  footer?: ReactNode
  /** A busy dialog refuses to close by backdrop or Escape: the work is mid-flight. */
  busy?: boolean
  children?: ReactNode
  className?: string
  'data-testid'?: string
}

function Overlay({
  open,
  onClose,
  title,
  description,
  footer,
  busy,
  children,
  panelClassName,
  testId,
  align,
}: OverlayProps & { panelClassName: string; testId: string; align: string }) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const close = useCallback(() => {
    if (!busy) onClose()
  }, [busy, onClose])
  useModalBehaviour(open, close, panel)

  if (!open) return null
  return (
    <div
      className={cn('fixed inset-0 z-50 flex bg-black/40', align)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-testid={testId}
        className={panelClassName}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 id={titleId} className="text-sm font-semibold tracking-tight">
              {title}
            </h2>
            {description ? (
              <div id={descriptionId} className="mt-1 text-sm text-muted-foreground">
                {description}
              </div>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            data-testid={`${testId}-close`}
            disabled={busy}
            onClick={close}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-border p-4">{footer}</footer> : null}
      </div>
    </div>
  )
}

export function Dialog({
  size,
  className,
  'data-testid': testId = 'ck-dialog',
  ...props
}: OverlayProps & VariantProps<typeof panelVariants>) {
  return (
    <Overlay
      {...props}
      align="items-center justify-center p-4"
      panelClassName={cn(panelVariants({ size }), className)}
      testId={testId}
    />
  )
}

export function Sheet({
  side,
  className,
  'data-testid': testId = 'ck-sheet',
  ...props
}: OverlayProps & VariantProps<typeof sheetVariants>) {
  return (
    <Overlay {...props} align="" panelClassName={cn(sheetVariants({ side }), className)} testId={testId} />
  )
}

/** The row a dialog's footer almost always wants: cancel on the left, act on the right. */
export function DialogActions({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex justify-end gap-2', className)} {...props} />
}
