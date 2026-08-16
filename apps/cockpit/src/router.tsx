import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
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
  /** Exact immutable preview selected by an MCP/browser review hand-off. */
  promotion_release?: string
  /** SHA-256 digest the promote endpoint must match byte-for-byte. */
  promotion_manifest?: string
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
    ...(typeof search.promotion_release === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search.promotion_release)
      ? { promotion_release: search.promotion_release }
      : {}),
    ...(typeof search.promotion_manifest === 'string' && /^[0-9a-f]{64}$/.test(search.promotion_manifest)
      ? { promotion_manifest: search.promotion_manifest }
      : {}),
  }),
})

const routes = [
  ['/', OverviewPage],
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
export const router = createRouter({ routeTree, basepath: '/cockpit' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
