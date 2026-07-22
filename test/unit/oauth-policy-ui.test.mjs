import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  defaultProductScopes,
  effectiveProductScopes,
  roleForProductScopes,
  roleOauthScopes,
} from '../../src/oauth/policy.mjs'
import { AUTH_UI_CSP, authHtmlResponse, renderConsentPage, renderProviderChoice } from '../../src/oauth/ui.mjs'

const COMMON_STYLE_SHA256 = '61333cf68d1c955484e7c8fd1e5b68ad9ff4caf9e99799493f868bd19dcb9e64'

test('OAuth roles and the live product ceiling both constrain effective scopes', () => {
  assert.deepEqual(roleOauthScopes('reader'), ['mcp:read'])
  assert.deepEqual(roleOauthScopes('author'), ['mcp:read', 'mcp:authoring'])
  assert.ok(roleOauthScopes('admin').includes('mcp:admin'))
  assert.deepEqual(effectiveProductScopes(['mcp:admin'], ['content:read', 'identity:admin']), [
    'content:read',
    'identity:admin',
  ])
  assert.ok(defaultProductScopes('admin').includes('audit:read'))
  assert.equal(roleForProductScopes(['content:read', 'identity:admin']), 'admin')
  assert.equal(roleForProductScopes(['content:read', 'audit:read']), 'admin')
  assert.equal(roleForProductScopes(['content:read', 'content:write']), 'author')
  assert.ok(defaultProductScopes('author').includes('release:preview'))
})

test('common consent escapes identities and keeps baseline read mandatory', async () => {
  const html = renderConsentPage({
    clientName: '<script>bad</script>',
    identityLabel: 'operator@example.com',
    siteNames: ['Example'],
    offeredScopes: ['mcp:read', 'mcp:authoring'],
    preChecked: ['mcp:read'],
    csrfToken: 'csrf',
    loginState: 'state',
  })
  assert.doesNotMatch(html, /<script>bad/)
  assert.match(html, /value="mcp:read" checked disabled/)
  assert.match(html, /type="hidden" name="scope" value="mcp:read"/)
  assert.match(html, /max-width:420px/)
  assert.match(html, /data-auth-contract="mcp-auth-v2"/)
  assert.match(html, /name="mcp-auth-ui-contract" content="2"/)
  assert.match(html, /value="switch_account"/)
  const response = authHtmlResponse(html)
  assert.equal(response.headers.get('content-security-policy'), AUTH_UI_CSP)
  assert.doesNotMatch(AUTH_UI_CSP, /form-action/, 'OAuth client redirects must not be blocked by the consent CSP')
  assert.equal(response.headers.get('cache-control'), 'private,no-store')
})

test('provider chooser exposes the canonical SSO-first CTA contract', () => {
  const html = renderProviderChoice({
    state: 'state',
    providers: [
      { id: 'workforce', protocol: 'oidc', label: 'Continue with SSO' },
      { id: 'api-key', protocol: 'api_key', label: 'ContentKit API key' },
    ],
  })
  assert.ok(html.indexOf('Continue with SSO') < html.indexOf('Continue with API key'))
  assert.match(html, /class="provider-stack"/)
  assert.doesNotMatch(html, /Continue with Continue with/)
  const styles = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
  assert.equal(createHash('sha256').update(styles).digest('hex'), COMMON_STYLE_SHA256)
})
