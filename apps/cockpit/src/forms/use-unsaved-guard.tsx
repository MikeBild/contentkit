import { useBlocker } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

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
        size="sm"
        data-testid="ck-unsaved-guard"
        title="Unsaved changes"
        description="Leaving now discards everything changed on this page since the last save."
        onClose={blocker.reset}
        busy={isSaving}
        footer={
          <>
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
                  try {
                    await onSave()
                  } catch {
                    // The save failed and said so through its own error path.
                    // Staying put is the only safe outcome: proceeding here
                    // would discard the very edits the operator asked to keep.
                    return
                  }
                  blocker.proceed()
                }}
              >
                {isSaving ? 'Saving…' : 'Save and leave'}
              </Button>
            ) : null}
          </>
        }
      />
    ) : null

  return { prompt, isBlocked: blocker.status === 'blocked' }
}
