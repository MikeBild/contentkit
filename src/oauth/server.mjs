import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { parseCookies } from '../access.mjs'
import { decryptSecret, encryptSecret } from '../secrets.mjs'
import { hmac256, safeEqual, sha256 } from '../utils.mjs'
import { defaultProductScopes, MCP_OAUTH_SCOPES, roleForProductScopes, roleOauthScopes } from './policy.mjs'
import { finishOidcLogin, startOidcLogin, verifyOidcIdentityToken } from './oidc.mjs'
import { authHtmlResponse, renderApiKeyLogin, renderConsentPage, renderProviderChoice } from './ui.mjs'

const DCR_MAX_PER_MINUTE = 30
const FORM_MAX_BYTES = 64 * 1024
const OPERATOR_IDLE_MS = 8 * 60 * 60 * 1000
const OPERATOR_ABSOLUTE_MS = 24 * 60 * 60 * 1000
const AUTHORIZATION_RESPONSE_REPLAY_MS = 60 * 1000

class OAuthError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

class AuthorizationStateConsumed extends Error {}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

function oauthError(error) {
  const known = error instanceof OAuthError
  return json(
    { error: known ? error.code : 'server_error', error_description: known ? error.message : 'OAuth request failed' },
    known ? error.status : 500,
  )
}

function redirectError(uri, code, state) {
  const target = new URL(uri)
  target.searchParams.set('error', code)
  if (state) target.searchParams.set('state', state)
  return new Response(null, { status: 302, headers: { location: target.toString(), 'cache-control': 'no-store' } })
}

function decisionRedirect(target) {
  return new Response(null, { status: 303, headers: { location: target, 'cache-control': 'no-store' } })
}

function randomToken(prefix) {
  return `${prefix}${randomBytes(32).toString('base64url')}`
}

function tokenHash(config, value) {
  return hmac256(config.oauthSecret, value)
}

function resourceId(config) {
  return `${config.publicUrl}/mcp`
}

function bootstrapCredentialHash(config) {
  return config.bootstrapApiKey ? hmac256(config.keyPepper || config.oauthSecret, config.bootstrapApiKey) : ''
}

function isSafeRedirect(value) {
  try {
    const url = new URL(value)
    if (url.username || url.password || url.hash) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

async function form(request) {
  const length = Number(request.headers.get('content-length') || 0)
  if (length > FORM_MAX_BYTES) throw new OAuthError('invalid_request', 'request body too large', 413)
  const text = await request.text()
  if (Buffer.byteLength(text) > FORM_MAX_BYTES) throw new OAuthError('invalid_request', 'request body too large', 413)
  return new URLSearchParams(text)
}

function requestedScopes(raw, configured) {
  const requested = [
    ...new Set(
      String(raw || 'mcp:read')
        .split(/\s+/)
        .filter(Boolean),
    ),
  ]
  if (requested.some((scope) => !MCP_OAUTH_SCOPES.includes(scope) || !configured.includes(scope))) {
    throw new OAuthError('invalid_scope', 'one or more requested scopes are not supported')
  }
  return requested
}

function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url')
}

function validPkceVerifier(value) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(value)
}

function operatorCookie(config, token, maxAge = Math.floor(OPERATOR_IDLE_MS / 1000)) {
  const secure = new URL(config.publicUrl).protocol === 'https:'
  const name = secure ? '__Host-contentkit_operator' : 'contentkit_operator'
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function cookieToken(request, config) {
  const secure = new URL(config.publicUrl).protocol === 'https:'
  const cookies = parseCookies(request.headers.get('cookie') || '')
  return cookies[secure ? '__Host-contentkit_operator' : 'contentkit_operator'] || ''
}

function loginProviders(config) {
  return [...(config.oauthProviders || [])].sort(
    (left, right) => Number(left.protocol === 'api_key') - Number(right.protocol === 'api_key'),
  )
}

function oidcProvider(config, id) {
  return (config.oauthProviders || []).find((provider) => provider.protocol === 'oidc' && provider.id === id)
}

function csrf(config, sessionId, stateId, expires = Date.now() + 5 * 60 * 1000) {
  const value = String(expires)
  return `${value}.${hmac256(config.oauthSecret, `${sessionId}:${stateId}:${value}`)}`
}

function verifyCsrf(config, value, sessionId, stateId) {
  const [expires, signature] = String(value || '').split('.')
  if (!expires || !signature || Number(expires) < Date.now()) return false
  return safeEqual(signature, hmac256(config.oauthSecret, `${sessionId}:${stateId}:${expires}`))
}

export function createOAuthMount(config, { db, auth, audit, logger }) {
  const dcrBuckets = new Map()
  let cleanupTimer = null

  function dcrAllowed(request) {
    const address = config.trustProxy
      ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'proxy-unknown'
      : 'direct-clients'
    const now = Date.now()
    const current = dcrBuckets.get(address)
    if (!current || current.resetAt <= now) {
      dcrBuckets.set(address, { count: 1, resetAt: now + 60_000 })
      return true
    }
    if (current.count >= DCR_MAX_PER_MINUTE) return false
    current.count += 1
    return true
  }

  async function loadClient(id) {
    return (await db.select('ck_oauth_clients', { client_id: `eq.${id}`, revoked_at: 'is.null', limit: '1' }))[0]
  }

  async function loadState(raw, { includeConsumed = false } = {}) {
    if (!/^ckls_[A-Za-z0-9_-]{43}$/.test(raw || '')) return null
    const query = {
      state_hash: `eq.${tokenHash(config, raw)}`,
      limit: '1',
    }
    if (!includeConsumed) query.consumed_at = 'is.null'
    return (await db.select('ck_oauth_login_states', query))[0]
  }

  function replayDecision(state) {
    if (
      !state?.consumed_at ||
      !state.authorization_response_encrypted ||
      !state.authorization_response_expires_at ||
      new Date(state.authorization_response_expires_at) <= new Date()
    ) {
      throw new OAuthError('invalid_request', 'authorization state already used')
    }
    try {
      return decisionRedirect(decryptSecret(state.authorization_response_encrypted, config.oauthSecret))
    } catch {
      throw new OAuthError('invalid_request', 'authorization state already used')
    }
  }

  async function claimDecision(rawState, state, target, effect = async () => {}) {
    const now = Date.now()
    try {
      await db.tx(async (tx) => {
        const consumed = await tx.update(
          'ck_oauth_login_states',
          { id: `eq.${state.id}`, consumed_at: 'is.null' },
          {
            consumed_at: new Date(now).toISOString(),
            authorization_response_encrypted: encryptSecret(target, config.oauthSecret),
            authorization_response_expires_at: new Date(now + AUTHORIZATION_RESPONSE_REPLAY_MS).toISOString(),
          },
        )
        if (!consumed.length) throw new AuthorizationStateConsumed()
        await effect(tx)
      })
      return null
    } catch (error) {
      if (!(error instanceof AuthorizationStateConsumed)) throw error
      const current = await loadState(rawState, { includeConsumed: true })
      const response = replayDecision(current)
      logger?.info?.('oauth consent decision replayed', { client_id: state.client_id })
      return response
    }
  }

  async function loadGrant(id) {
    if (!id) return null
    return (
      await db.query(
        `SELECT g.*
           FROM ck_oauth_identity_grants g
          WHERE g.id = $1 AND g.revoked_at IS NULL
            AND (
              g.provider_id <> 'api-key'
              OR (
                g.source_pepper_fingerprint = $3
                AND (
                  (g.subject = 'bootstrap' AND g.source_credential_hash = $2)
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
        [id, bootstrapCredentialHash(config), sha256(config.keyPepper || '')],
      )
    )[0]
  }

  async function loadOperator(request) {
    const token = cookieToken(request, config)
    if (!token) return null
    const rows = await db.query(
      `SELECT s.*, g.provider_id, g.issuer, g.subject, g.email, g.display_name, g.role,
              g.product_scopes, g.site_ids AS grant_site_ids
         FROM ck_operator_sessions s
         JOIN ck_oauth_identity_grants g ON g.id = s.grant_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND g.revoked_at IS NULL
          AND s.expires_at > now() AND s.absolute_expires_at > now()
        LIMIT 1`,
      [tokenHash(config, token)],
    )
    const session = rows[0]
    if (!session) return null
    await db.update(
      'ck_operator_sessions',
      { id: `eq.${session.id}` },
      { last_used_at: new Date().toISOString(), expires_at: new Date(Date.now() + OPERATOR_IDLE_MS).toISOString() },
      { returning: false },
    )
    return session
  }

  async function createOperatorSession(grantId) {
    const token = randomToken('ckos_')
    const now = Date.now()
    const [row] = await db.insert('ck_operator_sessions', {
      grant_id: grantId,
      token_hash: tokenHash(config, token),
      expires_at: new Date(now + OPERATOR_IDLE_MS).toISOString(),
      absolute_expires_at: new Date(now + OPERATOR_ABSOLUTE_MS).toISOString(),
    })
    return { row, token }
  }

  async function upsertApiKeyGrant(principal) {
    const productScopes = (principal.scopes || []).filter((scope) => scope !== '*')
    const role = principal.bootstrap ? 'admin' : roleForProductScopes(productScopes)
    const ceiling = principal.bootstrap ? defaultProductScopes('admin') : productScopes
    const sourceCredentialHash = principal.bootstrap ? bootstrapCredentialHash(config) : principal.key_hash
    const sourcePepperFingerprint = sha256(config.keyPepper || '')
    if (!sourceCredentialHash) {
      throw new OAuthError('access_denied', 'an operator API key is required', 403)
    }
    const previous = (
      await db.select('ck_oauth_identity_grants', {
        provider_id: 'eq.api-key',
        issuer: `eq.${config.publicUrl}`,
        subject: `eq.${String(principal.id)}`,
        revoked_at: 'is.null',
        limit: '1',
      })
    )[0]
    const rows = await db.query(
      `INSERT INTO ck_oauth_identity_grants
         (provider_id, issuer, subject, display_name, role, product_scopes, site_ids,
          source_credential_hash, source_pepper_fingerprint, revoked_at, updated_at)
       VALUES ('api-key', $1, $2, $3, $4, $5, $6, $7, $8, NULL, now())
       ON CONFLICT (provider_id, issuer, subject) DO UPDATE
         SET display_name = excluded.display_name, role = excluded.role,
             product_scopes = excluded.product_scopes, site_ids = excluded.site_ids,
             source_credential_hash = excluded.source_credential_hash,
             source_pepper_fingerprint = excluded.source_pepper_fingerprint,
             updated_at = now()
         WHERE ck_oauth_identity_grants.revoked_at IS NULL
       RETURNING *`,
      [
        config.publicUrl,
        String(principal.id),
        principal.name || `API key ${principal.id}`,
        role,
        ceiling,
        principal.site_ids || [],
        sourceCredentialHash,
        sourcePepperFingerprint,
      ],
    )
    if (!rows[0]) throw new OAuthError('access_denied', 'the OAuth grant derived from this API key was revoked', 403)
    if (
      previous &&
      (previous.source_credential_hash !== sourceCredentialHash ||
        previous.source_pepper_fingerprint !== sourcePepperFingerprint)
    ) {
      const now = new Date().toISOString()
      await db.update(
        'ck_operator_sessions',
        { grant_id: `eq.${rows[0].id}`, revoked_at: 'is.null' },
        { revoked_at: now },
        { returning: false },
      )
      await db.update(
        'ck_oauth_access_tokens',
        { grant_id: `eq.${rows[0].id}`, revoked_at: 'is.null' },
        { revoked_at: now },
        { returning: false },
      )
      await db.update(
        'ck_oauth_refresh_tokens',
        { grant_id: `eq.${rows[0].id}`, revoked_at: 'is.null' },
        { revoked_at: now },
        { returning: false },
      )
      await db.update(
        'ck_oauth_authorization_codes',
        { grant_id: `eq.${rows[0].id}`, consumed_at: 'is.null' },
        { consumed_at: now },
        { returning: false },
      )
    }
    return rows[0]
  }

  async function attachGrant(state, grant) {
    const [updated] = await db.update(
      'ck_oauth_login_states',
      { id: `eq.${state.id}`, consumed_at: 'is.null' },
      { grant_id: grant.id, authenticated_at: new Date().toISOString() },
    )
    if (!updated) throw new OAuthError('invalid_request', 'authorization state expired or already used')
    return { ...state, grant_id: grant.id, authenticated_at: updated.authenticated_at }
  }

  async function siteNames(grant) {
    if (!grant.site_ids?.length) return []
    const rows = await db.query(`SELECT name FROM ck_sites WHERE id = ANY($1::uuid[]) ORDER BY name`, [grant.site_ids])
    return rows.map((row) => row.name)
  }

  async function consentResponse(state, grant, session, rawState, setCookie) {
    const client = await loadClient(state.client_id)
    if (!client) throw new OAuthError('invalid_client', 'unknown or revoked client')
    const requested = new Set(state.requested_scopes)
    const offeredScopes = roleOauthScopes(grant.role, config.oauthAllowedScopes).filter((scope) => requested.has(scope))
    if (!offeredScopes.includes('mcp:read')) {
      throw new OAuthError('access_denied', 'mcp:read is a mandatory requested baseline', 403)
    }
    const preChecked = [...offeredScopes]
    const html = renderConsentPage({
      clientName: client.client_name,
      identityLabel: grant.email || grant.display_name || grant.subject,
      siteNames: await siteNames(grant),
      offeredScopes,
      preChecked,
      csrfToken: csrf(config, session.id, state.id),
      loginState: rawState,
    })
    return authHtmlResponse(html, 200, setCookie ? { 'set-cookie': operatorCookie(config, setCookie) } : {})
  }

  function loginResponse(rawState) {
    const providers = loginProviders(config)
    if (!providers.length) throw new OAuthError('server_error', 'no OAuth login method is configured', 500)
    return authHtmlResponse(renderProviderChoice({ state: rawState, providers }))
  }

  async function beginAuthorization(request, url) {
    const client = await loadClient(url.searchParams.get('client_id') || '')
    if (!client) throw new OAuthError('invalid_client', 'unknown client_id')
    const redirectUri = url.searchParams.get('redirect_uri') || ''
    if (!client.redirect_uris.includes(redirectUri))
      throw new OAuthError('invalid_request', 'redirect_uri not registered')
    const clientState = url.searchParams.get('state') || ''
    if (clientState.length > 2048) return redirectError(redirectUri, 'invalid_request', '')
    if (url.searchParams.get('response_type') !== 'code')
      return redirectError(redirectUri, 'unsupported_response_type', clientState)
    const codeChallenge = url.searchParams.get('code_challenge') || ''
    if (url.searchParams.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
      return redirectError(redirectUri, 'invalid_request', clientState)
    }
    const resource = url.searchParams.get('resource') || ''
    if (resource !== resourceId(config)) return redirectError(redirectUri, 'invalid_target', clientState)
    let scopes
    try {
      scopes = requestedScopes(url.searchParams.get('scope'), config.oauthAllowedScopes)
    } catch {
      return redirectError(redirectUri, 'invalid_scope', clientState)
    }
    const rawState = randomToken('ckls_')
    const operator = await loadOperator(request)
    const [state] = await db.insert('ck_oauth_login_states', {
      state_hash: tokenHash(config, rawState),
      client_id: client.client_id,
      redirect_uri: redirectUri,
      requested_scopes: scopes,
      code_challenge: codeChallenge,
      resource,
      client_state: clientState || null,
      grant_id: operator?.grant_id || null,
      authenticated_at: operator ? new Date().toISOString() : null,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })
    if (operator) {
      const grant = await loadGrant(operator.grant_id)
      if (grant) return consentResponse(state, grant, operator, rawState)
    }
    const chooser = new URL('/v1/identity/login/start', config.publicUrl)
    chooser.searchParams.set('login_state', rawState)
    return new Response(null, { status: 302, headers: { location: chooser.toString(), 'cache-control': 'no-store' } })
  }

  async function apiKeyLogin(request) {
    const values = await form(request)
    const selected = loginProviders(config).find(
      (provider) => provider.protocol === 'api_key' && provider.id === values.get('provider'),
    )
    if (!selected) throw new OAuthError('not_found', 'identity provider is not available', 404)
    const rawState = values.get('login_state') || ''
    const state = await loadState(rawState)
    if (!state || new Date(state.expires_at) <= new Date())
      throw new OAuthError('invalid_request', 'authorization state expired')
    const principal = await auth.authenticate({ authorization: `Bearer ${values.get('api_key') || ''}` })
    if (!principal || principal.oauth)
      return authHtmlResponse(
        renderApiKeyLogin({ state: rawState, providerId: selected.id, error: 'The API key is invalid or expired.' }),
        401,
      )
    const grant = await upsertApiKeyGrant(principal)
    const attached = await attachGrant(state, grant)
    const session = await createOperatorSession(grant.id)
    await audit.record({
      actorType: 'api_key',
      actorId: principal.id,
      action: 'oauth.login',
      resourceType: 'oauth_grant',
      resourceId: grant.id,
      result: 'success',
      transport: 'oauth',
    })
    return consentResponse(attached, grant, session.row, rawState, session.token)
  }

  async function startLogin(url) {
    const rawState = url.searchParams.get('login_state') || ''
    const state = await loadState(rawState)
    if (!state || new Date(state.expires_at) <= new Date())
      throw new OAuthError('invalid_request', 'authorization state expired')
    if (!url.searchParams.get('provider')) return loginResponse(rawState)
    const selected = loginProviders(config).find((candidate) => candidate.id === url.searchParams.get('provider'))
    if (selected?.protocol === 'api_key') {
      return authHtmlResponse(renderApiKeyLogin({ state: rawState, providerId: selected.id }))
    }
    const provider = oidcProvider(config, selected?.id)
    if (!provider) throw new OAuthError('not_found', 'identity provider is not available', 404)
    const started = await startOidcLogin({
      provider,
      redirectUri: `${config.publicUrl}/v1/identity/login/callback`,
      state: rawState,
    }).catch(() => {
      throw new OAuthError('temporarily_unavailable', 'OIDC provider discovery is unavailable', 503)
    })
    const changed = await db.update(
      'ck_oauth_login_states',
      { id: `eq.${state.id}`, consumed_at: 'is.null' },
      { provider_id: provider.id, oidc_nonce: started.nonce, oidc_code_verifier: started.codeVerifier },
    )
    if (!changed.length) throw new OAuthError('invalid_request', 'authorization state already used')
    return new Response(null, {
      status: 302,
      headers: { location: started.authorizationUrl, 'cache-control': 'no-store' },
    })
  }

  async function finishLogin(url) {
    const rawState = url.searchParams.get('state') || ''
    const state = await loadState(rawState)
    const provider = oidcProvider(config, state?.provider_id)
    if (!state || !provider || !state.oidc_nonce || !state.oidc_code_verifier) {
      throw new OAuthError('invalid_request', 'OIDC authorization state is invalid or expired')
    }
    const identity = await finishOidcLogin({
      provider,
      redirectUri: `${config.publicUrl}/v1/identity/login/callback`,
      callbackUrl: url,
      state: rawState,
      nonce: state.oidc_nonce,
      codeVerifier: state.oidc_code_verifier,
    }).catch((error) => {
      throw new OAuthError('access_denied', error instanceof Error ? error.message : 'OIDC login rejected', 403)
    })
    const grant = (
      await db.select('ck_oauth_identity_grants', {
        provider_id: `eq.${provider.id}`,
        issuer: `eq.${provider.issuer}`,
        subject: `eq.${identity.subject}`,
        revoked_at: 'is.null',
        limit: '1',
      })
    )[0]
    if (!grant) throw new OAuthError('access_denied', 'this identity has no ContentKit grant', 403)
    await db.update(
      'ck_oauth_identity_grants',
      { id: `eq.${grant.id}` },
      { email: identity.email, updated_at: new Date().toISOString() },
      { returning: false },
    )
    const attached = await attachGrant(state, { ...grant, email: identity.email })
    const session = await createOperatorSession(grant.id)
    await audit.record({
      actorType: 'operator',
      actorId: grant.id,
      action: 'oauth.login',
      resourceType: 'oauth_grant',
      resourceId: grant.id,
      result: 'success',
      transport: 'oauth',
      metadata: { provider_id: provider.id },
    })
    return consentResponse(attached, { ...grant, email: identity.email }, session.row, rawState, session.token)
  }

  async function logout(request) {
    const operator = await loadOperator(request)
    if (operator) {
      await db.update(
        'ck_operator_sessions',
        { id: `eq.${operator.id}`, revoked_at: 'is.null' },
        { revoked_at: new Date().toISOString() },
        { returning: false },
      )
      await audit.record({
        actorType: 'operator',
        actorId: operator.grant_id,
        action: 'oauth.logout',
        resourceType: 'operator_session',
        resourceId: operator.id,
        result: 'success',
        transport: 'oauth',
      })
    }
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store', 'set-cookie': operatorCookie(config, '', 0) },
    })
  }

  async function decide(request) {
    const values = await form(request)
    const rawState = values.get('login_state') || ''
    const state = await loadState(rawState, { includeConsumed: true })
    if (!state || !state.grant_id || new Date(state.expires_at) <= new Date())
      throw new OAuthError('invalid_request', 'authorization state expired')
    const operator = await loadOperator(request)
    if (!operator || operator.grant_id !== state.grant_id)
      throw new OAuthError('access_denied', 'operator session expired', 401)
    if (!verifyCsrf(config, values.get('csrf_token'), operator.id, state.id))
      throw new OAuthError('invalid_request', 'CSRF verification failed')
    const client = await loadClient(state.client_id)
    if (!client?.redirect_uris.includes(state.redirect_uri))
      throw new OAuthError('invalid_client', 'client is unavailable')
    if (state.consumed_at) {
      const response = replayDecision(state)
      logger?.info?.('oauth consent decision replayed', { client_id: state.client_id })
      return response
    }
    if (values.get('decision') === 'switch_account') {
      const now = new Date().toISOString()
      await db.update(
        'ck_operator_sessions',
        { id: `eq.${operator.id}`, revoked_at: 'is.null' },
        { revoked_at: now },
        { returning: false },
      )
      await db.update(
        'ck_oauth_login_states',
        { id: `eq.${state.id}`, consumed_at: 'is.null' },
        { grant_id: null, authenticated_at: null, provider_id: null, oidc_nonce: null, oidc_code_verifier: null },
        { returning: false },
      )
      await audit.record({
        actorType: 'operator',
        actorId: state.grant_id,
        action: 'oauth.logout',
        resourceType: 'operator_session',
        resourceId: operator.id,
        result: 'success',
        transport: 'oauth',
      })
      const response = loginResponse(rawState)
      response.headers.append('set-cookie', operatorCookie(config, '', 0))
      return response
    }
    if (values.get('decision') === 'deny') {
      const target = new URL(state.redirect_uri)
      target.searchParams.set('error', 'access_denied')
      if (state.client_state) target.searchParams.set('state', state.client_state)
      const replay = await claimDecision(rawState, state, target.toString())
      if (replay) return replay
      await audit.record({
        actorType: 'operator',
        actorId: state.grant_id,
        action: 'oauth.consent',
        resourceType: 'oauth_client',
        resourceId: state.client_id,
        result: 'denied',
        transport: 'oauth',
      })
      return decisionRedirect(target.toString())
    }
    const grant = await loadGrant(state.grant_id)
    if (!grant) throw new OAuthError('access_denied', 'identity grant was revoked', 403)
    const ceiling = roleOauthScopes(grant.role, config.oauthAllowedScopes)
    const selected = [...new Set(values.getAll('scope'))].filter(
      (scope) => ceiling.includes(scope) && state.requested_scopes.includes(scope),
    )
    if (!selected.includes('mcp:read')) {
      return redirectError(state.redirect_uri, 'access_denied', state.client_state)
    }
    const rawCode = randomToken('ckac_')
    const target = new URL(state.redirect_uri)
    target.searchParams.set('code', rawCode)
    if (state.client_state) target.searchParams.set('state', state.client_state)
    const replay = await claimDecision(rawState, state, target.toString(), async (tx) => {
      await tx.insert('ck_oauth_authorization_codes', {
        code_hash: tokenHash(config, rawCode),
        client_id: state.client_id,
        grant_id: grant.id,
        redirect_uri: state.redirect_uri,
        scopes: selected,
        site_ids: grant.site_ids || [],
        resource: state.resource,
        code_challenge: state.code_challenge,
        expires_at: new Date(Date.now() + config.oauthAuthorizationCodeTtlMs).toISOString(),
      })
    })
    if (replay) return replay
    await audit.record({
      actorType: 'operator',
      actorId: grant.id,
      action: 'oauth.consent',
      resourceType: 'oauth_client',
      resourceId: state.client_id,
      result: 'success',
      transport: 'oauth',
      metadata: { scopes: selected },
    })
    return decisionRedirect(target.toString())
  }

  async function issueTokens(exec, code, familyId = randomUUID()) {
    const access = randomToken('cko_')
    const refresh = randomToken('ckr_')
    const [accessRow] = await exec.insert('ck_oauth_access_tokens', {
      token_hash: tokenHash(config, access),
      client_id: code.client_id,
      grant_id: code.grant_id,
      scopes: code.scopes,
      site_ids: code.site_ids || [],
      resource: code.resource,
      family_id: familyId,
      expires_at: new Date(Date.now() + config.oauthAccessTokenTtlMs).toISOString(),
    })
    const [refreshRow] = await exec.insert('ck_oauth_refresh_tokens', {
      token_hash: tokenHash(config, refresh),
      client_id: code.client_id,
      grant_id: code.grant_id,
      scopes: code.scopes,
      site_ids: code.site_ids || [],
      resource: code.resource,
      family_id: familyId,
      expires_at: new Date(Date.now() + config.oauthRefreshTokenTtlMs).toISOString(),
    })
    return {
      response: {
        access_token: access,
        refresh_token: refresh,
        token_type: 'Bearer',
        expires_in: Math.floor(config.oauthAccessTokenTtlMs / 1000),
        scope: code.scopes.join(' '),
      },
      accessRow,
      refreshRow,
    }
  }

  async function token(request) {
    const values = await form(request)
    const grantType = values.get('grant_type')
    const clientId = values.get('client_id') || ''
    const client = await loadClient(clientId)
    if (!client) throw new OAuthError('invalid_client', 'unknown client')
    if (grantType === 'authorization_code') {
      const codeValue = values.get('code') || ''
      const redirectUri = values.get('redirect_uri') || ''
      const resource = values.get('resource') || ''
      const verifier = values.get('code_verifier') || ''
      if (!codeValue || !redirectUri || !validPkceVerifier(verifier)) {
        throw new OAuthError('invalid_request', 'code, redirect_uri and a valid code_verifier are required')
      }
      if (resource !== resourceId(config)) {
        throw new OAuthError('invalid_target', 'resource does not identify this MCP server')
      }
      const codeHash = tokenHash(config, codeValue)
      const result = await db.tx(async (tx) => {
        const rows = await tx.query(
          `UPDATE ck_oauth_authorization_codes SET consumed_at = now()
            WHERE code_hash = $1 AND client_id = $2 AND redirect_uri = $3 AND resource = $4
              AND code_challenge = $5 AND consumed_at IS NULL AND expires_at > now()
            RETURNING *`,
          [codeHash, clientId, redirectUri, resource, pkceChallenge(verifier)],
        )
        const code = rows[0]
        if (!code) {
          throw new OAuthError('invalid_grant', 'authorization code is invalid, expired or already used')
        }
        const grant = (
          await tx.select('ck_oauth_identity_grants', {
            id: `eq.${code.grant_id}`,
            revoked_at: 'is.null',
            limit: '1',
          })
        )[0]
        if (!grant) throw new OAuthError('invalid_grant', 'identity grant was revoked')
        return { tokens: await issueTokens(tx, code), grant }
      })
      await audit.record({
        actorType: 'oauth',
        actorId: result.grant.id,
        action: 'oauth.token_issued',
        resourceType: 'oauth_client',
        resourceId: clientId,
        result: 'success',
        transport: 'oauth',
      })
      return json({ ...result.tokens.response, resource })
    }
    if (grantType === 'refresh_token') {
      const hash = tokenHash(config, values.get('refresh_token') || '')
      const existing = (await db.select('ck_oauth_refresh_tokens', { token_hash: `eq.${hash}`, limit: '1' }))[0]
      if (
        !existing ||
        existing.client_id !== clientId ||
        values.get('resource') !== existing.resource ||
        existing.revoked_at ||
        new Date(existing.expires_at) <= new Date()
      ) {
        throw new OAuthError('invalid_grant', 'refresh token is invalid or expired')
      }
      if (!(await loadGrant(existing.grant_id))) {
        throw new OAuthError('invalid_grant', 'identity grant was revoked')
      }
      if (existing.consumed_at) {
        await db.query(
          `UPDATE ck_oauth_refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1`,
          [existing.family_id],
        )
        await db.query(
          `UPDATE ck_oauth_access_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1`,
          [existing.family_id],
        )
        throw new OAuthError('invalid_grant', 'refresh token replay detected')
      }
      let result
      try {
        result = await db.tx(async (tx) => {
          const claimed = await tx.query(
            `UPDATE ck_oauth_refresh_tokens SET consumed_at = now()
              WHERE id = $1 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING *`,
            [existing.id],
          )
          if (!claimed[0]) throw new OAuthError('invalid_grant', 'refresh token replay detected')
          const fresh = await issueTokens(tx, existing, existing.family_id)
          await tx.update(
            'ck_oauth_refresh_tokens',
            { id: `eq.${existing.id}` },
            { replaced_by_id: fresh.refreshRow.id },
            { returning: false },
          )
          return fresh
        })
      } catch (error) {
        if (error instanceof OAuthError && error.code === 'invalid_grant') {
          await db.query(
            `UPDATE ck_oauth_refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1`,
            [existing.family_id],
          )
          await db.query(
            `UPDATE ck_oauth_access_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1`,
            [existing.family_id],
          )
        }
        throw error
      }
      return json({ ...result.response, resource: existing.resource })
    }
    throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
  }

  async function revoke(request) {
    const values = await form(request)
    const hash = tokenHash(config, values.get('token') || '')
    const refresh = (await db.select('ck_oauth_refresh_tokens', { token_hash: `eq.${hash}`, limit: '1' }))[0]
    if (refresh) {
      await db.query(
        `UPDATE ck_oauth_refresh_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1`,
        [refresh.family_id],
      )
      await db.query(
        `UPDATE ck_oauth_access_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE family_id = $1`,
        [refresh.family_id],
      )
    } else {
      await db
        .update(
          'ck_oauth_access_tokens',
          { token_hash: `eq.${hash}`, revoked_at: 'is.null' },
          { revoked_at: new Date().toISOString() },
          { returning: false },
        )
        .catch(() => {})
    }
    return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } })
  }

  async function register(request) {
    if (!config.oauthDynamicRegistrationEnabled)
      throw new OAuthError('registration_not_supported', 'dynamic registration is disabled')
    if (!dcrAllowed(request)) throw new OAuthError('too_many_requests', 'registration rate limit exceeded', 429)
    const length = Number(request.headers.get('content-length') || 0)
    if (length > FORM_MAX_BYTES) throw new OAuthError('invalid_client_metadata', 'request body too large', 413)
    const raw = await request.text()
    if (Buffer.byteLength(raw) > FORM_MAX_BYTES)
      throw new OAuthError('invalid_client_metadata', 'request body too large', 413)
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      throw new OAuthError('invalid_client_metadata', 'request body must be JSON')
    }
    const redirects = body?.redirect_uris
    if (
      !Array.isArray(redirects) ||
      redirects.length < 1 ||
      redirects.length > 5 ||
      redirects.some((uri) => typeof uri !== 'string' || !isSafeRedirect(uri))
    ) {
      throw new OAuthError('invalid_client_metadata', 'redirect_uris must contain 1-5 safe callback URLs')
    }
    if (body?.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'none')
      throw new OAuthError('invalid_client_metadata', 'only public clients are supported')
    const clientId = randomToken('ckc_')
    const clientName =
      typeof body?.client_name === 'string' && body.client_name.trim()
        ? body.client_name.trim().slice(0, 255)
        : 'MCP client'
    await db.insert('ck_oauth_clients', {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirects,
      token_endpoint_auth_method: 'none',
    })
    await audit.record({
      actorType: 'system',
      action: 'oauth.client_registered',
      resourceType: 'oauth_client',
      resourceId: clientId,
      result: 'success',
      transport: 'oauth',
    })
    return json(
      {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: clientName,
        redirect_uris: redirects,
        response_types: ['code'],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
      },
      201,
    )
  }

  async function createIdentitySession(request) {
    const body = await request.json().catch(() => null)
    const providerId = typeof body?.provider_id === 'string' ? body.provider_id : ''
    const identityToken = typeof body?.identity_token === 'string' ? body.identity_token : ''
    if (!providerId || !identityToken) {
      throw new OAuthError('invalid_request', 'provider_id and identity_token are required')
    }
    const provider = (config.oauthProviders || []).find((candidate) => candidate.id === providerId)
    if (!provider) throw new OAuthError('access_denied', 'identity provider is not configured', 403)
    if (provider.protocol === 'api_key') {
      throw new OAuthError('invalid_request', 'API key login does not accept identity assertions')
    }
    const identity = await verifyOidcIdentityToken({ provider, identityToken }).catch(() => {
      throw new OAuthError('invalid_token', 'identity assertion was rejected', 401)
    })
    const grant = (
      await db.select('ck_oauth_identity_grants', {
        provider_id: `eq.${provider.id}`,
        issuer: `eq.${provider.issuer}`,
        subject: `eq.${identity.subject}`,
        revoked_at: 'is.null',
        limit: '1',
      })
    )[0]
    if (!grant) throw new OAuthError('access_denied', 'this identity has no ContentKit grant', 403)
    await db.update(
      'ck_oauth_identity_grants',
      { id: `eq.${grant.id}` },
      { email: identity.email, updated_at: new Date().toISOString() },
      { returning: false },
    )
    if (!config.keyPepper) throw new OAuthError('temporarily_unavailable', 'API key issuance is not configured', 503)
    const apiKey = `ck_${randomBytes(32).toString('base64url')}`
    await db.insert('ck_api_keys', {
      name: `SSO ${identity.email}`,
      key_prefix: apiKey.slice(0, 11),
      key_hash: hmac256(config.keyPepper, apiKey),
      scopes: grant.product_scopes || [],
      site_ids: grant.site_ids || [],
    })
    await audit.record({
      actorType: 'operator',
      actorId: grant.id,
      action: 'identity.session_issued',
      resourceType: 'identity_grant',
      resourceId: grant.id,
      result: 'success',
      transport: 'oauth',
      metadata: { provider_id: provider.id },
    })
    const contexts = grant.site_ids || []
    return json({
      api_key: apiKey,
      principal_id: grant.id,
      context_id: contexts.length === 1 ? contexts[0] : null,
      email: identity.email,
    })
  }

  async function handler(request) {
    const url = new URL(request.url)
    try {
      if (request.method === 'GET' && url.pathname === '/v1/identity/providers') {
        return json({
          providers: loginProviders(config).map(({ id, protocol }) => ({
            protocol,
            id,
            label: protocol === 'api_key' ? 'API key' : 'SSO',
            ...(protocol === 'oidc'
              ? { issuer: config.oauthProviders.find((provider) => provider.id === id)?.issuer }
              : {}),
          })),
        })
      }
      if (request.method === 'POST' && url.pathname === '/v1/identity/sessions') {
        return await createIdentitySession(request)
      }
      if (
        request.method === 'GET' &&
        ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(url.pathname)
      ) {
        return json({
          resource: resourceId(config),
          authorization_servers: [config.publicUrl],
          scopes_supported: config.oauthAllowedScopes,
          bearer_methods_supported: ['header'],
        })
      }
      if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
        return json({
          issuer: config.publicUrl,
          authorization_endpoint: `${config.publicUrl}/v1/oauth/authorize`,
          token_endpoint: `${config.publicUrl}/v1/oauth/token`,
          registration_endpoint: `${config.publicUrl}/v1/oauth/register`,
          revocation_endpoint: `${config.publicUrl}/v1/oauth/revoke`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          scopes_supported: config.oauthAllowedScopes,
        })
      }
      if (request.method === 'POST' && url.pathname === '/v1/oauth/register') return await register(request)
      if (request.method === 'GET' && url.pathname === '/v1/oauth/authorize')
        return await beginAuthorization(request, url)
      if (request.method === 'POST' && url.pathname === '/v1/oauth/authorize/decision') return await decide(request)
      if (request.method === 'POST' && url.pathname === '/v1/oauth/token') return await token(request)
      if (request.method === 'POST' && url.pathname === '/v1/oauth/revoke') return await revoke(request)
      if (request.method === 'GET' && url.pathname === '/v1/identity/login/start') return await startLogin(url)
      if (request.method === 'POST' && url.pathname === '/v1/identity/login/start') return await apiKeyLogin(request)
      if (request.method === 'GET' && url.pathname === '/v1/identity/login/callback') return await finishLogin(url)
      if (request.method === 'POST' && url.pathname === '/v1/identity/logout') return await logout(request)
      return json({ error: 'not_found' }, 404)
    } catch (error) {
      logger?.warn?.('oauth request failed', {
        path: url.pathname,
        code: error.code || 'server_error',
        error: String(error.message || error),
      })
      return oauthError(error)
    }
  }

  async function cleanup() {
    if (!db.query) return
    await db.query(`DELETE FROM ck_oauth_login_states WHERE expires_at < now() - interval '1 day'`)
    await db.query(`DELETE FROM ck_oauth_authorization_codes WHERE expires_at < now() - interval '1 day'`)
    await db.query(`DELETE FROM ck_operator_sessions WHERE absolute_expires_at < now() - interval '1 day'`)
    await db.query(`DELETE FROM ck_oauth_access_tokens WHERE expires_at < now() - interval '1 day'`)
    await db.query(`DELETE FROM ck_oauth_refresh_tokens WHERE expires_at < now() - interval '1 day'`)
    await db.query(`DELETE FROM ck_idempotency_keys WHERE expires_at < now()`)
    await db.query(
      `DELETE FROM ck_oauth_clients c
        WHERE c.created_at < now() - interval '30 days'
          AND NOT EXISTS (SELECT 1 FROM ck_oauth_login_states s WHERE s.client_id = c.client_id)
          AND NOT EXISTS (SELECT 1 FROM ck_oauth_authorization_codes a WHERE a.client_id = c.client_id)
          AND NOT EXISTS (SELECT 1 FROM ck_oauth_access_tokens a WHERE a.client_id = c.client_id)
          AND NOT EXISTS (SELECT 1 FROM ck_oauth_refresh_tokens r WHERE r.client_id = c.client_id)`,
    )
  }

  return {
    handler,
    start() {
      if (cleanupTimer) return
      cleanup().catch(() => {})
      cleanupTimer = setInterval(() => cleanup().catch(() => {}), 60 * 60 * 1000)
      cleanupTimer.unref?.()
    },
    stop() {
      if (cleanupTimer) clearInterval(cleanupTimer)
      cleanupTimer = null
    },
    cleanup,
  }
}
