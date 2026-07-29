import { createContext, useContext } from 'react'
import type { OperatorSession } from '@/api/ck'

/**
 * Who the operator is, and what they may do — with no view attached.
 *
 * `lib/` is the base layer every other layer imports, so it must not import
 * back out of it. The component that fetches the session and blocks the console
 * until it is known lives in components/session-gate.tsx; only the context and
 * the two questions asked of it belong here.
 */
export const SessionContext = createContext<OperatorSession | null>(null)

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
