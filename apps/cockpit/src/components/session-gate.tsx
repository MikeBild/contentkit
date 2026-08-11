import { useQuery } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { type ReactNode } from 'react'
import { ck } from '@/api/ck'
import { ApiError, setCsrfToken } from '@/api/client'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { SessionContext } from '@/lib/session'
import { useI18n } from '@/lib/i18n-context'

/** Blocks the whole console until the session is known: no half-authenticated UI. */
export function SessionGate({ children }: { children: ReactNode }) {
  const { t } = useI18n()
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
    return <Splash>{t('session.loading')}</Splash>
  }

  if (query.error instanceof ApiError && query.error.isUnauthenticated) {
    const returnTo = window.location.pathname + window.location.search
    // A 401 means "no session", which covers both a first visit and an expired
    // one. The console cannot tell them apart — the cookie is HttpOnly — so it
    // says the one thing that is true either way.
    return (
      <Splash>
        <p className="text-muted-foreground">{t('session.continue')}</p>
        <Button data-testid="sign-in" onClick={() => window.location.assign(ck.identity.loginUrl(returnTo))}>
          {t('session.signIn')}
        </Button>
      </Splash>
    )
  }

  if (query.error) {
    return (
      <Splash>
        {/* An Alert rather than red text: this is the one screen with nothing
            else on it, so the failure has to read as a failure without a
            surrounding page to contrast against — and `role="alert"` announces
            it, which a coloured paragraph never did. */}
        <Alert variant="destructive" data-testid="session-error" className="max-w-md">
          {/* Direct child, before the title: the CVA re-grids on `has-[>svg]`. */}
          <TriangleAlert />
          <AlertTitle>{t('session.failed')}</AlertTitle>
          <AlertDescription data-testid="session-error-message">
            {query.error instanceof Error ? query.error.message : t('session.unreachable')}
          </AlertDescription>
        </Alert>
        <Button data-testid="session-retry" variant="outline" onClick={() => query.refetch()}>
          {t('common.retry')}
        </Button>
      </Splash>
    )
  }

  return <SessionContext.Provider value={query.data}>{children}</SessionContext.Provider>
}

function Splash({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div data-testid="session-splash" className="flex h-full flex-col items-center justify-center gap-4">
      <div className="text-sm font-semibold tracking-[0.2em] text-muted-foreground">
        {t('app.name')} {t('nav.label')}
      </div>
      {children}
    </div>
  )
}
