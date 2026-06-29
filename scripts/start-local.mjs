import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadConfig } from '../src/config.mjs'
import { startLocalBoundary } from './local-boundary.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const config = loadConfig()
const localDatabaseUrl = 'postgresql://postgres:contentkit-local@127.0.0.1:55432/contentkit'
const localBoundaryUrl = 'http://127.0.0.1:55433'
const container = 'contentkit-local-postgres'

function docker(...args) {
  return spawnSync('docker', args, { encoding: 'utf8' })
}

function ensureLocalPostgres() {
  const info = docker('info')
  if (info.status !== 0) throw new Error('Docker is required for zero-config local PostgreSQL; start Docker Desktop')
  const inspect = docker('inspect', container)
  if (inspect.status !== 0) {
    const created = docker(
      'run', '-d', '--name', container,
      '-e', 'POSTGRES_PASSWORD=contentkit-local',
      '-e', 'POSTGRES_DB=contentkit',
      '-p', '127.0.0.1:55432:5432',
      '-v', 'contentkit-local-postgres:/var/lib/postgresql/data',
      'postgres:16-alpine',
    )
    if (created.status !== 0) throw new Error(created.stderr.trim() || 'failed to start local PostgreSQL')
    return
  }
  const state = JSON.parse(inspect.stdout)[0]?.State
  if (!state?.Running) {
    const started = docker('start', container)
    if (started.status !== 0) throw new Error(started.stderr.trim() || 'failed to restart local PostgreSQL')
  }
}

async function waitForDatabase(url) {
  let lastError
  for (let attempt = 0; attempt < 40; attempt++) {
    const client = new pg.Client({ connectionString: url })
    try {
      await client.connect()
      await client.query('SELECT 1')
      await client.end()
      return
    } catch (error) {
      lastError = error
      await client.end().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError
}

let boundary
let child
let stopping = false

async function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  if (child?.exitCode === null) child.kill(signal)
  await boundary?.close().catch(() => {})
}

try {
  if (config.databaseUrl === localDatabaseUrl) ensureLocalPostgres()
  await waitForDatabase(config.databaseUrl)
  if (config.storageUrl === localBoundaryUrl || config.subkitWebhookUrl.startsWith(localBoundaryUrl)) {
    boundary = await startLocalBoundary({
      dataDir: process.env.CONTENTKIT_LOCAL_DATA_DIR || join(root, '.contentkit-local'),
      logger: console,
    })
  }

  console.log('')
  console.log('Contentkit local environment')
  console.log(`  API:       ${config.publicUrl}`)
  console.log(`  OpenAPI:   ${config.publicUrl}/openapi.json`)
  console.log(`  Admin key: ${config.bootstrapApiKey}`)
  console.log(`  Data:      ${process.env.CONTENTKIT_LOCAL_DATA_DIR || join(root, '.contentkit-local')}`)
  console.log('  Stop:      Ctrl-C')
  console.log('')

  child = spawn(process.execPath, [join(root, 'server.mjs')], {
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit',
  })
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))
  const exitCode = await new Promise((resolve) => child.once('exit', (code) => resolve(code ?? 1)))
  await stop()
  process.exitCode = exitCode
} catch (error) {
  await stop()
  console.error(`contentkit local: ${error.message}`)
  process.exitCode = 1
}
