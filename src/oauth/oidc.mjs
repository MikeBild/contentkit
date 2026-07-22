import * as oidc from 'openid-client'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const discovered = new Map()
const assertionMetadata = new Map()
const assertionKeys = new Map()

function discoveryUrl(issuer) {
  const endpoint = new URL(issuer)
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`
  endpoint.search = ''
  endpoint.hash = ''
  return endpoint
}

async function configuration(provider) {
  const key = `${provider.issuer}\u0000${provider.clientId}`
  let pending = discovered.get(key)
  if (!pending) {
    pending = oidc.discovery(new URL(provider.issuer), provider.clientId, provider.clientSecret || undefined)
    discovered.set(key, pending)
  }
  try {
    return await pending
  } catch (error) {
    discovered.delete(key)
    throw error
  }
}

export async function startOidcLogin({ provider, redirectUri, state }) {
  const config = await configuration(provider)
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
  const nonce = oidc.randomNonce()
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: provider.scopes,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return { authorizationUrl: url.toString(), codeVerifier, nonce }
}

export async function finishOidcLogin({ provider, redirectUri, callbackUrl, state, nonce, codeVerifier }) {
  const config = await configuration(provider)
  const callback = new URL(redirectUri)
  callback.search = callbackUrl.search
  const tokens = await oidc.authorizationCodeGrant(config, callback, {
    expectedState: state,
    expectedNonce: nonce,
    pkceCodeVerifier: codeVerifier,
  })
  const claims = tokens.claims()
  const subject = typeof claims?.sub === 'string' ? claims.sub : ''
  const email = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : ''
  if (!subject || !email || claims?.email_verified !== true) {
    throw new Error('OIDC identity must contain sub, email and email_verified=true')
  }
  return { subject, email }
}

async function providerMetadata(provider) {
  let pending = assertionMetadata.get(provider.issuer)
  if (!pending) {
    pending = (async () => {
      const endpoint = discoveryUrl(provider.issuer)
      const response = await fetch(endpoint, { headers: { accept: 'application/json' }, redirect: 'error' })
      if (!response.ok) throw new Error('OIDC discovery failed')
      const metadata = await response.json()
      if (metadata.issuer !== provider.issuer || typeof metadata.jwks_uri !== 'string') {
        throw new Error('OIDC discovery metadata is invalid')
      }
      return metadata
    })()
    assertionMetadata.set(provider.issuer, pending)
  }
  try {
    return await pending
  } catch (error) {
    assertionMetadata.delete(provider.issuer)
    throw error
  }
}

/** Verify a provider assertion for the provider-neutral identity-session exchange. */
export async function verifyOidcIdentityToken({ provider, identityToken }) {
  const metadata = await providerMetadata(provider)
  let keySet = assertionKeys.get(metadata.jwks_uri)
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(metadata.jwks_uri))
    assertionKeys.set(metadata.jwks_uri, keySet)
  }
  const { payload } = await jwtVerify(identityToken, keySet, {
    issuer: metadata.issuer,
    audience: provider.clientId,
  })
  const subject = typeof payload.sub === 'string' ? payload.sub : ''
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  if (!subject || !email || payload.email_verified !== true) {
    throw new Error('OIDC identity must contain sub, email and email_verified=true')
  }
  return { subject, email }
}
