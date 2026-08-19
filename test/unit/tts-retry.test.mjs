// The path that took four narrations out, end to end.
//
// A Markdown table reached the provider as one unpunctuated paragraph, Chirp 3
// HD answered `400 … sentences that are too long`, and the retry loop — which
// never looked at the status — sent the identical request four more times.
// Nothing here was covered: chunkText had no tests at all, and the
// googleProvider HTTP branch was unreachable from the suite even though
// createTtsProvider has always taken a fetchImpl for exactly this.
import test from 'node:test'
import assert from 'node:assert/strict'
import { extractSpeechText } from '../../src/speech-text.mjs'
import { chunkText, createTtsProvider } from '../../src/tts.mjs'
import { isRetryable, backoffSeconds } from '../../src/retry.mjs'

const doc = (body) => `---\nkind: post\ntitle: Tabellen\nlocale: de\nslug: tabellen\n---\n${body}`

const TABLE = [
  '| Anbieter | Modell | Eingehende Tokens | Ausgehende Tokens | Kosten pro Million |',
  '| --- | --- | --- | --- | --- |',
  '| Erster Anbieter | Grosses Modell | zwei Millionen | eine Million | zehn Euro |',
  '| Zweiter Anbieter | Kleines Modell | drei Millionen | zwei Millionen | ein Euro |',
].join('\n')

test('a Markdown table becomes one sentence per row, not one paragraph', () => {
  const { text } = extractSpeechText(doc(TABLE))
  // The separator row is punctuation for the eye and must stay silent.
  assert.doesNotMatch(text, /---/)
  // Pipes are not words.
  assert.doesNotMatch(text, /\|/)
  const rows = text.split('\n').filter((line) => line.includes('Anbieter') || line.includes('Modell'))
  assert.ok(rows.length >= 3, `expected a sentence per row, got:\n${text}`)
  for (const row of rows) assert.match(row, /\.$/, `row is not a sentence: ${row}`)
})

test('the exact table that failed in production is now split below the cap', () => {
  // 702 bytes as one unpunctuated run — the shape that answered 400 five times.
  const table = [
    '| Baustein | Verantwortete Daten | Geeignete Schnittstellen | Was dort nicht entschieden wird |',
    '| --- | --- | --- | --- |',
    '| WikiKit | Quellen und einzeln prüfbare Aussagen | Lesen, Vorschlagen, Freigeben | Wie ein Beitrag am Ende aussieht |',
    '| ContentKit | Veröffentlichte Fassungen und Releases | Ingest, Release, Lesen | Woher eine Aussage stammt |',
  ].join('\n')
  const { text } = extractSpeechText(doc(table))
  const longest = Math.max(...text.split(/(?<=[.!?…])\s+/).map((s) => Buffer.byteLength(s, 'utf8')))
  // Bracketed from production: 423 bytes succeeded, 702 failed.
  assert.ok(longest <= 420, `longest sentence is ${longest} bytes, above the cap`)
})

test('a long unpunctuated paragraph under the chunk budget is still split', () => {
  // 2000 bytes: comfortably inside MAX_CHUNK_BYTES, far past what the provider
  // accepts as one sentence. The old shape returned it untouched.
  const run = 'wort '.repeat(400).trim()
  assert.ok(Buffer.byteLength(run, 'utf8') < 3800)
  const chunks = chunkText(run)
  assert.ok(chunks.length > 1, 'expected the run to be split')
  for (const chunk of chunks) assert.ok(Buffer.byteLength(chunk, 'utf8') <= 420, 'chunk exceeds the sentence cap')
  // Splitting must not lose words.
  assert.equal(chunks.join(' ').split(/\s+/).length, run.split(/\s+/).length)
})

test('ordinary prose is left as one chunk', () => {
  const chunks = chunkText('Ein kurzer Satz. Noch einer.')
  assert.deepEqual(chunks, ['Ein kurzer Satz. Noch einer.'])
})

test('a 400 from the provider carries its status, so it can be classified', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return {
      ok: false,
      status: 400,
      async text() {
        return '{"error":{"code":400,"message":"This request contains sentences that are too long"}}'
      },
    }
  }
  const provider = createTtsProvider({ ttsProvider: 'google', ttsGoogleApiKey: 'test-key' }, 'google', fetchImpl)
  const error = await provider.synthesize('Ein Satz.', {}).then(
    () => null,
    (caught) => caught,
  )
  assert.ok(error, 'expected the provider to throw')
  assert.equal(error.responseStatus, 400)
  assert.equal(calls, 1, 'the provider itself must not loop')
  assert.equal(isRetryable(error), false, 'a 400 must not be retried')
})

test('the classifier keeps retrying what a retry can actually fix', () => {
  assert.equal(isRetryable(Object.assign(new Error('x'), { responseStatus: 503 })), true)
  assert.equal(isRetryable(Object.assign(new Error('x'), { responseStatus: 429 })), true, '429 means "not now"')
  assert.equal(isRetryable(Object.assign(new Error('x'), { responseStatus: 408 })), true, '408 is a timeout')
  assert.equal(isRetryable(Object.assign(new Error('x'), { responseStatus: 404 })), false)
  // No status at all — a socket reset, DNS, our own bug. Refusing to retry
  // these would turn every transient fault into a permanent failure.
  assert.equal(isRetryable(new Error('ECONNRESET')), true)
})

test('backoff grows, is capped, and is jittered', () => {
  const opts = { baseSeconds: 60, capSeconds: 3600, doublings: 6 }
  assert.ok(backoffSeconds(1, opts) < backoffSeconds(4, opts))
  for (let i = 0; i < 50; i += 1) assert.ok(backoffSeconds(99, opts) <= 3600 * 1.15)
  const draws = new Set(Array.from({ length: 20 }, () => backoffSeconds(3, opts)))
  assert.ok(draws.size > 1, 'no jitter')
})
