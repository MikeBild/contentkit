import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('development defaults describe a complete isolated local stack', async () => {
  const raw = await readFile(new URL('../../.env.defaults', import.meta.url), 'utf8')
  assert.match(raw, /^DATABASE_URL=postgresql:\/\/postgres:contentkit-local@127\.0\.0\.1:55432\/contentkit$/m)
  assert.match(raw, /^SUPABASE_URL=http:\/\/127\.0\.0\.1:55433$/m)
  assert.match(raw, /^CONTENTKIT_BOOTSTRAP_API_KEY=contentkit-local-admin$/m)
  assert.doesNotMatch(raw, /^NODE_ENV=production$/m)
})
