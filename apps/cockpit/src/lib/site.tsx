import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ck, type Site } from '@/api/ck'
import { keys } from '@/lib/query'

const STORAGE_KEY = 'ck-cockpit-site'

interface SiteSelection {
  site: string
  setSite: (site: string) => void
  sites: Site[]
  isLoading: boolean
  error: unknown
}

const SiteContext = createContext<SiteSelection | null>(null)

/**
 * Nearly every route is site-scoped, so the site is picked once in the sidebar
 * rather than threaded through fifteen route paths.
 *
 * The list comes from GET /v1/sites, which reports what this credential may
 * read. An earlier version derived it from the grant's `site_ids` instead —
 * but an empty `site_ids` means "every site", not "no sites", so an
 * unrestricted administrator got an empty switcher and a console where every
 * page said "choose a site". The grant says what you may reach, never what
 * exists.
 */
export function SiteProvider({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: keys.sites.all, queryFn: () => ck.sites.list(), staleTime: 60_000 })
  const sites = useMemo(() => query.data ?? [], [query.data])
  const [site, setSiteState] = useState(() => localStorage.getItem(STORAGE_KEY) || '')

  // Land on something real without overriding a deliberate choice: keep the
  // remembered site when it still exists, otherwise fall back to the first.
  useEffect(() => {
    if (sites.length === 0) return
    const known = sites.some((candidate) => candidate.slug === site || candidate.id === site)
    if (known) return
    const next = sites[0]
    if (next) {
      setSiteState(next.slug)
      localStorage.setItem(STORAGE_KEY, next.slug)
    }
  }, [sites, site])

  const setSite = useCallback((next: string) => {
    localStorage.setItem(STORAGE_KEY, next)
    setSiteState(next)
  }, [])

  const value = useMemo(
    () => ({ site, setSite, sites, isLoading: query.isPending, error: query.error }),
    [site, setSite, sites, query.isPending, query.error],
  )
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}

export function useSite() {
  const context = useContext(SiteContext)
  if (!context) throw new Error('useSite outside SiteProvider')
  return context
}
