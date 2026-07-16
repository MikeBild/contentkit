import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { hmac256 } from './utils.mjs'

const scrypt = promisify(scryptCallback)
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 })
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000
export const READER_COOKIE = '__Host-contentkit_session'
export const INSECURE_READER_COOKIE = 'contentkit_session'

export function normalizeUsername(value) {
  const username = String(value || '')
    .trim()
    .toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    throw Object.assign(new Error('username must be 3-64 lowercase letters, numbers, dot, underscore or hyphen'), {
      statusCode: 422,
    })
  }
  return username
}

export function validatePassword(value) {
  const password = String(value || '')
  if (password.length < 12 || password.length > 256) {
    throw Object.assign(new Error('password must be between 12 and 256 characters'), { statusCode: 422 })
  }
  return password
}

export async function hashReaderPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(validatePassword(password), salt, SCRYPT.keylen, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`
}

export async function verifyReaderPassword(password, encoded) {
  try {
    const [scheme, n, r, p, salt, expected] = String(encoded).split('$')
    if (scheme !== 'scrypt') return false
    const expectedBytes = Buffer.from(expected, 'base64url')
    const actual = await scrypt(String(password || ''), Buffer.from(salt, 'base64url'), expectedBytes.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    })
    return expectedBytes.length === actual.length && timingSafeEqual(expectedBytes, actual)
  } catch {
    return false
  }
}

export function sessionTokenHash(secret, token) {
  return hmac256(secret, token)
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

export function parseCookies(header = '') {
  const result = {}
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    try {
      result[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      // Ignore malformed user-controlled cookie values instead of turning a
      // public request into a 500 response.
    }
  }
  return result
}

export function sessionCookie(token, { secure = true, maxAge = Math.floor(SESSION_ABSOLUTE_MS / 1000) } = {}) {
  const name = secure ? READER_COOKIE : INSECURE_READER_COOKIE
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function clearSessionCookie({ secure = true } = {}) {
  const name = secure ? READER_COOKIE : INSECURE_READER_COOKIE
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

export function validReturnTo(value, fallback = '/') {
  const path = String(value || '')
  return path.length <= 2048 &&
    Array.from(path).every((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    }) &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('\\')
    ? path
    : fallback
}

export function matchesAccessPath(entry, pathname) {
  return entry.match === 'exact' ? pathname === entry.path : pathname.startsWith(entry.path)
}

export function mostSpecificAccess(entries, pathname) {
  return entries
    .filter((entry) => matchesAccessPath(entry, pathname))
    .sort((a, b) => Number(b.match === 'exact') - Number(a.match === 'exact') || b.path.length - a.path.length)[0]
}

export function readerAllowed(entry, reader) {
  if (!entry) return true
  if (!reader) return false
  const groups = Array.isArray(reader.groups) ? reader.groups : []
  return (entry.user_ids || []).includes(reader.id) || (entry.group_slugs || []).some((slug) => groups.includes(slug))
}
