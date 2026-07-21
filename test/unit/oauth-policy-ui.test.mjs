import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultProductScopes,
  effectiveProductScopes,
  roleForProductScopes,
  roleOauthScopes,
} from '../../src/oauth/policy.mjs'
import { AUTH_UI_CSP, authHtmlResponse, renderConsentPage } from '../../src/oauth/ui.mjs'

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

test('SubKit-style consent escapes identities and keeps baseline read mandatory', async () => {
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
  const response = authHtmlResponse(html)
  assert.equal(response.headers.get('content-security-policy'), AUTH_UI_CSP)
  assert.equal(response.headers.get('cache-control'), 'private,no-store')
})
