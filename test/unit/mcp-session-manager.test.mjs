import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionManager, ownerKey, trackStreamLifetime } from '../../src/mcp/session-manager.mjs'

const logger = { info() {}, warn() {} }
const session = (lastSeenAt, inFlight = 0) => ({
  lastSeenAt,
  inFlight,
  server: { async close() {} },
})

test('MCP session leases expire only while idle and evict oldest idle at capacity', () => {
  let now = 1000
  const manager = createSessionManager({ ttlMs: 100, maxSessions: 2, logger, now: () => now, sweepIntervalMs: 10000 })
  manager.sessions.set('busy', session(0, 1))
  manager.sessions.set('old', session(10))
  manager.evictOverflow()
  assert.deepEqual([...manager.sessions.keys()], ['busy'])
  manager.sessions.set('fresh', session(1000))
  now = 1200
  manager.tick()
  assert.equal(manager.sessions.has('busy'), true)
  assert.equal(manager.sessions.has('fresh'), false)
  manager.closeAll()
})

test('MCP session reservations enforce the hard cap while every lease is busy', () => {
  const manager = createSessionManager({ ttlMs: 100, maxSessions: 1, logger, now: () => 1000 })
  manager.sessions.set('busy', session(1000, 1))
  assert.equal(manager.reserve(), false)
  manager.sessions.get('busy').inFlight = 0
  assert.equal(manager.reserve(), true)
  manager.commit('replacement', session(1000))
  assert.deepEqual([...manager.sessions.keys()], ['replacement'])
  manager.closeAll()
})

test('MCP owner keys bind sessions to credential identity and its live authorization ceiling', () => {
  assert.notEqual(
    ownerKey({ id: 'key-a', name: 'same', scopes: ['content:read'] }),
    ownerKey({ id: 'key-b', name: 'same', scopes: ['content:read'] }),
  )
  assert.notEqual(
    ownerKey({ id: 'key-a', name: 'same', scopes: ['content:read'], site_ids: ['site-a'] }),
    ownerKey({ id: 'key-a', name: 'same', scopes: ['content:read', 'site:admin'], site_ids: ['site-a'] }),
  )
  assert.notEqual(
    ownerKey({ id: 'key-a', name: 'same', scopes: ['content:read'], site_ids: ['site-a'] }),
    ownerKey({ id: 'key-a', name: 'same', scopes: ['content:read'], site_ids: ['site-b'] }),
  )
})

test('SSE stream lifetime releases its session retain on cancellation', async () => {
  let releases = 0
  const stream = trackStreamLifetime(
    new ReadableStream({ pull() {} }),
    { release: () => releases++, reacquire() {}, onForceReleased() {} },
    1000,
  )
  await stream.cancel('client disconnected')
  assert.equal(releases, 1)
})
