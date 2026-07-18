import { randomBytes } from 'node:crypto'

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i

function nonZero(value) {
  return !/^0+$/.test(value)
}

export function parseTraceparent(value) {
  const match = TRACEPARENT.exec(String(value || '').trim())
  if (!match) return null
  const traceId = match[1].toLowerCase()
  const parentSpanId = match[2].toLowerCase()
  if (!nonZero(traceId) || !nonZero(parentSpanId)) return null
  return { traceId, parentSpanId, flags: match[3].toLowerCase() }
}

export function createTraceContext(value, random = (bytes) => randomBytes(bytes).toString('hex')) {
  const parent = parseTraceparent(value)
  const traceId = parent?.traceId || random(16)
  const spanId = random(8)
  return {
    traceId,
    spanId,
    parentSpanId: parent?.parentSpanId || null,
    traceparent: `00-${traceId}-${spanId}-${parent?.flags || '01'}`,
  }
}
