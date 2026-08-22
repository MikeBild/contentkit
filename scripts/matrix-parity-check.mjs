/**
 * Holds the two matrix legs of the `test` job against each other.
 *
 * WHY A JOB AND NOT A TEST.
 *
 * The 20.x leg reported green while running 139 cases fewer than the 22.x leg —
 * eleven percent, same commit, same files. Every one of those cases announces
 * why it is not running ("this Node cannot import TypeScript"), so nothing is
 * silent; what was missing is that NOBODY COMPARED THE TWO NUMBERS. Neither leg
 * can: each knows only its own total, and a test cannot see the other job.
 *
 * So the runners' own counting is what gets compared — not a re-derivation. An
 * earlier attempt to compute the gap by parsing the suites out of the source
 * landed on 147 against a measured 139, which is the whole argument against
 * re-implementing a runner's counting rules in a test.
 *
 * WHAT MOVES THIS NUMBER, honestly: adding a case to one of the six files in
 * test/fixtures/matrix-parity.json widens the gap and turns this red. That is
 * the event this exists to notice — not noise.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const declared = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'matrix-parity.json'), 'utf8'))

const [floorFile, currentFile] = process.argv.slice(2)
if (!floorFile || !currentFile) {
  console.error('usage: node scripts/matrix-parity-check.mjs <floor-count-file> <current-count-file>')
  process.exit(2)
}

/** One integer, or a loud failure — an unreadable count must not read as zero. */
function countIn(file) {
  const text = readFileSync(file, 'utf8').trim()
  const value = Number(text)
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`${file} does not hold a case count, it holds: ${JSON.stringify(text)}`)
    process.exit(1)
  }
  return value
}

const floor = countIn(floorFile)
const current = countIn(currentFile)
const measured = current - floor

console.log(`Node ${declared.floor}: ${floor} cases`)
console.log(`Node ${declared.current}: ${current} cases`)
console.log(`difference: ${measured} (declared ${declared.difference})`)

if (measured === declared.difference) {
  console.log(`\nnamed, and unchanged. Cause: ${declared.cause}`)
  for (const file of declared.files) console.log(`  ${file}`)
  process.exit(0)
}

console.error(
  `\nThe gap between the two matrix legs moved from ${declared.difference} to ${measured}.\n` +
    `Both legs are required checks and both report green, so the only thing that ever says a leg\n` +
    `measures less is this number. It is named in test/fixtures/matrix-parity.json, currently by:\n` +
    `  cause: ${declared.cause}\n` +
    declared.files.map((file) => `  ${file}`).join('\n') +
    `\n\nEither a case moved behind that guard — then update the number and say why — or a leg lost\n` +
    `cases for a reason nobody has written down yet, which is what this job exists to stop.`,
)
process.exit(1)
