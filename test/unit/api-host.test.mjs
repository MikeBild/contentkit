// Which requests count as the API surface.
//
// One process answers for the API host and for every published site. Paths
// marked `apiHostOnly` — /metrics, /openapi.json, /llms.txt — exist only on the
// former, so a reader's blog never serves contentkit's telemetry or its
// developer documentation in place of its own llms.txt.
//
// The distinction is the Host header and nothing else. In particular loopback
// is NOT the API surface: an attempt to make it one broke every site test in
// server-routes.test.mjs at once, because Node's fetch refuses to set `Host`
// and the harness therefore reaches the server as 127.0.0.1 while meaning
// "some site". A monitor that needs /metrics resolves the API hostname to the
// loopback address instead, which sends the right Host and changes nothing
// here.

import assert from 'node:assert/strict'
import test from 'node:test'
import { isApiHost } from '../../src/routes.mjs'

const config = { publicUrl: 'https://contentkit-api.example.com' }
const req = (host) => ({ headers: host === undefined ? {} : { host } })

test('the configured API hostname is the API surface, with or without a port', () => {
  assert.equal(isApiHost(req('contentkit-api.example.com'), config), true)
  assert.equal(isApiHost(req('contentkit-api.example.com:4050'), config), true)
})

test('a published site host is not', () => {
  assert.equal(isApiHost(req('blog.reader.example'), config), false)
  assert.equal(isApiHost(req('www.mikebild.dev'), config), false)
  assert.equal(isApiHost(req('127.0.0.1:4050'), config), false)
})

test('a missing Host header is not the API surface', () => {
  assert.equal(isApiHost(req(undefined), config), false)
  assert.equal(isApiHost(req(''), config), false)
})

test('an IPv6 Host is parsed as an address, not shredded at the first colon', () => {
  // `split(":")[0]` turns `::1` into the empty string and `[::1]:4050` into
  // `[`. Neither equals a configured hostname, so the bug never changed an
  // answer here — but the same helper decides which surface a request reached,
  // and a host-matching function that mangles an entire address family is one
  // configuration change away from mattering.
  const v6 = { publicUrl: 'http://[::1]:4050' }
  assert.equal(isApiHost(req('[::1]:4050'), v6), true)
  assert.equal(isApiHost(req('::1'), v6), true)
  assert.equal(isApiHost(req('[2001:db8::1]:4050'), v6), false)
})
