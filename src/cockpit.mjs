import { readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { send } from './http.mjs'
import { sha256 } from './utils.mjs'

// Resolved from this module, never from the working directory: the binary
// unpacks its payload into ~/.cache/contentkit/<key> and starts server.mjs from
// there, so any cwd-relative path would only work when run from a checkout.
// Same pattern as src/config.mjs and src/composition-registry.mjs.
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const COCKPIT_DIR = join(root, 'assets', 'cockpit')
export const COCKPIT_PREFIX = '/cockpit'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

// Vite fingerprints every asset it emits, so those may be cached forever while
// index.html — the only unfingerprinted file — must never be.
const IMMUTABLE = 'public,max-age=31536000,immutable'
const NEVER = 'no-cache'

const cache = new Map()

function read(path) {
  if (cache.has(path)) return cache.get(path)
  let entry = null
  try {
    if (statSync(path).isFile()) {
      const body = readFileSync(path)
      entry = { body, etag: `"${sha256(body).slice(0, 32)}"` }
    }
  } catch {
    // A missing file is a routing outcome, not an error: unknown paths under
    // the prefix fall back to index.html so client-side routing works.
  }
  cache.set(path, entry)
  return entry
}

export function cockpitAvailable(dir = COCKPIT_DIR) {
  return Boolean(read(join(dir, 'index.html')))
}

/**
 * Serves the built console. Returns false when the request is not ours, so the
 * caller can go on matching routes.
 *
 * Deliberately not authenticated: this is a static shell that renders a sign-in
 * prompt when GET /v1/identity/session answers 401. Gating the bundle itself
 * would buy nothing — it contains no data — and would cost the ability to load
 * the console before the session exists.
 */
export function serveCockpit(req, res, path, dir = COCKPIT_DIR) {
  if (path !== COCKPIT_PREFIX && !path.startsWith(`${COCKPIT_PREFIX}/`)) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, '', { allow: 'GET, HEAD' })
    return true
  }

  if (!cockpitAvailable(dir)) {
    send(res, 503, 'ContentKit Cockpit was not built into this deployment.', {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': NEVER,
    })
    return true
  }

  const relative = path.slice(COCKPIT_PREFIX.length).replace(/^\/+/, '')
  // normalize() collapses any ../ before the prefix check. The separator is not
  // decoration: `startsWith(dir)` is a STRING prefix, so every sibling whose name
  // begins with the directory's name passes it —
  // `/cockpit/../cockpit-build-stamp.json` was served with 200 and 21769 bytes,
  // measured. cleanPath() in src/utils.mjs rejects `..` with 400 before routing
  // (src/routes.mjs:1233), but that is a layer up; this function is reachable on
  // its own and has to hold on its own.
  const target = normalize(join(dir, relative))
  const asset = target.startsWith(dir + sep) && relative ? read(target) : null

  const isAsset = Boolean(asset)
  const entry = asset || read(join(dir, 'index.html'))
  const extension = isAsset ? relative.slice(relative.lastIndexOf('.')) : '.html'
  const headers = {
    'content-type': TYPES[extension] || 'application/octet-stream',
    'cache-control': isAsset ? IMMUTABLE : NEVER,
    etag: entry.etag,
    'content-security-policy': COCKPIT_CSP,
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  }

  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, headers)
    res.end()
    return true
  }

  send(res, 200, req.method === 'HEAD' ? '' : entry.body, headers)
  return true
}

// Stricter than the CSP for published pages: the console is entirely
// first-party, needs no inline script beyond the pre-paint theme snippet, and
// talks to nothing but its own origin.
const COCKPIT_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // The blocking theme script in index.html runs before the bundle loads to
  // avoid a light flash; it is the single inline script and carries no data.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ')
