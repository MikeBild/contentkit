import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

// Endpoint signing secrets must be reproducible at delivery time, so we store
// them reversibly — encrypted at rest with AES-256-GCM keyed off the server
// pepper. Format: base64(iv).base64(tag).base64(ciphertext).
function keyFrom(pepper) {
  if (!pepper) throw Object.assign(new Error('CONTENTKIT_KEY_PEPPER is not configured'), { statusCode: 503 })
  return createHash('sha256').update(String(pepper)).digest()
}

export function encryptSecret(plaintext, pepper) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(pepper), iv)
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ciphertext.toString('base64')}`
}

export function decryptSecret(encrypted, pepper) {
  const [iv, tag, ciphertext] = String(encrypted).split('.')
  if (!iv || !tag || !ciphertext) throw new Error('malformed encrypted secret')
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(pepper), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
}

export function generateWebhookSecret() {
  return `whsec_${randomBytes(24).toString('base64url')}`
}

function isBlockedIPv4(ip) {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 || // this-net, private-10, loopback, multicast/reserved
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local incl. 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || // private 172.16/12
    (a === 192 && b === 168) || // private 192.168/16
    (a === 198 && (b === 18 || b === 19)) // benchmarking 198.18/15
  )
}

function isBlockedIPv6(ip) {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true // loopback / unspecified
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb'))
    return true // link-local fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local fc00::/7
  if (lower.startsWith('ff')) return true // multicast
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) // IPv4-mapped
  if (mapped) return isBlockedIPv4(mapped[1])
  return false
}

export function isBlockedAddress(ip) {
  const version = isIP(ip)
  if (version === 4) return isBlockedIPv4(ip)
  if (version === 6) return isBlockedIPv6(ip)
  return true
}

// Validates a user-supplied webhook URL against SSRF: enforces http(s), forbids
// credentials, and resolves the host to reject loopback/private/link-local and
// cloud-metadata addresses. allowInsecure permits http + private targets (local dev).
export async function assertDeliverableUrl(rawUrl, { allowInsecure = false } = {}) {
  let url
  try {
    url = new URL(String(rawUrl))
  } catch {
    throw Object.assign(new Error('webhook url must be an absolute URL'), { statusCode: 422 })
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw Object.assign(new Error('webhook url must be http(s) without credentials'), { statusCode: 422 })
  }
  if (url.protocol === 'http:' && !allowInsecure) {
    throw Object.assign(new Error('webhook url must use https'), { statusCode: 422 })
  }
  if (allowInsecure) return url.toString()
  let addresses
  try {
    addresses = await lookup(url.hostname, { all: true })
  } catch {
    throw Object.assign(new Error('webhook host does not resolve'), { statusCode: 422 })
  }
  if (!addresses.length || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw Object.assign(new Error('webhook url resolves to a disallowed (private/loopback) address'), {
      statusCode: 422,
    })
  }
  return url.toString()
}
