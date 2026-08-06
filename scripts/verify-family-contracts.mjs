#!/usr/bin/env node
// Compare this product's contract/ against a sibling checkout's.
//
// WHY this is a script and not a test: no test in one repository can prove its
// bytes match an absent sibling's, and asserting a constant and calling it a
// contract is exactly the shape that let mcp-auth-v2 carry a hand-typed marker
// across four repos while nobody compared the CSS. So the per-repo tests prove
// internal consistency — index.css, tokens.ts, the built bundle and the contract
// file all agree — and this script proves the one thing they cannot, on the one
// machine that can: the developer's, at promotion time, with both trees present.
//
// It is deliberately NOT part of `bun test` / `npm test` and never will be. A
// suite that fails because a sibling is missing is a suite people learn to skip.
// With no sibling it exits 0 and says so.
//
// Written as .mjs in every product so contract/RITUAL.md — which is byte-identical
// across the family — can name one command that works everywhere.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Everything in contract/ is shared EXCEPT the conformance map.
 *
 * That file is each product's honest record of what it locally enforces, and the
 * two products are at different stages. A shared file claiming one product's
 * coverage for the other would be false in one of them.
 */
const LOCAL_ONLY = /^conformance\./

const argv = process.argv.slice(2)
const siblingArg = argv[argv.indexOf('--sibling') + 1]
if (!argv.includes('--sibling') || !siblingArg) {
  console.error('usage: node scripts/verify-family-contracts.mjs --sibling <path-to-sibling-checkout>')
  process.exit(2)
}

const sibling = resolve(root, siblingArg)
const mine = join(root, 'contract')
const theirs = join(sibling, 'contract')

if (!existsSync(theirs)) {
  console.log(`no sibling checkout found at ${theirs}; nothing compared`)
  process.exit(0)
}

const shared = (dir) => readdirSync(dir).filter((name) => !LOCAL_ONLY.test(name))
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

const names = [...new Set([...shared(mine), ...shared(theirs)])].sort()
let drifted = 0

console.log(`${root}\n  vs ${sibling}\n`)

for (const name of names) {
  const a = join(mine, name)
  const b = join(theirs, name)
  if (!existsSync(a)) {
    drifted++
    console.log(`  ${name.padEnd(28)} MISSING HERE    the sibling has a shared file this product does not`)
    continue
  }
  if (!existsSync(b)) {
    drifted++
    console.log(`  ${name.padEnd(28)} MISSING THERE   this product has a shared file the sibling does not`)
    continue
  }
  const [x, y] = [digest(a), digest(b)]
  if (x === y) {
    console.log(`  ${name.padEnd(28)} IDENTICAL       sha256:${x.slice(0, 12)}`)
    continue
  }
  drifted++
  // Name the first differing line rather than dumping a diff: whoever runs this
  // is mid-promotion and wants to know WHICH step of the ritual they skipped.
  const [A, B] = [readFileSync(a, 'utf8').split('\n'), readFileSync(b, 'utf8').split('\n')]
  const at = A.findIndex((line, i) => line !== B[i])
  console.log(`  ${name.padEnd(28)} DIFFERS         first at line ${at + 1}`)
  console.log(`    here:    ${JSON.stringify(A[at] ?? null)}`)
  console.log(`    sibling: ${JSON.stringify(B[at] ?? null)}`)
}

if (drifted === 0) {
  console.log('\nthe shared contract is identical in both products.')
  process.exit(0)
}

console.log(
  `\n${drifted} shared file(s) differ. A contract change is not finished until it has landed\n` +
    'in every product — see contract/RITUAL.md. If the sibling is simply behind, the\n' +
    "Ledger in its COCKPIT-UI.md is missing the row this product's has.",
)
process.exit(1)
