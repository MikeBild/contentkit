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

const TIER_PRODUCT_SCOPES = {
  'mcp:read': ['content:read', 'stats:read'],
  'mcp:authoring': ['content:read', 'stats:read', 'content:write', 'deck:render', 'release:preview'],
  'mcp:admin': PRODUCT_SCOPES,
}

// The stored product-scope ceiling is the only truth of a grant; mcp:* tiers
// are derived from it at consent/token time and never persisted. A tier is
// offered when the ceiling would give it at least one product scope:
// mcp:read for any read scope, mcp:authoring for any authoring-only scope and
// mcp:admin for any scope outside the authoring bundle.
export function oauthTiersForCeiling(productScopes, configured = MCP_OAUTH_SCOPES) {
  const ceiling = new Set(productScopes || [])
  const authoringBundle = new Set(TIER_PRODUCT_SCOPES['mcp:authoring'])
  const wildcard = ceiling.has('*')
  const tiers = new Set()
  if (wildcard || TIER_PRODUCT_SCOPES['mcp:read'].some((scope) => ceiling.has(scope))) tiers.add('mcp:read')
  if (wildcard || ['content:write', 'deck:render', 'release:preview'].some((scope) => ceiling.has(scope)))
    tiers.add('mcp:authoring')
  if (wildcard || PRODUCT_SCOPES.some((scope) => ceiling.has(scope) && !authoringBundle.has(scope)))
    tiers.add('mcp:admin')
  return MCP_OAUTH_SCOPES.filter((scope) => tiers.has(scope) && configured.includes(scope))
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

/**
 * Whether a principal may act on a credential or grant scoped to `siteIds`.
 *
 * Empty `site_ids` means global in ContentKit, so a site-restricted
 * administrator must name a non-empty subset of their own ceiling; otherwise a
 * CRUD helper could mint or reveal a cross-tenant credential. This is the
 * containment boundary itself, and it lived as two byte-identical copies — one
 * in routes.mjs, one in mcp/tools.mjs — which is one copy too many for a rule
 * that decides what one tenant can see of another.
 */
export function withinPrincipalSites(principal, siteIds) {
  const ceiling = Array.isArray(principal?.site_ids) ? principal.site_ids : []
  if (!ceiling.length) return true
  return Array.isArray(siteIds) && siteIds.length > 0 && siteIds.every((id) => ceiling.includes(id))
}

function fail(statusCode, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra })
}

const GRANT_ROLES = ['reader', 'author', 'admin']

// ---------------------------------------------------------------------------
// Credential and identity administration.
//
// REST (routes.mjs) and MCP (mcp/tools.mjs) are two doors into one admin
// domain. They used to hold a copy each of these rules and had already drifted:
// an omitted `scopes` minted a one-scope key through one door and a five-scope
// key through the other. Every rule below is therefore stated exactly once and
// both doors call it; each door keeps only what is genuinely its own —
// transport, confirmation and response encoding.
// ---------------------------------------------------------------------------

// What a key carries when the caller names no scopes. The two surfaces
// disagreed here; the narrow set wins, because a key minted wider than its
// creator intended cannot be un-issued, while a key minted too narrow only
// fails loudly on first use.
export const DEFAULT_API_KEY_SCOPES = Object.freeze(['content:write'])

/**
 * Validate an API-key creation request and return the row input to persist.
 *
 * `authorize(scope)` is the caller's own scope predicate — the surfaces differ
 * in transport, never in what a principal is allowed to hand out.
 */
export function resolveApiKeyCreate(principal, input = {}, authorize = () => true) {
  const scopes = input.scopes ? [...input.scopes] : [...DEFAULT_API_KEY_SCOPES]
  const siteIds = input.site_ids || []
  if (scopes.includes('*')) throw fail(403, 'cannot grant the * (global) scope')
  if (!Array.isArray(scopes) || scopes.some((scope) => !PRODUCT_SCOPES.includes(scope)))
    throw fail(422, 'scopes contains an unsupported product scope')
  // The bootstrap credential provisions the first keys of an installation and
  // is by definition above every ceiling.
  if (!principal?.bootstrap) {
    if (principal?.oauth && scopes.some((scope) => !authorize(scope)))
      throw fail(403, 'cannot grant product scopes above the OAuth identity ceiling')
    if (!withinPrincipalSites(principal, siteIds)) throw fail(403, 'key must be scoped to your own site(s)')
  }
  return { name: input.name, scopes, site_ids: siteIds, expires_at: input.expires_at }
}

export async function listApiKeys(db, principal) {
  const rows = await db.select('ck_api_keys', { order: 'created_at.desc' })
  return rows.filter((row) => withinPrincipalSites(principal, row.site_ids)).map(({ key_hash, ...row }) => row)
}

// Separate from the revoke itself: MCP asks the operator to confirm between the
// two, and a grant it may not see must 404 before anything is shown to them.
export async function requireApiKey(db, principal, id) {
  const [target] = await db.select('ck_api_keys', { id: `eq.${id}`, limit: '1' })
  if (!target || !withinPrincipalSites(principal, target.site_ids)) throw fail(404, 'API key not found')
  return target
}

export async function revokeApiKey(db, id) {
  const [row] = await db.update(
    'ck_api_keys',
    { id: `eq.${id}`, revoked_at: 'is.null' },
    { revoked_at: new Date().toISOString() },
  )
  if (!row) throw fail(404, 'API key not found')
  return row
}

export async function listIdentityGrants(db, principal, filter = {}) {
  const rows = await db.select('ck_oauth_identity_grants', {
    ...(filter.provider_id ? { provider_id: `eq.${filter.provider_id}` } : {}),
    ...(filter.subject ? { subject: `eq.${filter.subject}` } : {}),
    order: 'created_at.desc',
  })
  return rows.filter((row) => withinPrincipalSites(principal, row.site_ids)).map(publicIdentityGrant)
}

// restore:true is the only way to reach a revoked row; every other write
// matches live rows only.
export async function requireIdentityGrant(db, principal, id, { restore = false } = {}) {
  const [existing] = await db.select('ck_oauth_identity_grants', {
    id: `eq.${id}`,
    revoked_at: restore ? 'not.is.null' : 'is.null',
    limit: '1',
  })
  if (!existing || !withinPrincipalSites(principal, existing.site_ids)) throw fail(404, 'identity grant not found')
  return existing
}

// role XOR product_scopes. A named role is a shorthand the server expands once
// into a complete scope replacement; the stored truth is always the
// product-scope ceiling and role stays a denormalized display value derived
// from it.
function resolveGrantScopes(input, { required }) {
  if (input.role !== undefined && input.product_scopes !== undefined)
    throw fail(422, 'role and product_scopes are mutually exclusive')
  if (required && input.role === undefined && input.product_scopes === undefined)
    throw fail(422, 'either role or product_scopes is required')
  if (input.role !== undefined && !GRANT_ROLES.includes(input.role))
    throw fail(422, `role must be ${GRANT_ROLES.join(', ')}`)
  if (input.role === undefined && input.product_scopes === undefined) return null
  const scopes = input.role !== undefined ? defaultProductScopes(input.role) : input.product_scopes
  if (!Array.isArray(scopes) || scopes.some((scope) => !PRODUCT_SCOPES.includes(scope)))
    throw fail(422, 'product_scopes contains an unsupported scope')
  return scopes
}

// Who manages the row from now on: the seeder stamps its own rows, and any
// other write is a manual takeover the seeder skips from then on.
function grantSource(input) {
  if (input.source !== undefined && input.source !== 'seed') throw fail(422, "source accepts only 'seed'")
  return input.source === 'seed' ? 'seed' : 'admin'
}

export async function createIdentityGrant(db, principal, input = {}, providers = []) {
  const provider = providers.find((entry) => entry.protocol !== 'api_key' && entry.id === input.provider_id)
  if (!provider || provider.issuer !== input.issuer)
    throw fail(422, 'provider_id and issuer must match a configured identity provider')
  if (!input.subject) throw fail(422, 'subject is required')
  const productScopes = resolveGrantScopes(input, { required: true })
  const source = grantSource(input)
  const siteIds = Array.isArray(input.site_ids) ? input.site_ids : []
  if (!withinPrincipalSites(principal, siteIds))
    throw fail(403, 'identity grant must be restricted to your own site(s)')
  try {
    const [row] = await db.insert('ck_oauth_identity_grants', {
      provider_id: provider.id,
      issuer: provider.issuer,
      subject: String(input.subject),
      email: input.email || null,
      display_name: input.display_name || '',
      role: roleForProductScopes(productScopes),
      product_scopes: productScopes,
      site_ids: siteIds,
      grant_source: source,
    })
    return row
  } catch (error) {
    // ck_oauth_identity_grants_provider_id_issuer_subject_key: one grant per
    // identity, revoked rows included — a duplicate is a client conflict, never
    // a server error.
    if (error?.code !== '23505') throw error
    const [existing] = await db.select('ck_oauth_identity_grants', {
      provider_id: `eq.${provider.id}`,
      issuer: `eq.${provider.issuer}`,
      subject: `eq.${String(input.subject)}`,
      limit: '1',
    })
    const id = existing ? existing.id : '{id}'
    const hint = existing?.revoked_at
      ? `a revoked grant for this identity already exists (id ${id}); PATCH /v1/identity-grants/${id} with restore:true revives it`
      : `a grant for this identity already exists (id ${id}); use PATCH /v1/identity-grants/${id} to change it`
    throw fail(409, hint, { code: 'identity_grant_exists', id: existing?.id || null, hint })
  }
}

export async function updateIdentityGrant(db, principal, id, input = {}) {
  const restore = input.restore === true
  const patch = Object.fromEntries(
    Object.entries(input).filter(([key]) =>
      ['email', 'display_name', 'role', 'product_scopes', 'site_ids'].includes(key),
    ),
  )
  const productScopes = resolveGrantScopes(patch, { required: false })
  if (productScopes) {
    patch.product_scopes = productScopes
    patch.role = roleForProductScopes(productScopes)
  }
  patch.grant_source = grantSource(input)
  if (patch.site_ids && !withinPrincipalSites(principal, patch.site_ids))
    throw fail(403, 'identity grant must stay inside your own site(s)')
  const [row] = await db.update(
    'ck_oauth_identity_grants',
    { id: `eq.${id}`, revoked_at: restore ? 'not.is.null' : 'is.null' },
    { ...patch, ...(restore ? { revoked_at: null } : {}), updated_at: new Date().toISOString() },
  )
  if (!row) throw fail(404, 'identity grant not found')
  return row
}

// Revoking the grant must revoke everything minted from it, or a withdrawn
// operator keeps working until their access token happens to expire.
export async function revokeIdentityGrant(db, id) {
  const now = new Date().toISOString()
  const [row] = await db.update(
    'ck_oauth_identity_grants',
    { id: `eq.${id}`, revoked_at: 'is.null' },
    { revoked_at: now, updated_at: now },
  )
  if (!row) throw fail(404, 'identity grant not found')
  for (const table of ['ck_operator_sessions', 'ck_oauth_access_tokens', 'ck_oauth_refresh_tokens']) {
    await db.update(
      table,
      { grant_id: `eq.${row.id}`, revoked_at: 'is.null' },
      { revoked_at: now },
      { returning: false },
    )
  }
  return row
}
