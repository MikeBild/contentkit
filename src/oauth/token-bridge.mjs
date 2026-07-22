import { createRemoteJWKSet, jwtVerify } from 'jose'

const keySets = new Map()

function readClaim(payload, path) {
  return path.split('.').reduce((value, segment) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    return value[segment]
  }, payload)
}

export async function verifyBridgedIdentity({
  token,
  issuer,
  audience,
  jwksUrl,
  subjectClaim,
  emailClaim,
  emailVerifiedClaim,
  allowedEmails,
}) {
  if (!issuer || !audience || !jwksUrl || !allowedEmails.length) throw new Error('token bridge is not configured')
  let jwks = keySets.get(jwksUrl)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl))
    keySets.set(jwksUrl, jwks)
  }
  const { payload } = await jwtVerify(token, jwks, { issuer, audience })
  const rawSubject = readClaim(payload, subjectClaim || 'sub')
  const rawEmail = readClaim(payload, emailClaim || 'email')
  const subject = typeof rawSubject === 'string' ? rawSubject : ''
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  if (!subject || !email || readClaim(payload, emailVerifiedClaim || 'email_verified') !== true) {
    throw new Error('identity has no verified email')
  }
  if (!allowedEmails.includes(email)) throw new Error('this identity is not allowed to access ContentKit')
  return { subject, email }
}
