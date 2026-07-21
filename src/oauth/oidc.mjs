import * as oidc from 'openid-client'

const discovered = new Map()

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
