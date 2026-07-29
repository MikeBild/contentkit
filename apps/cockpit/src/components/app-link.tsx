import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'

/**
 * A `Link` that carries the selected site forward.
 *
 * TanStack replaces the search on navigation, so a plain `<Link to="/content">`
 * silently drops `?site=`. The provider would then re-pick from localStorage
 * and the operator would land on a different site than the one they were
 * looking at — and the URL they copy would send someone else somewhere else
 * again. Every in-app link goes through here; only a link that deliberately
 * changes the site passes its own `search`.
 */
type LinkProps = ComponentProps<typeof Link>

// The reducer's parameter type is resolved per route, and AppLink is deliberately
// route-agnostic: it only ever reads and re-emits one key.
const carrySite = ((previous: Record<string, unknown>) =>
  previous.site ? { site: previous.site } : {}) as unknown as LinkProps['search']

export function AppLink({ search, ...props }: LinkProps) {
  return <Link {...props} search={search ?? carrySite} />
}
