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
const complete = existsSync(ready) && existsSync(node) && existsSync(server) && existsSync(join(cache, 'assets', 'site.css'))

if (!complete) {
  process.stderr.write(`contentkit: unpacking runtime to ${cache}\n`)
  rmSync(cache, { recursive: true, force: true })
  mkdirSync(cache, { recursive: true })
  const tar = Bun.spawn(['tar', '-xzf', '-', '-C', cache], {
    stdin: Bun.file(payloadPath), stdout: 'inherit', stderr: 'inherit',
  })
  if (await tar.exited !== 0) process.exit(1)
  writeFileSync(ready, new Date().toISOString())
  for (const entry of readdirSync(base)) {
    if (entry !== CACHE_KEY) rmSync(join(base, entry), { recursive: true, force: true })
  }
}

const flags = process.argv.slice(2)
// Build-time Bun defines NODE_ENV while compiling. Resolve the key dynamically
// so the packaged launcher observes the actual runtime environment instead of
// a constant-folded build value.
const nodeEnvKey = ['NODE', 'ENV'].join('_')
const useLocalStart = !process.env[nodeEnvKey] && flags.length === 0
const childEnv = useLocalStart
  ? { ...process.env, CONTENTKIT_LOCAL_DATA_DIR: join(homedir(), '.local', 'share', 'contentkit') }
  : process.env
const child = Bun.spawn([node, useLocalStart ? localStart : server, ...flags], { stdio: ['inherit', 'inherit', 'inherit'], env: childEnv })
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
process.exit((await child.exited) ?? 0)
