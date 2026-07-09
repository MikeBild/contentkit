import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

// Text-to-speech providers behind one interface:
//   synthesize(text, { voice }) → { audio, contentType, durationSecs }
// The first real provider is Google Chirp 3 HD over the plain REST API. Tests
// use the `fake` provider, which is deterministic and never touches the
// network or ffmpeg.

const DEFAULT_VOICE = 'de-DE-Chirp3-HD-Charon'
const SAMPLE_RATE = 24000 // LINEAR16 mono, 16-bit → 48000 bytes per second
// Google caps synthesize input at 5000 bytes; 3800 leaves headroom for the
// JSON envelope and multi-byte characters that sit on a chunk boundary.
const MAX_CHUNK_BYTES = 3800

const utf8Bytes = (value) => Buffer.byteLength(value, 'utf8')

// Packs paragraphs into chunks of at most maxBytes. A paragraph that alone
// exceeds the budget is split at sentence boundaries; a sentence that still
// exceeds it (degenerate, e.g. a table row) is hard-split. Chunk boundaries
// always fall on whitespace the voice would pause at anyway.
export function chunkText(text, maxBytes = MAX_CHUNK_BYTES) {
  const pieces = []
  for (const paragraph of String(text).split(/\n{2,}/)) {
    const trimmed = paragraph.trim()
    if (!trimmed) continue
    if (utf8Bytes(trimmed) <= maxBytes) {
      pieces.push(trimmed)
      continue
    }
    for (const unit of trimmed.split(/(?<=[.!?…])\s+/)) {
      if (utf8Bytes(unit) <= maxBytes) {
        pieces.push(unit)
        continue
      }
      let rest = unit
      while (utf8Bytes(rest) > maxBytes) {
        const slice = Buffer.from(rest, 'utf8').subarray(0, maxBytes).toString('utf8')
        const cut = slice.lastIndexOf(' ')
        const head = cut > 0 ? slice.slice(0, cut) : slice.replace(/�+$/, '')
        pieces.push(head)
        rest = rest.slice(head.length).trim()
      }
      if (rest) pieces.push(rest)
    }
  }
  const chunks = []
  let current = ''
  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece
    if (utf8Bytes(candidate) <= maxBytes) {
      current = candidate
    } else {
      if (current) chunks.push(current)
      current = piece
    }
  }
  if (current) chunks.push(current)
  return chunks
}

// LINEAR16 responses are WAV containers. Walk the RIFF chunks to the `data`
// chunk rather than assuming a 44-byte header — Google may emit extra chunks.
export function pcmFromWav(wav) {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('TTS response is not a RIFF/WAVE container')
  }
  let offset = 12
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (id === 'data') return wav.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + (size % 2)
  }
  throw new Error('TTS response WAV has no data chunk')
}

// Encodes raw 16-bit mono PCM to MP3 (64 kbps) via the ffmpeg binary on the
// host — a deliberate runtime dependency instead of a JS encoder dependency.
// The path is overridable with CONTENTKIT_FFMPEG.
function encodeMp3(ffmpegPath, pcm) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      's16le',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      '-i',
      'pipe:0',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '64k',
      '-f',
      'mp3',
      'pipe:1',
    ]
    const child = spawn(ffmpegPath || 'ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    const errors = []
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => errors.push(chunk))
    child.on('error', (error) => reject(new Error(`ffmpeg failed to start: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errors).toString('utf8').slice(0, 500)}`))
    })
    // EPIPE surfaces on close with the exit code; don't crash the process on it.
    child.stdin.on('error', () => {})
    child.stdin.end(pcm)
  })
}

function googleProvider(config, fetchImpl = fetch) {
  return {
    name: 'google',
    async synthesize(text, { voice = DEFAULT_VOICE } = {}) {
      // Chirp voice names lead with their BCP-47 tag (de-DE-Chirp3-HD-Charon).
      const languageCode = String(voice).split('-').slice(0, 2).join('-')
      const url = new URL('https://texttospeech.googleapis.com/v1/text:synthesize')
      const headers = { 'content-type': 'application/json' }
      if (config.ttsGoogleToken) headers.authorization = `Bearer ${config.ttsGoogleToken}`
      else if (config.ttsGoogleApiKey) url.searchParams.set('key', config.ttsGoogleApiKey)
      else throw new Error('CONTENTKIT_TTS_GOOGLE_API_KEY or CONTENTKIT_TTS_GOOGLE_TOKEN is not configured')
      if (config.ttsGoogleQuotaProject) headers['x-goog-user-project'] = config.ttsGoogleQuotaProject
      const pcmParts = []
      for (const chunk of chunkText(text)) {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: { text: chunk },
            voice: { languageCode, name: voice },
            audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE },
          }),
        })
        if (!response.ok) {
          const body = await response.text().catch(() => '')
          throw new Error(`TTS synthesize failed (${response.status}): ${body.slice(0, 300)}`)
        }
        const { audioContent } = await response.json()
        if (!audioContent) throw new Error('TTS synthesize returned no audioContent')
        pcmParts.push(pcmFromWav(Buffer.from(audioContent, 'base64')))
      }
      // Chunks share the sample format, so raw PCM concatenates gaplessly; the
      // single ffmpeg pass then yields one seamless MP3 instead of a frame splice.
      const pcm = Buffer.concat(pcmParts)
      const durationSecs = pcm.length / (SAMPLE_RATE * 2)
      const audio = await encodeMp3(config.ffmpegPath, pcm)
      return { audio, contentType: 'audio/mpeg', durationSecs }
    },
  }
}

// One silent-ish MPEG-1 Layer III frame (128 kbps, 44.1 kHz mono ≙ 417 bytes):
// enough for `file`/browsers to accept the payload as MP3. The frame body is
// derived from the input text, so identical text yields identical bytes and the
// content-addressed asset path stays stable across test runs.
function fakeProvider() {
  return {
    name: 'fake',
    async synthesize(text) {
      const header = Buffer.from([0xff, 0xfb, 0x90, 0x64])
      const body = Buffer.alloc(413)
      createHash('sha256').update(String(text)).digest().copy(body)
      // ≈17 characters per spoken second is a serviceable German prose estimate.
      const durationSecs = Math.max(1, Math.round(String(text).length / 17))
      return { audio: Buffer.concat([header, body]), contentType: 'audio/mpeg', durationSecs }
    },
  }
}

export function createTtsProvider(config, name = 'google', fetchImpl = fetch) {
  if (name === 'fake') return fakeProvider()
  if (name === 'google') return googleProvider(config, fetchImpl)
  throw Object.assign(new Error(`unknown TTS provider: ${name}`), { statusCode: 422 })
}
