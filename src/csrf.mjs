import { randomBytes } from 'node:crypto'
import { parseCookies } from './access.mjs'
import { hmac256, safeEqual } from './utils.mjs'

// Double-submit CSRF: the token is handed out in an HttpOnly cookie and must be
// echoed back in the request, so an attacker's origin can neither read it nor
// forge one. The HMAC signature is what makes the cookie unforgeable even if a
// subdomain could set it; `__Host-` closes that hole outright wherever TLS lets
// us use it.
//
// Two callers share this: site reader sessions (scoped by the site's own
// base_url) and ContentKit Cockpit (scoped by the API's publicUrl). They
// differ only in what decides "secure", which is why that is a parameter.
export function csrfCookieName(secure) {
  return secure ? '__Host-contentkit_csrf' : 'contentkit_csrf'
}

// One definition of the signing secret. The token is minted where a session is
// handed out and verified where a mutation arrives — two different modules, so
// a second copy of this fallback chain would be a silent way to make every
// token look forged.
export function csrfSecretFor(config) {
  return config.sessionSecret || config.previewSecret || 'development'
}

export function signCsrf(secret) {
  const token = randomBytes(24).toString('base64url')
  return `${token}.${hmac256(secret, token)}`
}

export function verifyCsrf(cookieHeader, submitted, { secure, secret }) {
  const cookie = parseCookies(cookieHeader || '')[csrfCookieName(secure)] || ''
  const [token, signature] = cookie.split('.')
  return Boolean(
    token && signature && safeEqual(cookie, submitted || '') && safeEqual(signature, hmac256(secret, token)),
  )
}

export function csrfSetCookie(value, { secure }) {
  return `${csrfCookieName(secure)}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}
