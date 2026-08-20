import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { RouteError } from '@/app/crash'
import { Shell } from '@/app/shell'
import { ToastProvider } from '@/components/ui/toast'
import { SiteProvider } from '@/lib/site'
import { AccessPage } from '@/pages/access'
import { AssistantPage } from '@/pages/assistant'
import { AudioPage } from '@/pages/audio'
import { AuditPage } from '@/pages/audit'
import { CompositionsPage } from '@/pages/compositions'
import { ContentPage } from '@/pages/content'
import { CredentialsPage } from '@/pages/credentials'
import { DecksPage } from '@/pages/decks'
import { DecisionsPage } from '@/pages/decisions'
import { ModerationPage } from '@/pages/moderation'
import { OverviewPage } from '@/pages/overview'
import { ProfilePage } from '@/pages/profile'
import { PublishedPage } from '@/pages/published'
import { ReleasesPage } from '@/pages/releases'
import { SiteSettingsPage } from '@/pages/site-settings'
import { SitesPage } from '@/pages/sites'
import { SystemPage } from '@/pages/system'
import { WebhooksPage } from '@/pages/webhooks'

/** Every route carries the selected site; nothing below the root may drop it. */
export interface RootSearch {
  site?: string
  /** Durable review selected by an MCP/browser review hand-off. */
  promotion_review?: string
  /** A bounded intent, never arbitrary prompt text in the URL. */
  assistant_intent?: 'draft-capture'
}

// The provider reads and writes `?site=` through the router, so it lives inside
// it — above the Shell, below the RouterProvider.
function Root() {
  return (
    <SiteProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </SiteProvider>
  )
}

// Code-based routing: sixteen static routes need no file-convention plugin,
// and the site is selected in the sidebar rather than carried in every path.
const rootRoute = createRootRoute({
  component: Root,
  // Unrecognised params are dropped rather than rejected: a bookmark carrying a
  // filter a later version removed still opens the page it names.
  validateSearch: (search: Record<string, unknown>): RootSearch => ({
    ...(typeof search.site === 'string' && search.site ? { site: search.site } : {}),
    ...(typeof search.promotion_review === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search.promotion_review)
      ? { promotion_review: search.promotion_review }
      : {}),
    ...(search.assistant_intent === 'draft-capture' ? { assistant_intent: 'draft-capture' as const } : {}),
  }),
})

const routes = [
  ['/', OverviewPage],
  ['/decisions', DecisionsPage],
  // The registry and one site's settings are two routes on purpose: the site
  // switcher governs the second and plays no part in the first.
  ['/sites', SitesPage],
  ['/settings', SiteSettingsPage],
  ['/content', ContentPage],
  ['/published', PublishedPage],
  ['/compositions', CompositionsPage],
  ['/decks', DecksPage],
  ['/releases', ReleasesPage],
  ['/audio', AudioPage],
  ['/access', AccessPage],
  ['/webhooks', WebhooksPage],
  ['/moderation', ModerationPage],
  ['/credentials', CredentialsPage],
  ['/audit', AuditPage],
  ['/assistant', AssistantPage],
  ['/profile', ProfilePage],
  ['/system', SystemPage],
] as const

const routeTree = rootRoute.addChildren(
  routes.map(([path, component]) => createRoute({ getParentRoute: () => rootRoute, path, component })),
)

// ContentKit serves the bundle under /cockpit/ and falls back to index.html for
// unknown paths there, so the router owns everything below that prefix.
// A thrown render is caught at every level and answered by the console's own
// screen rather than by the router's built-in one — English, unstyled, and
// without a way back (see app/crash.tsx and LOCAL-CK-ART-UNBEKANNT). This is the
// net, not the fix: a page that throws is still a defect, and the fix belongs
// where it throws.
export const router = createRouter({ routeTree, basepath: '/cockpit', defaultErrorComponent: RouteError })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
