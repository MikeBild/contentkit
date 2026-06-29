import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const hmac256 = (secret, value, encoding = 'hex') => createHmac('sha256', secret).update(value).digest(encoding)

export function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function escapeXml(value = '') {
  return escapeHtml(value)
}

export function slugify(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

export function assertSlug(value, field = 'slug') {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/.test(value || '')) {
    throw Object.assign(new Error(`${field} must contain lowercase letters, numbers and hyphens`), { statusCode: 422 })
  }
  return value
}

export function json(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

export function cleanPath(path) {
  let decoded
  try {
    decoded = decodeURIComponent(path)
  } catch {
    throw Object.assign(new Error('invalid URL encoding'), { statusCode: 400 })
  }
  if (decoded.includes('\0') || decoded.split('/').includes('..')) {
    throw Object.assign(new Error('invalid path'), { statusCode: 400 })
  }
  return decoded.replace(/\/+/g, '/')
}

export function canonicalRequestPath(path) {
  const clean = cleanPath(path)
  if (clean.endsWith('/')) return `${clean}index.html`.replace(/^\//, '')
  if (!clean.split('/').at(-1).includes('.')) return `${clean}/index.html`.replace(/^\//, '')
  return clean.replace(/^\//, '')
}

export function parseIsoDate(value, field = 'date') {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) {
    throw Object.assign(new Error(`${field} must be an ISO-8601 date`), { statusCode: 422 })
  }
  return date.toISOString()
}

export function excerpt(value, max = 180) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim()
  return compact.length <= max ? compact : `${compact.slice(0, max - 1).trimEnd()}…`
}
