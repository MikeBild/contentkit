export const MCP_OAUTH_SCOPES = ['mcp:read', 'mcp:authoring', 'mcp:admin']

export const PRODUCT_SCOPES = [
  'content:read',
  'content:write',
  'deck:render',
  'release:preview',
  'release:write',
  'site:admin',
  'access:admin',
  'webhook:admin',
  'api-key:admin',
  'identity:admin',
  'moderation:write',
  'audit:read',
  'stats:read',
]

const ROLE_SCOPES = {
  reader: ['mcp:read'],
  author: ['mcp:read', 'mcp:authoring'],
  admin: ['mcp:read', 'mcp:authoring', 'mcp:admin'],
}

const TIER_PRODUCT_SCOPES = {
  'mcp:read': ['content:read', 'stats:read'],
  'mcp:authoring': ['content:read', 'stats:read', 'content:write', 'deck:render', 'release:preview'],
  'mcp:admin': PRODUCT_SCOPES,
}

export function roleOauthScopes(role, configured = MCP_OAUTH_SCOPES) {
  const allowed = new Set(ROLE_SCOPES[role] || [])
  return MCP_OAUTH_SCOPES.filter((scope) => allowed.has(scope) && configured.includes(scope))
}

export function effectiveProductScopes(oauthScopes, ceiling = PRODUCT_SCOPES) {
  const granted = new Set()
  for (const scope of oauthScopes || []) for (const product of TIER_PRODUCT_SCOPES[scope] || []) granted.add(product)
  return [...new Set(ceiling || [])].filter((scope) => scope !== '*' && granted.has(scope))
}

export function roleForProductScopes(scopes = []) {
  const authorCeiling = new Set(TIER_PRODUCT_SCOPES['mcp:authoring'])
  if (scopes.includes('*') || scopes.some((scope) => PRODUCT_SCOPES.includes(scope) && !authorCeiling.has(scope)))
    return 'admin'
  if (scopes.some((scope) => ['content:write', 'deck:render'].includes(scope))) return 'author'
  return 'reader'
}

export function defaultProductScopes(role) {
  if (role === 'admin') return [...PRODUCT_SCOPES]
  if (role === 'author') return [...TIER_PRODUCT_SCOPES['mcp:authoring']]
  return [...TIER_PRODUCT_SCOPES['mcp:read']]
}

export function publicIdentityGrant(row) {
  if (!row) return row
  const safe = { ...row }
  delete safe.source_credential_hash
  delete safe.source_pepper_fingerprint
  return safe
}
