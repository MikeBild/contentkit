import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { AppLink } from '@/components/app-link'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useI18n } from '@/lib/i18n-context'

/**
 * What the operator sees when a page throws.
 *
 * WHY THIS FILE EXISTS
 *
 * It did not, and the default took over: TanStack Router's own `ErrorComponent`
 * renders `Something went wrong!` beside a `Show Error` toggle, unstyled, in
 * English, with no way anywhere. That screen is three convention breaches at
 * once — §5 wants German on the top level, §6 wants the console's own surfaces,
 * §4 wants an error that names the way back — and it is what an unknown decision
 * kind actually produced (LOCAL-CK-ART-UNBEKANNT).
 *
 * WHY IT CARRIES TWO WAYS OUT AND NOT ONE
 *
 * `reset` re-renders the same route. That is the right button when the fault was
 * transient and the wrong one when the page throws on every render — which is
 * exactly the class of fault this screen was built for. So the link to the
 * overview stands beside it: one control retries, the other leaves. A screen
 * with only a retry on a deterministically broken page is a dead end wearing a
 * button (§4).
 *
 * WHY THE MESSAGE IS SHOWN AT ALL, AND WHY IT IS FOLDED AWAY
 *
 * The words above are for the operator; the message is for whoever is asked to
 * fix it, and asking them to reproduce it with the console open is worse than
 * printing it. It stays folded because a stack fragment is not the first thing a
 * page should say, and it stays in mono because it is a machine value (CK-F3).
 */
export function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n()
  const [shown, setShown] = useState(false)
  const detail = error instanceof Error ? error.message : String(error)

  return (
    <div data-testid="route-error" className="mx-auto flex w-full max-w-2xl flex-col p-4 sm:p-6">
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-10 rounded-full bg-destructive/10 text-destructive">
            <TriangleAlert className="size-5" />
          </EmptyMedia>
          <EmptyTitle>{t('crash.title')}</EmptyTitle>
          <EmptyDescription>{t('crash.description')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button data-testid="route-error-retry" size="sm" onClick={reset}>
              {t('crash.retry')}
            </Button>
            <Button size="sm" variant="outline" asChild>
              <AppLink data-testid="route-error-home" to="/">
                {t('crash.home')}
              </AppLink>
            </Button>
          </div>
          {detail ? (
            <div className="flex w-full flex-col items-center gap-2">
              <Button
                data-testid="route-error-detail-toggle"
                variant="ghost"
                size="sm"
                aria-expanded={shown}
                className="h-auto py-1 text-xs text-muted-foreground"
                onClick={() => setShown((open) => !open)}
              >
                {shown ? t('common.hide') : t('crash.detail')}
              </Button>
              {shown ? (
                <pre
                  data-testid="route-error-detail"
                  className="w-full overflow-auto rounded-md border bg-muted/40 p-3 text-left font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground"
                >
                  {detail}
                </pre>
              ) : null}
            </div>
          ) : null}
        </EmptyContent>
      </Empty>
    </div>
  )
}
