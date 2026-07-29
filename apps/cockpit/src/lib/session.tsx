import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, type ReactNode } from 'react'
import { ck, type OperatorSession } from '@/api/ck'
import { ApiError, setCsrfToken } from '@/api/client'
import { Button } from '@/components/ui/primitives'

const SessionContext = createContext<OperatorSession | null>(null)

export function useSession() {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession outside SessionGate')
  return session
}

/**
 * Scope-gating in one place. `authorize()` on the server has no hierarchy —
 * site:admin implies none of the read scopes — so the console must ask about
 * the exact scope a route needs, never about a role.
 */
export function useCan() {
  const session = useSession()
  return (scope: string) => session.product_scopes.includes(scope)
}

/** Blocks the whole console until the session is known: no half-authenticated UI. */
export function SessionGate({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const session = await ck.identity.session()
      // Every later mutation echoes this back in X-Contentkit-Csrf.
      setCsrfToken(session.csrf_token)
      return session
    },
    retry: (count, error) => !(error instanceof ApiError && error.isUnauthenticated) && count < 2,
    // The session slides on use server-side; refetching on focus keeps the
    // console from discovering an expired session only at the next mutation.
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  })

  if (query.isPending) {
    return <Splash>Signing in…</Splash>
  }

  if (query.error instanceof ApiError && query.error.isUnauthenticated) {
    const returnTo = window.location.pathname + window.location.search
    // A 401 means "no session", which covers both a first visit and an expired
    // one. The console cannot tell them apart — the cookie is HttpOnly — so it
    // says the one thing that is true either way.
    return (
      <Splash>
        <p className="text-muted-foreground">Sign in to continue.</p>
        <Button onClick={() => window.location.assign(ck.identity.loginUrl(returnTo))}>Sign in</Button>
      </Splash>
    )
  }

  if (query.error) {
    return (
      <Splash>
        <p className="text-chart-5">{query.error instanceof Error ? query.error.message : 'Sign-in failed'}</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          Try again
        </Button>
      </Splash>
    )
  }

  return <SessionContext.Provider value={query.data}>{children}</SessionContext.Provider>
}

function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="text-sm font-semibold tracking-[0.2em] text-muted-foreground">CONTENTKIT COCKPIT</div>
      {children}
    </div>
  )
}
