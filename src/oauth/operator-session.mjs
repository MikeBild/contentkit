import { parseCookies } from '../access.mjs'
import { hmac256 } from '../utils.mjs'

// An operator session is the browser-side counterpart of an OAuth access token:
// both resolve to the same identity grant, so both must answer to the same live
// product-scope ceiling. The consent funnel in ./server.mjs creates them and the
// Cockpit in ../routes.mjs authenticates with them, which is why the lookup
// lives here rather than inside either caller's closure.
export const OPERATOR_IDLE_MS = 8 * 60 * 60 * 1000
export const OPERATOR_ABSOLUTE_MS = 24 * 60 * 60 * 1000

export function operatorCookieName(config) {
  return new URL(config.publicUrl).protocol === 'https:' ? '__Host-contentkit_operator' : 'contentkit_operator'
}

export function operatorCookieToken(cookieHeader, config) {
  return parseCookies(cookieHeader || '')[operatorCookieName(config)] || ''
}

export function operatorTokenHash(config, value) {
  return hmac256(config.oauthSecret, value)
}

// Returns the session row joined to its grant, or null when the cookie is
// unknown, expired, revoked or its grant was revoked. Touching `last_used_at`
// and sliding `expires_at` is what makes the idle window a *sliding* one; the
// absolute expiry is deliberately never extended.
export async function loadOperatorSession(db, config, token) {
  if (!token || !config.oauthSecret || !db?.query) return null
  const rows = await db.query(
    `SELECT s.*, g.provider_id, g.issuer, g.subject, g.email, g.display_name,
            g.product_scopes, g.site_ids AS grant_site_ids
       FROM ck_operator_sessions s
       JOIN ck_oauth_identity_grants g ON g.id = s.grant_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND g.revoked_at IS NULL
        AND s.expires_at > now() AND s.absolute_expires_at > now()
      LIMIT 1`,
    [operatorTokenHash(config, token)],
  )
  const session = rows[0]
  if (!session) return null
  await db.update(
    'ck_operator_sessions',
    { id: `eq.${session.id}` },
    { last_used_at: new Date().toISOString(), expires_at: new Date(Date.now() + OPERATOR_IDLE_MS).toISOString() },
    { returning: false },
  )
  await db
    .update(
      'ck_oauth_identity_grants',
      { id: `eq.${session.grant_id}` },
      { last_used_at: new Date().toISOString() },
      { returning: false },
    )
    .catch(() => {})
  return session
}
