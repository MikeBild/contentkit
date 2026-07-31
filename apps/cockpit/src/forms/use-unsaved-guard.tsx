import { useBlocker } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'

/**
 * Stops a navigation away from unsaved work, and asks rather than decides.
 *
 * Two exits have to be covered and they are covered by different mechanisms.
 * `shouldBlockFn` catches in-app navigation — the sidebar, a row link, the back
 * button — and `enableBeforeUnload` catches closing the tab or following a link
 * out, where the browser owns the dialog and the wording, and no amount of
 * effort changes either.
 *
 * A site switch counts as leaving: the same form on another site is a different
 * record, and letting it through silently would discard the edits just as
 * completely as a route change.
 *
 * The dialog offers three answers because there are three: go back to the form,
 * leave and lose the edits, or save and then leave. A two-button version forces
 * the operator to cancel, save, and navigate again — which is how people learn
 * to click "leave" without reading.
 */
export function useUnsavedGuard({
  when,
  onSave,
  isSaving,
}: {
  when: boolean
  /** Offered as "Save and leave". Omitted, the dialog has two answers. */
  onSave?: () => Promise<unknown>
  isSaving?: boolean
}) {
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      current.routeId !== next.routeId ||
      current.pathname !== next.pathname ||
      (current.search as { site?: string }).site !== (next.search as { site?: string }).site,
    enableBeforeUnload: () => when,
    disabled: !when,
    withResolver: true,
  })

  const prompt =
    blocker.status === 'blocked' ? (
      <Dialog
        open
        onOpenChange={(next) => {
          // A save that is still in the air is not a save that can be taken
          // back, and the navigation it was going to unblock is not settled
          // either: the only thing that ends this dialog then is the answer.
          if (isSaving) return
          if (!next) blocker.reset()
        }}
      >
        <DialogContent
          data-testid="ck-unsaved-guard"
          className="sm:max-w-md"
          closeDisabled={isSaving}
          onEscapeKeyDown={(event) => {
            if (isSaving) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (isSaving) event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              Leaving now discards everything changed on this page since the last save.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" data-testid="ck-unsaved-stay" disabled={isSaving} onClick={blocker.reset}>
              Stay
            </Button>
            <Button
              variant="destructive"
              size="sm"
              data-testid="ck-unsaved-discard"
              disabled={isSaving}
              onClick={blocker.proceed}
            >
              Discard and leave
            </Button>
            {onSave ? (
              <Button
                size="sm"
                data-testid="ck-unsaved-save"
                disabled={isSaving}
                onClick={async () => {
                  // `false` is a failed save, and it is the only way either caller
                  // reports one: use-form's save() returns false on a validation
                  // error and on a rejected request, and site-settings' attemptSave()
                  // does the same. Neither throws. So a try/catch alone saw every
                  // failure as a success and called proceed() — navigating away and
                  // discarding the very edits the operator had just asked to keep,
                  // in the two most write-heavy pages in the console.
                  //
                  // Anything other than `false` is success, so a caller that resolves
                  // with nothing still works; only an explicit refusal keeps us here.
                  let saved: unknown = false
                  try {
                    saved = await onSave()
                  } catch {
                    // A thrown failure reported itself through its own error path.
                    return
                  }
                  if (saved === false) return
                  blocker.proceed()
                }}
              >
                {isSaving ? <Spinner data-icon="inline-start" /> : null}
                {isSaving ? 'Saving…' : 'Save and leave'}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ) : null

  return { prompt, isBlocked: blocker.status === 'blocked' }
}
