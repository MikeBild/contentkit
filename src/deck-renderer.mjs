import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export class DeckBuildError extends Error {
  constructor(message, code, statusCode) {
    super(message)
    this.code = code
    this.statusCode = statusCode
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function injectTheme(html, css) {
  return String(html)
    .replace(/<link\b[^>]*\brel=["']?(?:shortcut )?icon["']?[^>]*>/gi, '')
    .replace(/<link\b[^>]*\brel=["']?apple-touch-icon["']?[^>]*>/gi, '')
    .replace(/<link\b[^>]*fonts\.g(?:oogleapis|static)\.com[^>]*>/gi, '')
    .replace('</head>', `<style data-contentkit-deck-theme>${css}</style></head>`)
}

function killTree(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {}
}

export async function sweepStaleDeckBuilds(config) {
  const rootFiles = await readdir(config.root).catch(() => [])
  const workFiles = await readdir(config.deckWorkDir).catch(() => [])
  await Promise.all([
    ...rootFiles
      .filter((name) => /^\.deck-.*\.md$/.test(name))
      .map((name) => rm(join(config.root, name), { force: true }).catch(() => {})),
    ...workFiles.map((name) => rm(join(config.deckWorkDir, name), { recursive: true, force: true }).catch(() => {})),
  ])
}

function childEnvironment(config) {
  return Object.fromEntries(
    Object.entries({
      PATH: process.env.PATH,
      HOME: config.deckWorkDir,
      TMPDIR: process.env.TMPDIR,
      TMP: process.env.TMP,
      TEMP: process.env.TEMP,
      NODE_ENV: 'production',
      CI: '1',
      NO_COLOR: '1',
    }).filter(([, value]) => value !== undefined),
  )
}

export function createDeckRenderer(config, logger, observer = {}) {
  const waiters = []
  const cache = new Map()
  let active = 0

  async function acquire() {
    if (active < config.deckBuildConcurrency) {
      active++
      return
    }
    if (waiters.length >= config.deckBuildQueueMax) {
      throw new DeckBuildError('deck build queue full', 'QUEUE_FULL', 503)
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((entry) => entry.resolve === resolve)
        if (index >= 0) waiters.splice(index, 1)
        reject(new DeckBuildError('deck queue wait timed out', 'QUEUE_TIMEOUT', 503))
      }, config.deckQueueTimeoutMs)
      timer.unref?.()
      waiters.push({ resolve, timer })
    })
  }

  function release() {
    const next = waiters.shift()
    if (next) {
      clearTimeout(next.timer)
      next.resolve()
    } else active--
  }

  async function slidev(markdown) {
    const id = randomUUID()
    const input = join(config.root, `.deck-${id}.md`)
    const output = join(config.deckWorkDir, `${id}-out`)
    await mkdir(config.deckWorkDir, { recursive: true })
    await writeFile(input, markdown, 'utf8')
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [config.deckSlidevCli, 'build', input, '--out', output, '--base', '/'], {
          cwd: config.root,
          stdio: ['ignore', 'ignore', 'pipe'],
          detached: process.platform !== 'win32',
          // Never expose database/storage/API secrets to deck build plugins.
          // Deck source is still trusted code and remains gated by deck:render.
          env: childEnvironment(config),
        })
        let stderr = ''
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          killTree(child, 'SIGTERM')
          setTimeout(() => killTree(child, 'SIGKILL'), 2000).unref?.()
        }, config.deckBuildTimeoutMs)
        child.stderr.on('data', (chunk) => (stderr = `${stderr}${chunk}`.slice(-8000)))
        child.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
        child.once('close', (code) => {
          clearTimeout(timer)
          if (timedOut) reject(new DeckBuildError('deck build timed out', 'TIMEOUT', 504))
          else if (code === 0) resolve()
          else reject(new DeckBuildError(`slidev build exited ${code}: ${stderr.slice(-2000)}`, 'BUILD_FAILED', 422))
        })
      })
      return await readFile(join(output, 'index.html'), 'utf8')
    } finally {
      await Promise.all([
        rm(input, { force: true }).catch(() => {}),
        rm(output, { recursive: true, force: true }).catch(() => {}),
      ])
    }
  }

  async function renderUnlocked(markdown, theme = 'neutral') {
    const key = sha256(`${theme}\0${config.version}\0${markdown}`)
    if (cache.has(key)) {
      observer.cache?.('hit')
      return { html: cache.get(key), etag: `"${key}"`, cache: 'hit' }
    }
    observer.cache?.('miss')
    const started = Date.now()
    try {
      const [built, css] = await Promise.all([
        slidev(markdown),
        readFile(join(config.root, 'assets', `deck-${theme}.css`), 'utf8'),
      ])
      const html = injectTheme(built, css)
      cache.set(key, html)
      while (cache.size > config.deckCacheMax) cache.delete(cache.keys().next().value)
      observer.build?.({
        result: 'success',
        duration_ms: Date.now() - started,
        output_bytes: Buffer.byteLength(html),
      })
      logger.debug('deck build ok', { theme, ms: Date.now() - started, bytes: Buffer.byteLength(html) })
      return { html, etag: `"${key}"`, cache: 'miss' }
    } catch (error) {
      observer.build?.({ result: error.code === 'TIMEOUT' ? 'timeout' : 'error', duration_ms: Date.now() - started })
      throw error
    }
  }

  return {
    inflight: () => active,
    queued: () => waiters.length,
    sweep: () => sweepStaleDeckBuilds(config),
    async render(markdown, theme = 'neutral') {
      const key = sha256(`${theme}\0${config.version}\0${markdown}`)
      if (cache.has(key)) return renderUnlocked(markdown, theme)
      await acquire()
      try {
        return await renderUnlocked(markdown, theme)
      } finally {
        release()
      }
    },
    // Bounds the complete semantic SVG/PNG + Slidev pipeline, not just the
    // child process. The callback receives a renderer that reuses this permit.
    async run(task) {
      await acquire()
      try {
        return await task(renderUnlocked)
      } finally {
        release()
      }
    },
  }
}
