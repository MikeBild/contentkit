// Boot a sandboxed ContentKit for the elicitation matrix: wait for the scratch
// database, start the local storage/webhook boundary on its own port, then run
// server.mjs in-process env. All configuration arrives via environment
// variables set by lib/engine.sh; logs go to stdout (JSON lines).
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { startLocalBoundary } from '../../../../scripts/local-boundary.mjs'

const root = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))

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
  await waitForDatabase(process.env.DATABASE_URL)
  boundary = await startLocalBoundary({
    port: Number(process.env.ELICIT_BOUNDARY_PORT || 55434),
    dataDir: process.env.ELICIT_BOUNDARY_DATA_DIR || join(root, 'tests/real-world/elicitation/shots/.boundary'),
    logger: console,
  })
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
  console.error(`elicitation matrix engine: ${error.message}`)
  process.exitCode = 1
}
