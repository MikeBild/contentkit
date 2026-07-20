import test from 'node:test'
import assert from 'node:assert/strict'
import { createLogger } from '../../src/logger.mjs'

test('structured logs carry stable OpenTelemetry resource field names', () => {
  const original = process.stdout.write
  let line = ''
  process.stdout.write = (value) => {
    line += value
    return true
  }
  try {
    createLogger({ version: '1.2.3', deploymentEnvironment: 'test' }).info('ready', {
      'service.name': 'cannot-override',
    })
  } finally {
    process.stdout.write = original
  }
  const record = JSON.parse(line)
  assert.equal(record['service.name'], 'contentkit')
  assert.equal(record['service.version'], '1.2.3')
  assert.equal(record['deployment.environment.name'], 'test')
})

function captureLines(journalStream, run) {
  const original = process.stdout.write
  const hadStream = 'JOURNAL_STREAM' in process.env
  const previousStream = process.env.JOURNAL_STREAM
  const lines = []
  process.stdout.write = (value) => {
    lines.push(String(value))
    return true
  }
  if (journalStream) process.env.JOURNAL_STREAM = journalStream
  else delete process.env.JOURNAL_STREAM
  try {
    run(createLogger({ logLevel: 'debug' }))
  } finally {
    process.stdout.write = original
    if (hadStream) process.env.JOURNAL_STREAM = previousStream
    else delete process.env.JOURNAL_STREAM
  }
  return lines
}

test('under systemd, warn/error lines carry sd-daemon priority prefixes', () => {
  const lines = captureLines('9:12345', (logger) => {
    logger.error('boom', { detail: 1 })
    logger.warn('careful')
    logger.info('fine')
    logger.debug('noise')
  })
  assert.ok(lines[0].startsWith('<3>{'))
  assert.ok(lines[1].startsWith('<4>{'))
  assert.ok(lines[2].startsWith('{'))
  assert.ok(lines[3].startsWith('{'))
  // The JSON payload itself is unchanged: the prefix is for journald only.
  const record = JSON.parse(lines[0].slice('<3>'.length))
  assert.equal(record.level, 'error')
  assert.equal(record.msg, 'boom')
  assert.equal(record.detail, 1)
})

test('without JOURNAL_STREAM, lines stay plain JSON', () => {
  const lines = captureLines('', (logger) => {
    logger.error('boom')
    logger.warn('careful')
  })
  assert.ok(lines[0].startsWith('{'))
  assert.ok(lines[1].startsWith('{'))
  assert.equal(JSON.parse(lines[0]).level, 'error')
})
