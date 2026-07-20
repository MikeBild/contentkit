import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const args = process.argv.slice(2)
const write = args.includes('--write')
const check = args.includes('--check') || !write
const inputs = args.filter((entry) => !entry.startsWith('--'))

async function markdownFiles(path) {
  const info = await stat(path)
  if (info.isFile()) return path.endsWith('.md') ? [path] : []
  if (!info.isDirectory()) return []
  const entries = await readdir(path, { withFileTypes: true })
  return (
    await Promise.all(
      entries
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => markdownFiles(join(path, entry.name))),
    )
  ).flat()
}

if (!inputs.length) {
  process.stderr.write('usage: node scripts/migrate-report-compositions.mjs --check|--write <markdown...>\n')
  process.exitCode = 2
} else {
  const files = (await Promise.all(inputs.map(markdownFiles))).flat()
  const changed = []
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    let next = source
      .replace(/^(layout:\s*)report\s*$/m, '$1composition')
      .replaceAll('report-grid', 'group')
      .replaceAll('report-card', 'card')
    if (next !== source && !/^composition:\s*$/m.test(next)) {
      next = next.replace(
        /^(layout:\s*composition\s*)$/m,
        '$1\ncomposition:\n  format: report\n  canvas: flow\n  intent: status\n  density: compact',
      )
    }
    if (next === source) continue
    changed.push(file)
    if (write) await writeFile(file, next)
  }
  for (const file of changed) process.stdout.write(`${write ? 'migrated' : 'needs migration'}: ${file}\n`)
  if (check && changed.length) process.exitCode = 1
}
