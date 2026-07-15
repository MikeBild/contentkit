import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

// The OSS repo must stay free of the private production domain. Assemble the
// needle from fragments so this guard file never matches itself, and exclude it
// from the scan for good measure.
test('no production domain references in tracked files', () => {
  const needle = ['mikebild', 'dev'].join('\\.')
  let hits
  try {
    hits = execFileSync('git', ['grep', '-nIE', needle, '--', '.', ':!test/unit/no-prod-references.test.mjs'], {
      cwd: root,
      encoding: 'utf8',
    })
  } catch (err) {
    // git grep exits 1 with empty stdout when there are no matches — success.
    if (err.status === 1 && !err.stdout) return
    throw err
  }
  assert.equal(hits, '', `production domain reference(s) found:\n${hits}`)
})
