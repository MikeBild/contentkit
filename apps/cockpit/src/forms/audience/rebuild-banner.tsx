import { useMutation, useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { useCallback, useState } from 'react'
import { ck } from '@/api/ck'
import { Confirm } from '@/components/confirm'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { keys } from '@/lib/query'
import { useCan } from '@/lib/session'
import { useI18n } from '@/lib/i18n-context'

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
  const { t } = useI18n()
  const can = useCan()
  const client = useQueryClient()

  const build = useMutation({
    mutationFn: () => ck.releases.create(site, { reason: t('audience.rebuild.reason') }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.releases(site) })
      onBuilt()
    },
  })

  return (
    // An `Alert`, not a `div` painted amber: the callout already carries
    // `role="alert"`, its own border and the two-column grid the icon needs, and
    // `AlertAction` is where the buttons belong. Nothing here names a colour.
    <Alert data-testid="ck-rebuild-banner" className="mb-4">
      <TriangleAlert />
      <AlertTitle>{t('audience.rebuild.title')}</AlertTitle>
      <AlertDescription>
        {t('audience.rebuild.description', { site })}
        {build.error ? (
          <span data-testid="ck-rebuild-error" className="block">
            {build.error instanceof Error ? build.error.message : t('audience.rebuild.error')}
          </span>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" data-testid="ck-rebuild-dismiss" onClick={onBuilt}>
            {t('audience.rebuild.dismiss')}
          </Button>
          {can('release:write') ? (
            <Confirm
              title={t('audience.rebuild.confirmTitle')}
              description={t('audience.rebuild.confirmDescription', { site })}
              confirmLabel={t('audience.rebuild.confirm')}
              onConfirm={() => build.mutateAsync()}
            >
              {(open) => (
                <Button size="sm" data-testid="ck-rebuild-build" disabled={build.isPending} onClick={open}>
                  {build.isPending ? <Spinner data-icon="inline-start" /> : null}
                  {t('audience.rebuild.build')}
                </Button>
              )}
            </Confirm>
          ) : null}
        </div>
      </AlertAction>
    </Alert>
  )
}
