#!/usr/bin/env node
import { start } from './src/server.mjs'
import { loadConfig } from './src/config.mjs'
import { createLogger } from './src/logger.mjs'
import { runMigrations } from './src/db/migrate.mjs'
import { VERSION } from './src/version.mjs'

async function main() {
  if (process.argv.includes('--version')) {
    process.stdout.write(`${VERSION}\n`)
    return
  }
  if (process.argv.includes('--help')) {
    process.stdout.write(`contentkit ${VERSION}

Usage: contentkit [flags]

  --version   print the version and exit
  --help      print this help and exit
  --migrate   apply embedded database migrations and exit
`)
    return
  }
  if (process.argv.includes('--migrate')) {
    const config = loadConfig()
    await runMigrations(config, createLogger(config))
    return
  }
  await start()
}

main().catch((error) => {
  process.stderr.write(`contentkit: fatal: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
