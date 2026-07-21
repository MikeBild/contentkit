import { hmac256, safeEqual, sha256 } from './utils.mjs'
import { effectiveProductScopes, roleOauthScopes } from './oauth/policy.mjs'

export function keyFingerprint(key) {
  return key ? sha256(key).slice(0, 12) : 'none'
}

export function hashApiKey(key, pepper) {
  return hmac256(pepper, key)
}

export function createAuth(config, db) {
  return {
    async authenticate(headers) {
      const read = (name) => headers?.get?.(name) ?? headers?.[name] ?? headers?.[name.toLowerCase()]
      const authorization = typeof headers === 'string' ? headers : read('authorization') || ''
      const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
      const key = bearer || (typeof headers === 'string' ? headers : read('x-api-key'))
      if (!key) return null

      if (String(key).startsWith('cko_') && config.oauthSecret && db.query) {
        const rows = await db.query(
          `SELECT t.id, t.scopes, t.site_ids AS token_site_ids, t.grant_id, g.role, g.product_scopes,
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
          scopes: effectiveProductScopes(
            token.scopes.filter((scope) => roleOauthScopes(token.role).includes(scope)),
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
