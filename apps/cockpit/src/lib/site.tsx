import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useSession } from '@/lib/session'

const STORAGE_KEY = 'ck-cockpit-site'

interface SiteSelection {
  site: string
  setSite: (site: string) => void
  /** Sites this operator's grant is limited to; empty means every site. */
  allowed: string[]
}

const SiteContext = createContext<SiteSelection | null>(null)

/**
 * Nearly every route is site-scoped, so the site is picked once in the sidebar
 * rather than threaded through fifteen route paths. It is remembered across
 * reloads because an operator works inside one site for a long stretch.
 */
export function SiteProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  const allowed = session.site_ids
  const [site, setSiteState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY) || ''
    if (stored && (allowed.length === 0 || allowed.includes(stored))) return stored
    return allowed[0] ?? ''
  })

  const setSite = useCallback((next: string) => {
    localStorage.setItem(STORAGE_KEY, next)
    setSiteState(next)
  }, [])

  const value = useMemo(() => ({ site, setSite, allowed }), [site, setSite, allowed])
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}

export function useSite() {
  const context = useContext(SiteContext)
  if (!context) throw new Error('useSite outside SiteProvider')
  return context
}
