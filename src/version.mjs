import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
export const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
