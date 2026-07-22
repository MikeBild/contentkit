import { escapeHtml } from '../utils.mjs'

// The form actions are fixed server-side. Do not add `form-action 'self'` here:
// browsers apply it across the OAuth decision redirect and can block the
// registered cross-origin client callback (for example chatgpt.com).
export const AUTH_UI_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"

const TOKENS = `
  :root{color-scheme:light;--bg:#f4f5f7;--card:#fff;--ink:#1f2328;--muted:#6a7280;--line:#e3e5e9;--soft:#f7f8fa;--primary:#1f6feb;--primary-hover:#1a60d0}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;padding:24px;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink)}
  .card{background:var(--card);width:100%;max-width:420px;border:1px solid var(--line);border-radius:14px;box-shadow:0 10px 30px rgba(20,24,33,.08);padding:32px}
  .brand{display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:11px;background:var(--ink);color:#fff;font-weight:700;font-size:18px;letter-spacing:-.03em;margin:0 0 20px}
  h1{font-size:1.2rem;line-height:1.3;margin:0 0 8px}p{margin:0 0 10px;line-height:1.5}.muted{color:var(--muted);font-size:.9rem}.strong{font-weight:600}.error{color:#a21b1b}
  ul.scopes{list-style:none;margin:18px 0 4px;padding:0}ul.scopes li{padding:12px 14px;margin-bottom:8px;background:var(--soft);border:1px solid #ebedf0;border-radius:9px}.provider-stack{display:grid;gap:10px;margin-top:20px}
  .scope-row{display:flex;align-items:flex-start;gap:10px;cursor:pointer}.scope-row input[type=checkbox]{margin-top:2px;flex:none}.scope-text{display:flex;flex-direction:column;gap:2px}.scope-name{font-weight:600;font-size:.92rem}.scope-desc{color:var(--muted);font-size:.85rem}
  label.field{display:block;margin:16px 0 0;font-size:.9rem;font-weight:600}input[type=password]{width:100%;margin-top:6px;padding:11px 12px;border:1px solid #d6d9de;border-radius:9px;font:inherit}
  .actions{display:flex;gap:10px;margin-top:22px}button,.button{flex:1;min-height:44px;padding:11px 18px;display:flex;align-items:center;justify-content:center;font-size:.95rem;font-weight:600;cursor:pointer;border-radius:9px;border:1px solid transparent;font-family:inherit;text-align:center;text-decoration:none}.provider-stack .button{width:100%}.approve{background:var(--primary);color:#fff}.approve:hover{background:var(--primary-hover)}.deny{background:#fff;color:var(--ink);border-color:#d6d9de}.deny:hover{background:var(--bg)}
  .switch{display:block;margin:16px auto 0;padding:0;border:0;background:transparent;color:var(--muted);font-size:.82rem;text-decoration:underline}.footer{margin-top:20px;color:#99a0aa;font-size:.78rem;text-align:center}@media(max-width:480px){body{padding:12px}.card{padding:24px}.actions{flex-direction:column-reverse}}
`

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="mcp-auth-ui-contract" content="2"><title>${escapeHtml(title)} — ContentKit</title><style>${TOKENS}</style></head><body><main class="card" data-auth-contract="mcp-auth-v2"><div class="brand" aria-label="ContentKit">ck</div>${body}<div class="footer">ContentKit MCP · OAuth 2.1</div></main></body></html>`
}

const scopeLabels = {
  'mcp:read': ['Read', 'Read published content, resources and product statistics'],
  'mcp:authoring': ['Authoring', 'Create drafts, revisions, semantic visualizations, decks and previews'],
  'mcp:admin': ['Administration', 'Publish live releases and administer sites, access, credentials and moderation'],
}

export function renderConsentPage(options) {
  const checked = new Set(options.preChecked || [])
  const items = options.offeredScopes
    .map((scope) => {
      const [name, description] = scopeLabels[scope] || [scope, scope]
      const baseline = scope === 'mcp:read'
      return `<li><label class="scope-row"><input type="checkbox" name="scope" value="${escapeHtml(scope)}"${baseline || checked.has(scope) ? ' checked' : ''}${baseline ? ' disabled' : ''}><span class="scope-text"><span class="scope-name">${escapeHtml(name)} · ${escapeHtml(scope)}</span><span class="scope-desc">${escapeHtml(description)}</span></span></label>${baseline ? `<input type="hidden" name="scope" value="${escapeHtml(scope)}">` : ''}</li>`
    })
    .join('')
  const siteText = options.siteNames?.length ? options.siteNames.join(', ') : 'all granted ContentKit sites'
  return shell(
    'Authorize access',
    `<h1>Authorize access</h1><p><span class="strong">${escapeHtml(options.clientName)}</span> is requesting access to <span class="strong">${escapeHtml(siteText)}</span>.</p><p class="muted">Signed in as ${escapeHtml(options.identityLabel)}</p><p class="muted">It will be able to:</p><form method="POST" action="/v1/oauth/authorize/decision"><ul class="scopes">${items}</ul><input type="hidden" name="csrf_token" value="${escapeHtml(options.csrfToken)}"><input type="hidden" name="login_state" value="${escapeHtml(options.loginState)}"><div class="actions"><button type="submit" name="decision" value="deny" class="deny">Deny</button><button type="submit" name="decision" value="approve" class="approve">Approve</button></div><button type="submit" name="decision" value="switch_account" class="switch">Use another account</button></form>`,
  )
}

export function renderProviderChoice(options) {
  const providers = options.providers
    .map((provider) => {
      const href = `/v1/identity/login/start?login_state=${encodeURIComponent(options.state)}&provider=${encodeURIComponent(provider.id)}`
      const label = provider.protocol === 'api_key' ? 'Continue with API key' : 'Continue with SSO'
      return `<a class="button approve" href="${href}">${label}</a>`
    })
    .join('')
  return shell(
    'Sign in',
    `<h1>Sign in to ContentKit</h1><p class="muted">Choose how to authenticate this authorization request.</p><div class="provider-stack">${providers}</div>`,
  )
}

export function renderApiKeyLogin(options) {
  return shell(
    'Sign in',
    `<h1>Sign in to ContentKit</h1><p class="muted">Use a scoped ContentKit API key to authorize this MCP client.</p>${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ''}<form method="POST" action="/v1/identity/login/start"><input type="hidden" name="provider" value="${escapeHtml(options.providerId)}"><input type="hidden" name="login_state" value="${escapeHtml(options.state)}"><label class="field">API key<input type="password" name="api_key" autocomplete="current-password" required></label><div class="actions"><button class="approve" type="submit">Continue</button></div></form>`,
  )
}

export function authHtmlResponse(html, status = 200, headers = {}) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private,no-store',
      'content-security-policy': AUTH_UI_CSP,
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
    },
  })
}
