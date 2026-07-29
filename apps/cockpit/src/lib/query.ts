import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      // Retrying a 401/403 just burns requests: neither becomes true by being
      // asked again. Everything else gets two capped attempts.
      retry: (count, error) =>
        !(error instanceof ApiError && (error.isUnauthenticated || error.isForbidden)) && count < 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    },
  },
})

// One hierarchical factory so an invalidation can target a single row or a
// whole resource without any page inventing its own key shape.
export const keys = {
  session: ['session'] as const,
  sites: {
    all: ['sites'] as const,
    detail: (site: string) => ['sites', site] as const,
  },
  content: {
    list: (site: string, query?: unknown) => ['content', site, query ?? null] as const,
    revisions: (item: string) => ['content', 'revisions', item] as const,
  },
  published: {
    list: (site: string, query?: unknown) => ['published', site, query ?? null] as const,
    detail: (site: string, kind: string, locale: string, slug: string) =>
      ['published', site, kind, locale, slug] as const,
  },
  releases: (site: string) => ['releases', site] as const,
  stats: (site: string, kind: string, window?: unknown) => ['stats', site, kind, window ?? null] as const,
  access: {
    users: (site: string) => ['access', site, 'users'] as const,
    groups: (site: string) => ['access', site, 'groups'] as const,
    rules: (site: string) => ['access', site, 'rules'] as const,
  },
  webhooks: {
    list: (site: string) => ['webhooks', site] as const,
    deliveries: (query?: unknown) => ['webhook-deliveries', query ?? null] as const,
  },
  moderation: {
    comments: (query?: unknown) => ['comments', query ?? null] as const,
    contact: (query?: unknown) => ['contact-submissions', query ?? null] as const,
    feedback: ['feedback'] as const,
  },
  credentials: {
    apiKeys: ['api-keys'] as const,
    grants: ['identity-grants'] as const,
  },
  audit: (query?: unknown) => ['audit-events', query ?? null] as const,
  audio: {
    jobs: (site: string) => ['audio-jobs', site] as const,
  },
  patterns: (query?: unknown) => ['composition-patterns', query ?? null] as const,
  guides: ['publishing-guides'] as const,
  deckThemes: ['deck-themes'] as const,
  deckTemplates: ['deck-templates'] as const,
  system: ['system'] as const,
}
