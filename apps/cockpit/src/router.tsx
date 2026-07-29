import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Shell } from '@/app/shell'
import { AssistantPage } from '@/pages/assistant'
import { AudioPage, CompositionsPage, DecksPage, PublishedPage, SystemPage } from '@/pages/authoring'
import { ContentPage } from '@/pages/content'
import { AccessPage, AuditPage, CredentialsPage, ModerationPage, WebhooksPage } from '@/pages/governance'
import { OverviewPage } from '@/pages/overview'
import { ReleasesPage } from '@/pages/releases'
import { SitesPage } from '@/pages/sites'

// Code-based routing: fifteen static routes need no file-convention plugin,
// and the site is selected in the sidebar rather than carried in every path.
const rootRoute = createRootRoute({ component: Shell })

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
