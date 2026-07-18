import test from 'node:test'
import assert from 'node:assert/strict'
import { createTraceContext, parseTraceparent } from '../../src/trace-context.mjs'

test('W3C trace context continues a valid trace with a fresh server span', () => {
  const incoming = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
  const trace = createTraceContext(incoming, (bytes) => (bytes === 8 ? 'a'.repeat(16) : 'b'.repeat(32)))
  assert.deepEqual(parseTraceparent(incoming), {
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    parentSpanId: '00f067aa0ba902b7',
    flags: '01',
  })
  assert.equal(trace.traceparent, '00-4bf92f3577b34da6a3ce929d0e0e4736-aaaaaaaaaaaaaaaa-01')
  assert.equal(trace.parentSpanId, '00f067aa0ba902b7')
})

test('invalid or all-zero traceparents are ignored', () => {
  assert.equal(parseTraceparent('00-00000000000000000000000000000000-0000000000000000-01'), null)
  const trace = createTraceContext('invalid', (bytes) => (bytes === 16 ? 'b'.repeat(32) : 'c'.repeat(16)))
  assert.equal(trace.traceparent, `00-${'b'.repeat(32)}-${'c'.repeat(16)}-01`)
})
