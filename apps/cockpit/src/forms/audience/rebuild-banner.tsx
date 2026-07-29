import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { ck } from '@/api/ck'
import { Confirm } from '@/components/confirm'
import { Button } from '@/components/ui/primitives'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'

const STORAGE_PREFIX = 'ck-cockpit-rebuild-required:'

/**
 * Rules are draft state: the server answers `rebuild_required: true` and then
 * does nothing else about it. Until a release is built, the live site still
 * enforces the previous rules — so an operator who locks a path down, sees the
 * row appear and navigates away has protected nothing.
 *
 * The flag therefore outlives the page. It is per-site and kept in
 * localStorage, because a reload is exactly the moment the memory of "I still
 * owe a build" is lost.
 */
export function useRebuildRequired(site: string) {
  const storageKey = `${STORAGE_PREFIX}${site}`
  const [required, setRequired] = useState(() => (site ? localStorage.getItem(storageKey) === 'true' : false))

  const mark = useCallback(() => {
    if (!site) return
    localStorage.setItem(storageKey, 'true')
    setRequired(true)
  }, [site, storageKey])

  const clear = useCallback(() => {
    localStorage.removeItem(storageKey)
    setRequired(false)
  }, [storageKey])

  return { required, mark, clear }
}

export function RebuildBanner({ site, onBuilt }: { site: string; onBuilt: () => void }) {
  const can = useCan()
  const client = useQueryClient()

  const build = useMutation({
    mutationFn: () => ck.releases.create(site, { reason: 'Access rules changed' }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.releases(site) })
      onBuilt()
    },
  })

  return (
    <div
      data-testid="ck-rebuild-banner"
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-chart-3/30 bg-chart-3/10 p-4"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-chart-3">The live site is still serving the previous rules</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Access rules are snapshotted into a release. Everything changed here is a draft until <strong>{site}</strong>{' '}
          is built again.
          {build.error ? (
            <span data-testid="ck-rebuild-error" className="block text-chart-5">
              {build.error instanceof Error ? build.error.message : 'The build failed'}
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" size="sm" data-testid="ck-rebuild-dismiss" onClick={onBuilt}>
          Dismiss
        </Button>
        {can('release:write') ? (
          <Confirm
            title="Build and activate a release?"
            description={
              <>
                This builds every published revision of <strong>{site}</strong> with the current access rules and
                activates the result. The live site changes as soon as the build succeeds.
              </>
            }
            confirmLabel="Build and activate"
            onConfirm={() => build.mutateAsync()}
          >
            {(open) => (
              <Button size="sm" data-testid="ck-rebuild-build" disabled={build.isPending} onClick={open}>
                {build.isPending ? 'Building…' : 'Build release'}
              </Button>
            )}
          </Confirm>
        ) : null}
      </div>
    </div>
  )
}
