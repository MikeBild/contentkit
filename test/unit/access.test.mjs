import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearSessionCookie,
  hashReaderPassword,
  mostSpecificAccess,
  normalizeUsername,
  parseCookies,
  previewSessionCookie,
  readerAllowed,
  sessionCookie,
  validReturnTo,
  verifyReaderPassword,
} from '../../src/access.mjs'

test('reader passwords use salted scrypt hashes and verify without exposing the password', async () => {
  const first = await hashReaderPassword('a-long-reader-password')
  const second = await hashReaderPassword('a-long-reader-password')
  assert.match(first, /^scrypt\$32768\$8\$1\$/)
  assert.notEqual(first, second)
  assert.equal(await verifyReaderPassword('a-long-reader-password', first), true)
  assert.equal(await verifyReaderPassword('wrong-password', first), false)
  assert.doesNotMatch(first, /a-long-reader-password/)
})

test('reader credentials and redirects are normalized and bounded', () => {
  assert.equal(normalizeUsername(' Anna.Example '), 'anna.example')
  assert.throws(() => normalizeUsername('x'), /3-64/)
  assert.equal(validReturnTo('/de/docs/?q=x'), '/de/docs/?q=x')
  assert.equal(validReturnTo('//attacker.example/x', '/de/'), '/de/')
  assert.equal(validReturnTo('/\\attacker.example/x', '/de/'), '/de/')
  assert.equal(validReturnTo('/de/\r\nlocation: https://attacker.example', '/de/'), '/de/')
  assert.equal(validReturnTo(`/${'x'.repeat(2048)}`, '/de/'), '/de/')
})

test('the most-specific access rule wins and grants groups or individual readers', () => {
  const entries = [
    { match: 'prefix', path: '/de/docs/', group_slugs: ['customers'], user_ids: [] },
    { match: 'prefix', path: '/de/docs/internal/', group_slugs: ['team'], user_ids: [] },
    { match: 'exact', path: '/de/docs/internal/one/', group_slugs: [], user_ids: ['u-special'] },
  ]
  assert.deepEqual(mostSpecificAccess(entries, '/de/docs/start/').group_slugs, ['customers'])
  assert.deepEqual(mostSpecificAccess(entries, '/de/docs/internal/two/').group_slugs, ['team'])
  const exact = mostSpecificAccess(entries, '/de/docs/internal/one/')
  assert.equal(readerAllowed(exact, { id: 'u-special', groups: [] }), true)
  assert.equal(readerAllowed(exact, { id: 'u-team', groups: ['team'] }), false)
})

// Build time (site-builder) resolves a page URL, serve time (routes) resolves
// the release object behind it. A page that resolves to a rule in one and to
// nothing in the other is a leak in one direction and a broken page in the
// other, so both must go through the same function and land on the same rule.
test('build-time page URLs and serve-time object paths resolve to the same access rule', () => {
  const entries = [
    { match: 'prefix', path: '/de/docs/', group_slugs: ['customers'], user_ids: [] },
    { match: 'exact', path: '/de/handbook/', group_slugs: ['team'], user_ids: [] },
    { match: 'exact', path: '/de/notes/index.html', group_slugs: ['authors'], user_ids: [] },
  ]
  for (const url of ['/de/docs/start/', '/de/handbook/', '/de/public/']) {
    assert.deepEqual(mostSpecificAccess(entries, url), mostSpecificAccess(entries, `${url}index.html`))
  }
  // An exact rule authored on the object itself still wins over its directory.
  assert.deepEqual(mostSpecificAccess(entries, '/de/notes/index.html').group_slugs, ['authors'])
  assert.equal(mostSpecificAccess(entries, '/de/notes/'), undefined)
})

test('reader cookies are HttpOnly, same-site and clearable', () => {
  const cookie = sessionCookie('secret', { secure: true })
  assert.match(cookie, /^__Host-contentkit_session=secret;/)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  assert.match(cookie, /Secure/)
  assert.match(sessionCookie('secret', { secure: false }), /^contentkit_session=secret;/)
  assert.equal(parseCookies('__Host-contentkit_session=secret; a=b')['__Host-contentkit_session'], 'secret')
  assert.deepEqual(parseCookies('broken=%E0%A4%A; usable=yes'), { usable: 'yes' })
  assert.match(clearSessionCookie({ secure: true }), /Max-Age=0/)
  assert.match(clearSessionCookie({ secure: false }), /^contentkit_session=/)
})

test('preview cookies are secure and scoped to one memorable preview path', () => {
  const cookie = previewSessionCookie('session-secret', 'article-review', { secure: true, maxAge: 600 })
  assert.match(cookie, /^__Secure-contentkit_preview=session-secret;/)
  assert.match(cookie, /Path=\/previews\/article-review\//)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  assert.match(cookie, /Max-Age=600/)
  assert.match(cookie, /Secure/)
})
