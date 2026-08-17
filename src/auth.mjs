import { hmac256, safeEqual, sha256 } from './utils.mjs'
import { effectiveProductScopes, oauthTiersForCeiling, PRODUCT_SCOPES } from './oauth/policy.mjs'
import { loadOperatorSession, operatorCookieToken } from './oauth/operator-session.mjs'

function headerValue(headers, name) {
  if (typeof headers === 'string') return null
  return headers?.get?.(name) ?? headers?.[name] ?? headers?.[name.toLowerCase()] ?? null
}

// A credential arrives either as `Authorization: Bearer <key>` or as `x-api-key`.
// Both authentication and logging must read it the same way: fingerprinting the
// raw Authorization header alone logged `none` for every x-api-key caller and
// hashed "Bearer <key>" rather than the key, so the two transports produced
// different fingerprints for one key.
export function credentialFromHeaders(headers) {
  if (typeof headers === 'string') return headers.match(/^Bearer\s+(.+)$/i)?.[1] || headers
  const read = (name) => headers?.get?.(name) ?? headers?.[name] ?? headers?.[name.toLowerCase()]
  const authorization = read('authorization') || ''
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1] || read('x-api-key') || null
}

export function keyFingerprint(key) {
  return key ? sha256(key).slice(0, 12) : 'none'
}

export function hashApiKey(key, pepper) {
  return hmac256(pepper, key)
}

export function createAuth(config, db) {
  async function operatorPrincipal(headers) {
    const token = operatorCookieToken(headerValue(headers, 'cookie'), config)
    if (!token) return null
    const session = await loadOperatorSession(db, config, token)
    if (!session) return null
    const ceiling = session.product_scopes || []
    return {
      id: `operator:${session.grant_id}`,
      credential_id: `operator-session:${session.id}`,
      name: session.display_name || session.email || 'Operator',
      // No consent step stands between the human and their grant here, so the
      // session carries the grant's whole live ceiling. Routing it through the
      // tier round-trip keeps one definition of "what a ceiling yields" shared
      // with the OAuth token path instead of a second, drifting filter.
      scopes: ceiling.includes('*')
        ? [...PRODUCT_SCOPES]
        : effectiveProductScopes(oauthTiersForCeiling(ceiling), ceiling),
      site_ids: session.grant_site_ids || [],
      grant_id: session.grant_id,
      operator_session_id: session.id,
      subject: session.subject,
      email: session.email,
      via: 'operator_session',
      oauth: false,
      bootstrap: false,
    }
  }

  return {
    async authenticate(headers) {
      const key = credentialFromHeaders(headers)
      // A browser never holds a key: the Cockpit authenticates with the same
      // HttpOnly operator-session cookie the consent funnel already issues. It
      // is checked only when no explicit credential was sent, so a request that
      // carries a key keeps being judged by that key alone.
      if (!key) return await operatorPrincipal(headers)

      if (String(key).startsWith('cko_') && config.oauthSecret && db.query) {
        const rows = await db.query(
          `SELECT t.id, t.scopes, t.site_ids AS token_site_ids, t.grant_id, g.product_scopes,
                  g.site_ids AS grant_site_ids,
                  g.subject, g.display_name
             FROM ck_oauth_access_tokens t
             JOIN ck_oauth_identity_grants g ON g.id = t.grant_id
            WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()
              AND t.resource = $2
              AND g.revoked_at IS NULL
              AND (
                g.provider_id <> 'api-key'
                OR (
                  g.source_pepper_fingerprint = $4
                  AND (
                    (g.subject = 'bootstrap' AND g.source_credential_hash = $3)
                    OR EXISTS (
                      SELECT 1 FROM ck_api_keys k
                       WHERE k.id::text = g.subject
                         AND k.key_hash = g.source_credential_hash
                         AND k.revoked_at IS NULL
                         AND (k.expires_at IS NULL OR k.expires_at > now())
                    )
                  )
                )
              )
            LIMIT 1`,
          [
            hmac256(config.oauthSecret, key),
            `${config.publicUrl}/mcp`,
            config.bootstrapApiKey ? hmac256(config.keyPepper || config.oauthSecret, config.bootstrapApiKey) : '',
            sha256(config.keyPepper || ''),
          ],
        )
        const token = rows[0]
        if (!token) return null
        if (db.update)
          db.update(
            'ck_oauth_identity_grants',
            { id: `eq.${token.grant_id}` },
            { last_used_at: new Date().toISOString() },
            { returning: false },
          ).catch(() => {})
        const tokenSites = token.token_site_ids || []
        const grantSites = token.grant_site_ids || []
        const siteIds =
          tokenSites.length && grantSites.length
            ? tokenSites.filter((id) => grantSites.includes(id))
            : tokenSites.length
              ? tokenSites
              : grantSites
        return {
          id: `oauth:${token.grant_id}`,
          credential_id: `oauth-token:${token.id}`,
          name: token.display_name || 'OAuth operator',
          // The live product-scope ceiling of the grant row is the only truth:
          // consented tiers are re-checked against the tiers the ceiling
          // yields right now, so an admin edit takes effect on the very next
          // request without reissuing the token.
          scopes: effectiveProductScopes(
            token.scopes.filter((scope) => oauthTiersForCeiling(token.product_scopes).includes(scope)),
            token.product_scopes,
          ),
          oauth_scopes: token.scopes,
          site_ids: siteIds,
          grant_id: token.grant_id,
          oauth: true,
          bootstrap: false,
        }
      }

      if (config.bootstrapApiKey && safeEqual(key, config.bootstrapApiKey)) {
        return { id: 'bootstrap', name: 'Bootstrap operator', scopes: ['*'], site_ids: null, bootstrap: true }
      }
      if (!config.keyPepper) return null

      const keyHash = hashApiKey(key, config.keyPepper)
      const rows = await db.select('ck_api_keys', {
        key_hash: `eq.${keyHash}`,
        revoked_at: 'is.null',
        limit: '1',
      })
      const row = rows[0]
      if (!row) return null
      if (row.expires_at && new Date(row.expires_at) <= new Date()) return null
      db.update('ck_api_keys', { id: `eq.${row.id}` }, { last_used_at: new Date().toISOString() }).catch(() => {})
      return { ...row, name: row.name || row.key_prefix || 'API key', bootstrap: false }
    },

    authorize(principal, scope, siteId = null) {
      if (!principal) return false
      const scopes = principal.scopes || []
      if (!scopes.includes('*') && !scopes.includes(scope)) return false
      const siteIds = principal.site_ids
      return !siteId || !Array.isArray(siteIds) || siteIds.length === 0 || siteIds.includes(siteId)
    },
  }
}
