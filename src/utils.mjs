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
  const compact = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  return compact.length <= max ? compact : `${compact.slice(0, max - 1).trimEnd()}…`
}

// One rate for every locale. Brysbaert's 2019 meta-analysis of 190 studies puts
// silent reading of non-fiction around 238 wpm for English and roughly 200 for
// German. On a seven-minute post that gap is one minute — inside the noise floor
// of a number we round to an integer. A per-locale table is a knob nobody tunes
// correctly and everybody has to maintain twice. 200 is round, conservative, and
// defensible for technical prose that keeps context-switching into code.
// https://doi.org/10.1016/j.jml.2019.104047
const WORDS_PER_MINUTE = 200

// Estimates reading time from *Markdown source* (frontmatter already stripped by
// renderMarkdown). Prose only: fenced code is dropped wholesale rather than
// counted at some invented "code reading speed" — reading a 60-line sample is
// not reading 400 words, and no per-language rate makes that estimate honest.
//
// Strip order matters. Fences may contain backticks, `$` and `<`, so they go
// first; inline constructs are only safe to remove once fences are gone.
export function readingTime(source) {
  const prose = String(source || '')
    // 1. Fenced code (``` and ~~~, any info string incl. mermaid). The trailing
    //    alternative catches an unterminated fence running to EOF.
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, ' ')
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*$/m, ' ')
    // 2. HTML comments, then raw tags.
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    // 3. Images: alt text is not read aloud by a silent reader.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    // 4. Links keep their text, lose the URL. Reference definitions go entirely.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*\[[^\]]+\]:[^\n]*$/gm, ' ')
    // 5. Math renders as glyphs, not words. Block before inline.
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    // 6. Inline code spans — almost always a single identifier.
    .replace(/`[^`\n]*`/g, ' ')
    // 7. Directive fences (:::tip … :::) lose the markers, keep the content.
    .replace(/^[ \t]*:{3,}[^\n]*$/gm, ' ')

  // Counting letter/number runs rather than whitespace-separated words is the
  // German-friendly part: `Software-Architektur` scores 2, which offsets the
  // speed penalty long compounds would otherwise hide. Do not widen the class
  // to include hyphens or apostrophes — that reintroduces the compound problem.
  const words = prose.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}
