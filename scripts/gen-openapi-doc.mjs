import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openApi } from '../src/openapi.mjs'
import { VERSION } from '../src/version.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const spec = openApi({
  publicUrl: 'https://contentkit-api.example.com',
  version: VERSION,
})

await writeFile(join(root, 'docs', 'openapi.json'), `${JSON.stringify(spec, null, 2)}\n`)
