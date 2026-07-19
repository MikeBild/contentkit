import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

test('standalone binary payload includes every external composition registry', () => {
  const script = readFileSync(join(root, 'build-binary.sh'), 'utf8')
  const payload = script.match(/tar --use-compress-program[\s\S]*?\nKEY=/)?.[0] || ''

  assert.match(payload, /\bpatterns\b/, 'pattern registry is missing from the binary payload')
  assert.match(payload, /\bguides\b/, 'publishing-guide registry is missing from the binary payload')
})
