import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  defaultProductScopes,
  effectiveProductScopes,
  oauthTiersForCeiling,
  roleForProductScopes,
} from '../../src/oauth/policy.mjs'
import {
  AUTH_UI_CSP,
  authHtmlResponse,
  renderConsentPage,
  renderErrorPage,
  renderProviderChoice,
} from '../../src/oauth/ui.mjs'

const COMMON_STYLE_SHA256 = 'fb9d19063e79757a73139720508cf27207214b98405e156bab894bad85796a0c'

test('the live product ceiling constrains effective scopes and derives the display role', () => {
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

test('mcp tiers are derived from the stored product-scope ceiling, never from the role', () => {
  assert.deepEqual(oauthTiersForCeiling([]), [])
  assert.deepEqual(oauthTiersForCeiling(['content:read']), ['mcp:read'])
  assert.deepEqual(oauthTiersForCeiling(['stats:read']), ['mcp:read'])
  assert.deepEqual(oauthTiersForCeiling(['content:read', 'content:write']), ['mcp:read', 'mcp:authoring'])
  assert.deepEqual(oauthTiersForCeiling(['content:read', 'deck:render']), ['mcp:read', 'mcp:authoring'])
  assert.deepEqual(oauthTiersForCeiling(['release:preview']), ['mcp:authoring'])
  assert.deepEqual(oauthTiersForCeiling(['content:read', 'stats:read', 'content:write', 'identity:admin']), [
    'mcp:read',
    'mcp:authoring',
    'mcp:admin',
  ])
  assert.deepEqual(oauthTiersForCeiling(['release:write']), ['mcp:admin'])
  assert.deepEqual(oauthTiersForCeiling(defaultProductScopes('admin')), ['mcp:read', 'mcp:authoring', 'mcp:admin'])
  assert.deepEqual(oauthTiersForCeiling(defaultProductScopes('author')), ['mcp:read', 'mcp:authoring'])
  assert.deepEqual(oauthTiersForCeiling(defaultProductScopes('reader')), ['mcp:read'])
  // the configured allow-list still filters the offered tiers
  assert.deepEqual(oauthTiersForCeiling(defaultProductScopes('admin'), ['mcp:read', 'mcp:authoring']), [
    'mcp:read',
    'mcp:authoring',
  ])
  // unknown scopes never unlock a tier
  assert.deepEqual(oauthTiersForCeiling(['nonsense:scope']), [])
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
  assert.match(styles, /--primary:#1f2328;--primary-hover:#000/)
  assert.equal(createHash('sha256').update(styles).digest('hex'), COMMON_STYLE_SHA256)
})

test('sign-in error page keeps the common template contract and escapes content', () => {
  const html = renderErrorPage('Sign-in failed', '<b>Broken</b> & unsafe', '/v1/identity/login/start')
  assert.match(html, /<h1>Sign-in failed<\/h1>/)
  assert.doesNotMatch(html, /<b>Broken/)
  assert.match(html, /&lt;b&gt;Broken&lt;\/b&gt; &amp; unsafe/)
  assert.match(html, /<a class="button approve" href="\/v1\/identity\/login\/start">Sign in again<\/a>/)
  assert.match(html, /data-auth-contract="mcp-auth-v2"/)
  assert.match(html, /name="mcp-auth-ui-contract" content="2"/)
})
