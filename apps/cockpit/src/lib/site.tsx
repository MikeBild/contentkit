import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { ck, type Site } from '@/api/ck'
import { keys } from '@/lib/query'

const STORAGE_KEY = 'ck-cockpit-site'

interface SiteSelection {
  /** The slug. Every path parameter named `site` accepts it. */
  site: string
  setSite: (site: string) => void
  /** The selected row, once the list has loaded — the only source of the site's id. */
  current: Site | undefined
  /**
   * The uuid. Query filters named `site_id` want this, not the slug, so a page
   * reads it here instead of re-deriving it from `sites` at every call site.
   */
  siteId: string
  sites: Site[]
  isLoading: boolean
  error: unknown
}

const SiteContext = createContext<SiteSelection | null>(null)

/**
 * Nearly every route is site-scoped, so the site is picked once in the sidebar
 * rather than threaded through fifteen route paths.
 *
 * It lives in the URL as `?site=<slug>` all the same. A selection that exists
 * only in React state makes every link mean something different for the person
 * who receives it — the sender's "this comment" is the recipient's whichever
 * site their localStorage remembers. The search param is the truth;
 * localStorage only supplies the opening guess for a visit that names no site.
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
  // strict: false — the provider wraps the whole route tree and has to read the
  // same param whichever route is matched.
  const search = useSearch({ strict: false }) as { site?: string }
  const navigate = useNavigate()
  const site = search.site ?? ''

  const select = useCallback(
    (next: string, replace: boolean) => {
      localStorage.setItem(STORAGE_KEY, next)
      // `to: '.'` rewrites the search of the current route, so switching sites
      // never navigates away from the page the operator is looking at.
      void navigate({
        to: '.',
        search: ((previous: Record<string, unknown>) => ({ ...previous, site: next })) as never,
        replace,
      })
    },
    [navigate],
  )

  // Land on something real without overriding a deliberate choice: keep the
  // named site while it exists, otherwise the remembered one, otherwise the
  // first. It replaces rather than pushes, so the back button never walks into
  // a URL naming a site that is gone.
  useEffect(() => {
    if (sites.length === 0) return
    const known = (candidate: string) => sites.some((entry) => entry.slug === candidate || entry.id === candidate)
    if (site && known(site)) return
    const remembered = localStorage.getItem(STORAGE_KEY) || ''
    const next = known(remembered) ? remembered : sites[0]?.slug
    if (next) select(next, true)
  }, [sites, site, select])

  const current = useMemo(() => sites.find((entry) => entry.slug === site || entry.id === site), [sites, site])

  const value = useMemo(
    () => ({
      site,
      setSite: (next: string) => select(next, false),
      current,
      siteId: current?.id ?? '',
      sites,
      isLoading: query.isPending,
      error: query.error,
    }),
    [site, select, current, sites, query.isPending, query.error],
  )
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}

export function useSite() {
  const context = useContext(SiteContext)
  if (!context) throw new Error('useSite outside SiteProvider')
  return context
}
