import { randomBytes, randomUUID } from 'node:crypto'
import { hmac256, safeEqual } from './utils.mjs'

const TTL_MS = 10 * 60 * 1000

const escapeHtml = (value) =>
  String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

function page(title, body, status = 200, { form = false } = {}) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>html{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:32px;background:#f5f5f4;color:#1c1917}.card{max-width:620px;margin:8vh auto;background:#fff;border:1px solid #d6d3d1;border-radius:18px;padding:28px;box-shadow:0 18px 50px #1c19171a}.brand{font-weight:750}.secret{display:block;overflow-wrap:anywhere;padding:16px;margin:18px 0;background:#f5f5f4;border:1px solid #d6d3d1;border-radius:10px;font:14px/1.5 ui-monospace,monospace;color:#1c1917}.warn{color:#92400e}@media(prefers-color-scheme:dark){body{background:#0c0a09;color:#fafaf9}.card{background:#1c1917;border-color:#44403c}.secret{background:#292524;border-color:#57534e;color:#fafaf9}.warn{color:#fbbf24}}</style></head><body><main class="card"><div class="brand">CK · ContentKit</div>${body}</main></body></html>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        pragma: 'no-cache',
        'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action ${form ? "'self'" : "'none'"}`,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}

export function createSecretHandoffs(config, logger) {
  const entries = new Map()
  const secret = config.oauthSecret || config.keyPepper || randomBytes(32).toString('base64url')

  function create({ secret: value, label, onReveal, onExpire }) {
    const id = randomUUID()
    const token = `cksh_${randomBytes(32).toString('base64url')}`
    const tokenHash = hmac256(secret, token)
    const expiresAt = Date.now() + TTL_MS
    const timer = setTimeout(() => void cancel(id), TTL_MS)
    timer.unref?.()
    entries.set(id, { id, tokenHash, value, label, expiresAt, timer, onReveal, onExpire, notifier: null })
    return {
      id,
      url: `${config.publicUrl}/oauth/secret/${encodeURIComponent(id)}/${encodeURIComponent(token)}`,
      expiresInSeconds: Math.floor(TTL_MS / 1000),
    }
  }

  function setNotifier(id, notifier) {
    const entry = entries.get(id)
    if (entry) entry.notifier = notifier
  }

  async function cancel(id) {
    const entry = entries.get(id)
    if (!entry) return false
    entries.delete(id)
    clearTimeout(entry.timer)
    await entry.onExpire?.()
    return true
  }

  async function handler(request) {
    if (!['GET', 'POST'].includes(request.method)) {
      return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
    }
    const match = new URL(request.url).pathname.match(/^\/oauth\/secret\/([^/]+)\/([^/]+)$/)
    if (!match) return new Response('Not found', { status: 404 })
    const entry = entries.get(decodeURIComponent(match[1]))
    const supplied = decodeURIComponent(match[2])
    if (!entry || entry.expiresAt <= Date.now() || !safeEqual(hmac256(secret, supplied), entry.tokenHash)) {
      return page(
        'Secret unavailable',
        '<h1>Secret unavailable</h1><p>This one-time link is invalid, expired, or already used.</p>',
        410,
      )
    }
    if (request.method === 'GET') {
      return page(
        entry.label,
        `<h1>${escapeHtml(entry.label)}</h1><p class="warn">This secret can be revealed exactly once.</p><p>Continue only when you are ready to copy it into your secret manager.</p><form method="POST"><button type="submit">Reveal secret once</button></form>`,
        200,
        { form: true },
      )
    }
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(config.publicUrl).origin) {
      return page('Forbidden', '<h1>Forbidden</h1><p>The reveal request came from an invalid origin.</p>', 403)
    }
    try {
      await entry.onReveal?.()
    } catch (error) {
      logger.warn('secret handoff activation failed', {
        elicitation_id: entry.id,
        error: String(error.message || error),
      })
      return page(
        'Secret temporarily unavailable',
        '<h1>Secret temporarily unavailable</h1><p>The credential could not be activated. Retry this same link.</p>',
        503,
      )
    }
    entries.delete(entry.id)
    clearTimeout(entry.timer)
    try {
      await entry.notifier?.()
    } catch (error) {
      logger.warn('MCP URL elicitation completion notification failed', {
        elicitation_id: entry.id,
        error: String(error.message || error),
      })
    }
    return page(
      entry.label,
      `<h1>${escapeHtml(entry.label)}</h1><p class="warn">Copy this secret now. It will not be shown again.</p><code class="secret">${escapeHtml(entry.value)}</code><p>You can close this page after storing it in your secret manager.</p>`,
    )
  }

  async function stop() {
    await Promise.all([...entries.keys()].map((id) => cancel(id)))
  }

  return { create, setNotifier, cancel, handler, stop, size: () => entries.size }
}
