import { hmac256, safeEqual, sha256 } from './utils.mjs'

export function keyFingerprint(key) {
  return key ? sha256(key).slice(0, 12) : 'none'
}

export function hashApiKey(key, pepper) {
  return hmac256(pepper, key)
}

export function createAuth(config, db) {
  return {
    async authenticate(headers) {
      const authorization = headers.authorization || ''
      const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
      const key = bearer || headers['x-api-key']
      if (!key) return null

      if (config.bootstrapApiKey && safeEqual(key, config.bootstrapApiKey)) {
        return { id: 'bootstrap', scopes: ['*'], site_ids: null, bootstrap: true }
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
      return row
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
