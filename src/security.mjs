export function clientIp(req, trustProxy) {
  if (trustProxy && req.headers['x-forwarded-for']) {
    // Trust only the rightmost entry — the one appended by our own reverse proxy.
    // The leftmost values are client-supplied and trivially spoofable, which would
    // let an attacker rotate them to defeat the per-IP rate limiter.
    const hops = String(req.headers['x-forwarded-for'])
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if (hops.length) return hops[hops.length - 1]
  }
  return req.socket.remoteAddress || 'unknown'
}

export function createLimiter(windowMs = 60000, max = 12) {
  const values = new Map()
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, value] of values) if (value.reset <= now) values.delete(key)
  }, windowMs)
  timer.unref?.()
  return {
    take(key) {
      const now = Date.now()
      let value = values.get(key)
      if (!value || value.reset <= now) value = { count: 0, reset: now + windowMs }
      value.count++
      values.set(key, value)
      return value.count <= max
    },
    stop: () => clearInterval(timer),
  }
}

export async function verifyTurnstile(config, token, ip) {
  // Fail closed: with no secret configured, only an explicit dev bypass accepts
  // submissions. Previously any non-production NODE_ENV silently passed the
  // captcha, so a deploy that forgot NODE_ENV=production accepted all spam.
  if (!config.turnstileSecret) return config.turnstileDevBypass === true
  if (!token) return false
  const body = new URLSearchParams({ secret: config.turnstileSecret, response: token, remoteip: ip })
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
  const result = await response.json()
  return Boolean(result.success)
}

// Content Security Policy for served pages, widened just enough for the site's
// configured analytics provider (kept off the inline-script path so no
// 'unsafe-inline' is ever needed for scripts).
export function contentCsp(analytics) {
  const script = ["'self'", 'https://challenges.cloudflare.com']
  const connect = ["'self'", 'https://challenges.cloudflare.com']
  if (analytics?.provider === 'plausible') {
    let origin = 'https://plausible.io'
    try {
      if (analytics.src) origin = new URL(analytics.src).origin
    } catch {
      /* keep default */
    }
    script.push(origin)
    connect.push(origin)
  } else if (analytics?.provider === 'ga4') {
    script.push('https://www.googletagmanager.com')
    connect.push(
      'https://www.google-analytics.com',
      'https://*.google-analytics.com',
      'https://www.googletagmanager.com',
    )
  }
  return `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src ${script.join(' ')}; frame-src https://challenges.cloudflare.com; connect-src ${connect.join(' ')}; object-src 'none'; base-uri 'self'; form-action 'self'`
}

// Slidev's self-contained output deliberately contains inline module scripts,
// styles, fonts and images. Deck publishing is therefore protected by the
// dedicated deck:render scope and served under this offline-only policy instead
// of weakening the policy used by ordinary ContentKit pages.
export function deckContentCsp() {
  return "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
}
