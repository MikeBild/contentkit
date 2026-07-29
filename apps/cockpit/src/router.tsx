import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Shell } from '@/app/shell'
import { ToastProvider } from '@/components/ui/toast'
import { SiteProvider } from '@/lib/site'
import { AssistantPage } from '@/pages/assistant'
import { AudioPage, CompositionsPage, DecksPage, PublishedPage, SystemPage } from '@/pages/authoring'
import { ContentPage } from '@/pages/content'
import { AccessPage, AuditPage, CredentialsPage, ModerationPage, WebhooksPage } from '@/pages/governance'
import { OverviewPage } from '@/pages/overview'
import { ReleasesPage } from '@/pages/releases'
import { SitesPage } from '@/pages/sites'

/** Every route carries the selected site; nothing below the root may drop it. */
export interface RootSearch {
  site?: string
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

// Code-based routing: fifteen static routes need no file-convention plugin,
// and the site is selected in the sidebar rather than carried in every path.
const rootRoute = createRootRoute({
  component: Root,
  // Unrecognised params are dropped rather than rejected: a bookmark carrying a
  // filter a later version removed still opens the page it names.
  validateSearch: (search: Record<string, unknown>): RootSearch =>
    typeof search.site === 'string' && search.site ? { site: search.site } : {},
})

const routes = [
  ['/', OverviewPage],
  ['/sites', SitesPage],
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
  ['/system', SystemPage],
] as const

const routeTree = rootRoute.addChildren(
  routes.map(([path, component]) => createRoute({ getParentRoute: () => rootRoute, path, component })),
)

// ContentKit serves the bundle under /cockpit/ and falls back to index.html for
// unknown paths there, so the router owns everything below that prefix.
export const router = createRouter({ routeTree, basepath: '/cockpit' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
