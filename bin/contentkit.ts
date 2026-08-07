import payloadPath from '../payload.tgz' with { type: 'file' }
import CACHE_KEY from './cache-key'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const base = join(homedir(), '.cache', 'contentkit')
const cache = join(base, CACHE_KEY)
const node = join(cache, '.node-bin')
const server = join(cache, 'server.mjs')
const localStart = join(cache, 'scripts', 'start-local.mjs')
const ready = join(cache, '.ready')
const complete =
  existsSync(ready) && existsSync(node) && existsSync(server) && existsSync(join(cache, 'assets', 'site.css'))

const flags = process.argv.slice(2)
// --prepare unpacks the runtime cache and exits without serving, printing the
// payload's version for deploy validation. A deployment runs it before
// restarting the unit so the ~20s unpack happens outside the restart window.
const prepare = flags.includes('--prepare')

if (!complete) {
  process.stderr.write(`contentkit: unpacking runtime to ${cache}\n`)
  rmSync(cache, { recursive: true, force: true })
  mkdirSync(cache, { recursive: true })
  const tar = Bun.spawn(['tar', '-xzf', '-', '-C', cache], {
    stdin: Bun.file(payloadPath),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if ((await tar.exited) !== 0) process.exit(1)
  writeFileSync(ready, new Date().toISOString())
}

// Superseded runtimes are collected only when starting for real: a --prepare
// run happens while the previous version may still be serving lazily-read
// files (assets, docs, patterns) out of its own cache entry.
if (!prepare) {
  for (const entry of readdirSync(base)) {
    if (entry !== CACHE_KEY) rmSync(join(base, entry), { recursive: true, force: true })
  }
}

if (prepare) {
  const check = Bun.spawn([node, server, '--version'], { stdio: ['inherit', 'inherit', 'inherit'] })
  process.exit((await check.exited) ?? 0)
}
// Build-time Bun defines NODE_ENV while compiling. Resolve the key dynamically
// so the packaged launcher observes the actual runtime environment instead of
// a constant-folded build value.
const nodeEnvKey = ['NODE', 'ENV'].join('_')
const useLocalStart = !process.env[nodeEnvKey] && flags.length === 0
const childEnv = useLocalStart
  ? { ...process.env, CONTENTKIT_LOCAL_DATA_DIR: join(homedir(), '.local', 'share', 'contentkit') }
  : process.env
const child = Bun.spawn([node, useLocalStart ? localStart : server, ...flags], {
  stdio: ['inherit', 'inherit', 'inherit'],
  env: childEnv,
})
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
process.exit((await child.exited) ?? 0)
