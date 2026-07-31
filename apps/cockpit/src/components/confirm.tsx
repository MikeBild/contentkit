import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'

/**
 * Every mutation in the console goes through this.
 *
 * ContentKit's MCP surface refuses to publish, activate, unpublish or touch a
 * credential without a native human confirmation, and the model is explicitly
 * forbidden from inferring one: decline, cancel, timeout or an unsupported
 * elicitation all make no change. The console holds itself to the same bar, and
 * that sentence is only true if the dialog is a real one. `AlertDialog` is what
 * makes it real — the hand-rolled `<div aria-modal="true">` this replaces
 * claimed the role and enforced none of it:
 *
 *  - **Escape cancels**, and a click outside does nothing at all. An alert
 *    dialog has no light-dismiss, which is the point: a confirmation that a
 *    stray click can answer is not a confirmation. The old div dismissed on any
 *    click on the backdrop and never listened for a key.
 *  - **Focus is trapped, and on close it lands where the operator can carry on
 *    working — never on `<body>`.** The trap is Radix's. Where focus goes
 *    afterwards is `restoreFocus` below, and it has to answer three shapes,
 *    because this console produces all three:
 *      1. the trigger is still mounted and can take focus — it gets it back;
 *      2. the trigger is still mounted but disabled (`disabled={isPending}`
 *         outliving the close by a refetch or a toast) — focus goes to the
 *         structure the trigger lived in, and back to the trigger itself the
 *         moment it can take it, unless the operator has moved or typed first;
 *      3. the trigger is gone, deleted with the row it sat in — which is the
 *         ordinary destructive path, not an edge: focus goes to that same
 *         structure and stays there, because there is nothing else honest to
 *         point at and the next Tab is the row that took the deleted one's place.
 *    Shapes 2 and 3 both end on the nearest ancestor, captured while the dialog
 *    opened, that a screen reader announces as something — a table, a list, a
 *    form, a dialog, a landmark — and never on whichever node happens to accept
 *    focus first. The one case this does not cover is a trigger with no such
 *    ancestor left on screen: then focus is left where the browser put it, and
 *    that is a call site to fix rather than a promise to bend.
 *  - **The refusal is announced.** A server that declines is the one thing here
 *    an operator must not miss, and it was red text nobody was told about; it is
 *    an `Alert` now, whose `role="alert"` reaches a screen reader the moment it
 *    appears, and it is named in the dialog's own `aria-describedby` so a reader
 *    that arrives after the announcement still gets the reason and its counts.
 *  - **Nothing is dismissed mid-flight.** While the mutation is in the air the
 *    dialog refuses to close: the result is what closes it, and a request whose
 *    outcome is unknown must not leave the screen claiming to have been cancelled.
 *
 * Each of those four — and each of the three focus shapes separately, including
 * the deleted row and the trigger that re-enables late — is covered by a test in
 * `confirm.test.tsx` that drives the component and then asks the DOM
 * (`document.activeElement`, `getByRole`), so the claims above are graded as
 * behaviour rather than read as prose.
 *
 * What has not changed is the sentence in front of the operator: the dialog
 * names the exact target and effect, and dismissing it changes nothing.
 *
 * The API is unchanged too — `title`, `description`, `confirmLabel`,
 * `destructive`, `onConfirm` and a `children(open)` render prop — so all 25 call
 * sites, every delete, every credential issue and every unpublish, are untouched
 * by this rebuild. The trigger stays the caller's own control rather than an
 * `AlertDialogTrigger`, because it is the caller's `data-testid`, `disabled` and
 * scope check that belong on it.
 */
/**
 * An ancestor the call site nominates itself, for a trigger whose meaningful
 * neighbour is not the nearest announced one. Nothing in the console needs it
 * today; it exists so that a call site with an unusual shape has an answer that
 * is not "widen the selector below and hope".
 */
const NOMINATED_ANCHOR = '[data-focus-anchor]'

/**
 * What counts as somewhere to put focus when the trigger cannot take it.
 *
 * Every entry is an element a screen reader announces as *something* — "table",
 * "list", "form", "dialog", "main" — so an operator who has just lost their
 * control is told where they now are instead of being dropped on an anonymous
 * `<div>` that reads as nothing. `[tabindex]` is here because an author who put
 * one on an ancestor has already declared it a focus target.
 *
 * A `<table>` with no accessible name still qualifies: a reader says "table, 5
 * columns, 12 rows", which is a position. A `<div className="rounded-xl border">`
 * does not qualify, which is the point — it is the nearest surviving ancestor of
 * every trigger in this console and it would make the promise meaningless.
 */
const ANNOUNCED_ANCHOR = [
  '[tabindex]',
  'table',
  'form',
  'dialog',
  'nav',
  'main',
  'section[aria-label]',
  'section[aria-labelledby]',
  // Unquoted, because a quoted attribute value here reads as this component
  // *setting* a role, which is exactly what it must never do — the roles below
  // are ones it looks for on somebody else's element. CSS treats an identifier
  // and a quoted string identically in an attribute selector.
  ...['table', 'grid', 'treegrid', 'list', 'listbox', 'feed', 'form', 'dialog', 'alertdialog', 'region', 'navigation', 'main'].map(
    (role) => `[role=${role}]`,
  ),
].join(',')

/**
 * Focus `element` and report whether it actually took it.
 *
 * A detached node, a `disabled` control and an `inert` subtree all refuse
 * silently — `focus()` returns nothing either way — so the document is the only
 * witness. Every decision below turns on this answer rather than on inspecting
 * attributes, because the list of reasons an element declines focus is longer
 * than any check would be.
 */
function focusOn(element: HTMLElement) {
  if (!element.isConnected) return false
  element.focus()
  return document.activeElement === element
}

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

  const effectId = useId()
  const refusalId = useId()

  /**
   * The control focus has to go back to: whatever had it when the dialog opened,
   * which for every call site is the trigger the operator just pressed.
   *
   * Radix normally needs no help here — `FocusScope` remembers the previously
   * focused element and restores it on unmount. What defeats it is one line in
   * `@radix-ui/react-dialog`'s modal content: its own `onCloseAutoFocus`
   * *cancels* that restore (`event.preventDefault()`) and focuses
   * `context.triggerRef.current` instead. That ref is only ever set by
   * `AlertDialogTrigger`, and this component deliberately does not use one — the
   * trigger is the caller's control, with the caller's `data-testid`, `disabled`
   * and scope check on it. So the ref is `null`, the `?.` swallows the call, and
   * focus lands on `<body>`: no restore, and the built-in one already cancelled.
   *
   * Radix composes the caller's handler first and skips its own once the event is
   * default-prevented, so preventing it below takes that line out of the path
   * entirely and hands the restore to the one place that has the element.
   */
  const restoreTo = useRef<HTMLElement | null>(null)
  /**
   * The trigger's ancestors, captured **while the dialog opens** rather than
   * when it closes, and that timing is the whole reason this ref exists.
   *
   * Deleting a site removes the `<TableRow>` the trigger sits in. From that
   * moment `trigger.parentElement` still walks — up through the `<td>` and the
   * `<tr>` — but into a detached fragment that is nowhere on screen, and it stops
   * dead where React unhooked the row. The `<table>` the operator is still
   * looking at is not reachable from the trigger at all any more. Read at open
   * time, the chain runs all the way to `<body>` and the surviving links can be
   * told apart afterwards by `isConnected`.
   */
  const lineage = useRef<HTMLElement[]>([])
  const retry = useRef<number | null>(null)
  /** Tears down the hand-back watcher; null when nothing is watching. */
  const stopWatching = useRef<(() => void) | null>(null)

  useEffect(
    () => () => {
      if (retry.current !== null) window.clearTimeout(retry.current)
      stopWatching.current?.()
    },
    [],
  )

  /**
   * Put focus on the structure the trigger lived in.
   *
   * Nearest first, so a row's delete button lands on its own table rather than
   * on the page landmark twelve levels up: the closer the anchor, the smaller the
   * distance the operator has to re-cross. The `tabindex="-1"` is added only to
   * make the element focusable programmatically and removed again on blur — an
   * anchor left carrying one would put a `<table>` into the Tab order of every
   * page that renders it, which is a different bug traded for this one.
   */
  function park(chain: HTMLElement[]) {
    const anchor =
      chain.find((element) => element.isConnected && element.matches(NOMINATED_ANCHOR)) ??
      chain.find((element) => element.isConnected && element.matches(ANNOUNCED_ANCHOR))
    if (!anchor) return null
    if (anchor.hasAttribute('tabindex')) return focusOn(anchor) ? anchor : null

    anchor.setAttribute('tabindex', '-1')
    if (!focusOn(anchor)) {
      anchor.removeAttribute('tabindex')
      return null
    }
    anchor.addEventListener('blur', () => anchor.removeAttribute('tabindex'), { once: true })
    return anchor
  }

  /**
   * Wait for a trigger that is still mounted to become able to take focus, and
   * hand it back when it does.
   *
   * The window is behavioural, not a timer: it ends when the operator does
   * anything at all — a key, a pointer, a focus move away from where focus was
   * parked — because a jump back to a control they have stopped looking at is a
   * steal, however well meant. It also ends when the trigger is removed, and on
   * unmount. So the hand-back can only happen while the operator is still exactly
   * where the close left them, which is the only moment it is an improvement.
   */
  function watchForHandBack(target: HTMLElement, anchor: HTMLElement) {
    const observer = new MutationObserver(() => {
      if (!target.isConnected || document.activeElement !== anchor) return stop()
      if (focusOn(target)) stop()
    })
    const onFocusIn = (event: FocusEvent) => {
      if (event.target !== anchor) stop()
    }
    const onOperatorInput = () => stop()
    function stop() {
      stopWatching.current = null
      observer.disconnect()
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('keydown', onOperatorInput, true)
      document.removeEventListener('pointerdown', onOperatorInput, true)
    }

    observer.observe(target, {
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'inert', 'tabindex'],
    })
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('keydown', onOperatorInput, true)
    document.addEventListener('pointerdown', onOperatorInput, true)
    stopWatching.current = stop
  }

  function restoreFocus() {
    const target = restoreTo.current
    const chain = lineage.current
    restoreTo.current = null
    lineage.current = []
    if (retry.current !== null) window.clearTimeout(retry.current)
    stopWatching.current?.()
    if (!target) return

    // Shape 1: the trigger is there and takes it. Every non-destructive
    // confirmation in the console ends here.
    if (focusOn(target)) return

    // Shape 3: the trigger went out with the row it sat in, which is what
    // deleting anything from a list looks like. A detached node never comes
    // back, so there is nothing to wait for — the list it was deleted from is
    // the answer, immediately.
    if (!target.isConnected) {
      park(chain)
      return
    }

    // Shape 2: mounted but refusing focus, which in this console means
    // `<Button disabled={mutation.isPending}>` with `isPending` not yet cleared.
    // Usually it clears in the same breath as the close, so one macrotask is all
    // it takes and the operator never sees the intermediate step. Only when it
    // does not — a chained invalidation, a queued toast, a slow refetch — does
    // focus go to the structure instead, and then it is handed back if and when
    // the trigger can take it.
    retry.current = window.setTimeout(() => {
      retry.current = null
      // Anything else having taken focus in the meantime is a deliberate move —
      // a reopened dialog, a toast action — and is never stolen from.
      const stranded = document.activeElement === null || document.activeElement === document.body
      if (!stranded) return
      if (focusOn(target)) return
      const anchor = park(chain)
      if (anchor && target.isConnected) watchForHandBack(target, anchor)
    }, 0)
  }

  async function run() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      setOpen(false)
    } catch (failure) {
      // The server's own words, verbatim: a 409 carries the counts that make the
      // refusal actionable ("still has 2 published and 1 scheduled content
      // item(s)"), and a summary of it would throw exactly those away.
      setError(failure instanceof Error ? failure.message : 'The operation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {children(() => {
        const active = document.activeElement
        const trigger = active instanceof HTMLElement && active !== document.body ? active : null
        restoreTo.current = trigger
        // Read now, not on close: see `lineage`. `<body>` ends the walk — it is
        // an ancestor of everything and a position in nothing.
        const chain: HTMLElement[] = []
        for (let node = trigger?.parentElement ?? null; node && node !== document.body; node = node.parentElement) {
          chain.push(node)
        }
        lineage.current = chain
        setError(null)
        setOpen(true)
      })}
      <AlertDialog
        open={isOpen}
        onOpenChange={(next) => {
          // A request that is still in the air is not a request that can be
          // taken back, so the only thing that closes the dialog then is its
          // answer.
          if (isBusy) return
          if (!next) setError(null)
          setOpen(next)
        }}
      >
        <AlertDialogContent
          data-testid="confirm-dialog"
          // Radix points this at the description alone; a refusal has to be part
          // of what describes the dialog too, or the reason is announced once and
          // then unreachable to a reader that re-reads the box.
          aria-describedby={error ? `${effectId} ${refusalId}` : effectId}
          onEscapeKeyDown={(event) => {
            if (isBusy) event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            restoreFocus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="confirm-title">{title}</AlertDialogTitle>
            <AlertDialogDescription id={effectId} data-testid="confirm-description">{description}</AlertDialogDescription>
          </AlertDialogHeader>

          {/* The server's own words, in the one place the operator is looking.
              `Alert` carries `role="alert"`, so this is heard as well as seen —
              and it does not replace the description: what was going to happen is
              still on screen next to why it did not. `aria-atomic` keeps the
              refusal one utterance, so the counts arrive with the sentence they
              belong to rather than as a fragment. */}
          {error ? (
            <Alert variant="destructive" id={refusalId} aria-atomic="true" data-testid="confirm-error">
              <TriangleAlert aria-hidden />
              <AlertTitle>The server refused</AlertTitle>
              <AlertDescription data-testid="confirm-error-message">{error}</AlertDescription>
            </Alert>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel data-testid="confirm-cancel" size="sm" disabled={isBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-accept"
              size="sm"
              variant={destructive ? 'destructive' : 'default'}
              disabled={isBusy}
              aria-busy={isBusy}
              // Focus does not move on a refusal, so this is the control the
              // operator is standing on when it lands: describing it with the
              // refusal means tabbing back to it says why it failed.
              aria-describedby={error ? refusalId : undefined}
              // Radix closes on this click; the mutation has not answered yet, so
              // the close is refused here and the answer is what closes it — a
              // dialog that vanished on click would report success it has not had.
              onClick={(event) => {
                event.preventDefault()
                void run()
              }}
            >
              {isBusy ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
