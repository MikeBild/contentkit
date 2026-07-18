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
