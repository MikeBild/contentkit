import { spawnSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
spawnSync('docker', ['rm', '-f', 'contentkit-local-postgres'], { stdio: 'ignore' })
spawnSync('docker', ['volume', 'rm', 'contentkit-local-postgres'], { stdio: 'ignore' })
await rm(join(root, '.contentkit-local'), { recursive: true, force: true })
await rm(join(homedir(), '.local', 'share', 'contentkit'), { recursive: true, force: true })
console.log('Contentkit local database, storage and webhook data removed.')
