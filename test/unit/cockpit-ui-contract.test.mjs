import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `cockpit-ui-v1`, asserted in bytes.
 *
 * ContentKit and WatchKit are separate products and stay that way: separate
 * servers, separate databases, separate binaries, separate releases, and not one
 * line of shared runtime. What they share is a palette and a set of rules, carried
 * by copy — and until this file existed, carried by nothing else. Two index.css
 * files declared seventy-five custom properties each, seventy-four names matched,
 * every matched value was identical, and the only thing holding that together was
 * that somebody had pasted the same block twice.
 *
 * The failure mode is silent by construction. A drifted `--accent` renders
 * perfectly, on brand for nobody, and no test and no screen says a word.
 *
 * What this file can prove: this product implements cockpit-ui-v1 at digest X, and
 * every place that restates those bytes agrees. What it cannot prove — what no test
 * in one repository can prove — is that X is the family's current digest. The
 * failure message says so rather than asserting a hand-typed constant and calling
 * it a contract; that is exactly the shape `mcp-auth-v2` had, where four repos
 * asserted `content="2"` and would have kept passing while the CSS diverged.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))

const CSS_PATH = join(root, 'apps', 'cockpit', 'src', 'index.css')
const CONTRACT_CSS_PATH = join(root, 'contract', 'cockpit-ui-v1.css')
const CONTRACT_DOC_PATH = join(root, 'contract', 'COCKPIT-UI-V1.md')

const css = readFileSync(CSS_PATH, 'utf8')
const contractCss = readFileSync(CONTRACT_CSS_PATH, 'utf8')
const contractDoc = readFileSync(CONTRACT_DOC_PATH, 'utf8')

/** The regions, in the order they must appear. */
const ORDER = ['tokens-light', 'tokens-dark', 'theme-map']

/**
 * Leading whitespace is tolerated because `theme-map` opens inside `@theme inline`
 * and a CSS formatter will indent a comment that lives in a block. A sentinel a
 * formatter can break is a sentinel nobody keeps.
 */
const SENTINEL = /^\s*\/\* cockpit-ui-v(\d+):(begin|end) ([a-z][a-z-]*) \*\/$/

/** The bytes between each pair of sentinels, and the version they all name. */
function regions(source, label) {
  assert.ok(!source.includes('\r'), `${label} has CRLF line endings; the digest is over LF bytes`)
  const lines = source.split('\n')
  const found = new Map()
  let open = null
  let start = 0
  let version = null

  lines.forEach((line, i) => {
    const match = line.match(SENTINEL)
    if (!match) return
    const [, v, kind, name] = match
    assert.ok(
      version === null || v === version,
      `${label}:${i + 1} names v${v}; v${version} is already open in this file`,
    )
    version = v
    if (kind === 'begin') {
      assert.equal(open, null, `${label}:${i + 1} opens ${name} while ${open} is still open`)
      open = name
      start = i + 1
    } else {
      assert.equal(open, name, `${label}:${i + 1} closes ${name}, but ${open} is what is open`)
      assert.ok(!found.has(name), `${label} declares region ${name} twice`)
      found.set(name, `${lines.slice(start, i).join('\n')}\n`)
      open = null
    }
  })
  assert.equal(open, null, `${label}: region ${open} is never closed`)
  return { version, found }
}

/** The custom-property names a region declares, in order. */
function declaredNames(region) {
  return [...region.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((match) => match[1])
}

function docField(name) {
  const match = contractDoc.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))
  assert.ok(match, `contract/COCKPIT-UI-V1.md has no \`${name}:\` line`)
  return match[1].trim()
}

const mine = regions(css, 'apps/cockpit/src/index.css')
const theirs = regions(contractCss, 'contract/cockpit-ui-v1.css')

describe('cockpit-ui-v1', () => {
  test('the sentinels are well formed and name one version', () => {
    assert.deepEqual([...mine.found.keys()], ORDER, 'index.css does not carry the three regions, in order')
    assert.deepEqual([...theirs.found.keys()], ORDER, 'the contract file does not carry the three regions, in order')
    assert.equal(mine.version, theirs.version)
  })

  test('every sentinelled region is the bytes of contract/cockpit-ui-v1.css', () => {
    for (const name of ORDER) {
      const got = mine.found.get(name)
      const want = theirs.found.get(name)
      if (got === want) continue
      const g = got.split('\n')
      const w = want.split('\n')
      const at = g.findIndex((line, i) => line !== w[i])
      assert.fail(
        `apps/cockpit/src/index.css region \`${name}\` is not the bytes of contract/cockpit-ui-v1.css.\n\n` +
          `  line ${at + 1} here:     ${JSON.stringify(g[at])}\n` +
          `  line ${at + 1} contract: ${JSON.stringify(w[at])}\n\n` +
          'What is between the cockpit-ui-v1 sentinels is family law, not this product’s. Change it in\n' +
          'contract/cockpit-ui-v1.css, run `shasum -a 256 contract/cockpit-ui-v1.css` into\n' +
          'contract/COCKPIT-UI-V1.md’s Tokens-Digest line, add a Ledger row, copy the region back here —\n' +
          'and then do the same in the sibling product THE SAME DAY (contract/RITUAL.md, step 7).\n' +
          'Nothing in this repository can tell you whether you did.',
      )
    }
  })

  test('the contract file hashes to the digest the document pins', () => {
    const digest = createHash('sha256').update(readFileSync(CONTRACT_CSS_PATH)).digest('hex')
    assert.equal(
      docField('Tokens-Digest'),
      `sha256:${digest}`,
      'contract/COCKPIT-UI-V1.md pins a digest the tokens file does not have.\n' +
        `Run: shasum -a 256 contract/cockpit-ui-v1.css   → ${digest}`,
    )
  })

  test('the rule IDs hash to the digest the document pins', () => {
    // This is what stops the DOCUMENT drifting. A rule added in one product and
    // not the other changes the ID list, so the two repos hold visibly different
    // Rules-Digest lines — one grep, no sibling checkout required.
    const ids = [...contractDoc.matchAll(/\*\*(CUI-[A-Z0-9]+-\d+)\*\*/g)].map((match) => match[1])
    assert.ok(ids.length > 0, 'the document declares no rule IDs')
    const sorted = [...new Set(ids)].sort()
    const digest = createHash('sha256')
      .update(`${sorted.join('\n')}\n`)
      .digest('hex')
    assert.equal(
      docField('Rules-Digest'),
      `sha256:${digest}`,
      `contract/COCKPIT-UI-V1.md pins a rules digest its ${sorted.length} rule IDs do not have.\n` +
        `Recompute after adding or removing a rule → ${digest}`,
    )
  })

  test('the sentinels and the document name the same version', () => {
    assert.equal(docField('Contract'), `cockpit-ui-v${mine.version}`)
    assert.equal(docField('Tokens-File'), 'contract/cockpit-ui-v1.css')
  })

  test('the region declares exactly the names the current version promised', () => {
    const listed = contractDoc
      .match(/#### v1 \(current\)\n\n```\n([\s\S]*?)```/)?.[1]
      .split(/[\s,]+/)
      .filter(Boolean)
    assert.ok(listed, 'the document carries no v1 name list')
    assert.deepEqual(
      [...declaredNames(mine.found.get('tokens-light'))].sort(),
      [...listed].sort(),
      'tokens-light declares a different set of names than COCKPIT-UI-V1.md lists for v1.\n' +
        'Adding a name is a digest bump AND a list entry. Removing one is a version bump (RITUAL.md).',
    )
  })

  test('no earlier version has had a name dropped without a version bump', () => {
    const current = new Set(declaredNames(mine.found.get('tokens-light')))
    for (const [, version, block] of contractDoc.matchAll(/#### v(\d+)(?: \(current\))?\n\n```\n([\s\S]*?)```/g)) {
      for (const name of block.split(/[\s,]+/).filter(Boolean)) {
        assert.ok(
          current.has(name),
          `v${version} promised \`--${name}\` and tokens-light no longer declares it.\n` +
            'Removing a name is a version bump, not a digest bump — see contract/RITUAL.md.',
        )
      }
    }
  })

  test('the dark region answers every name the light region declares', () => {
    // A name that exists in one scheme only is a component that renders in the
    // other scheme with whatever it inherited. `radius` is scheme-independent.
    const light = declaredNames(mine.found.get('tokens-light')).filter((name) => name !== 'radius')
    const dark = new Set(declaredNames(mine.found.get('tokens-dark')))
    for (const name of light) assert.ok(dark.has(name), `.dark never answers \`--${name}\``)
  })

  test('no unprefixed custom property is declared outside the regions', () => {
    // CUI-TOKEN-3. The type stack is the documented exception; it sits outside the
    // sentinels because a formatter rewrites it in one product and not the other.
    const allowed = new Set(['font-sans', 'font-heading', 'font-mono'])
    const inside = new Set(ORDER.flatMap((name) => declaredNames(mine.found.get(name))))
    let outside = css
    for (const region of ORDER) outside = outside.replace(mine.found.get(region), '')
    for (const name of declaredNames(outside)) {
      if (allowed.has(name) || name.startsWith('ck-') || name.startsWith('color-') || name.startsWith('radius-'))
        continue
      assert.ok(
        !inside.has(name),
        `\`--${name}\` is declared outside the cockpit-ui-v1 sentinels as well as inside them`,
      )
      assert.fail(`\`--${name}\` is declared outside the sentinels without the \`--ck-\` prefix (CUI-TOKEN-3)`)
    }
  })

  test('--font-sans carries the family stack', () => {
    // CUI-TYPE-1: by normalised value, never by bytes.
    const declared = css.match(/--font-sans:\s*([^;]+);/)?.[1]
    assert.ok(declared, 'no --font-sans is declared')
    assert.equal(
      declared.replace(/\s+/g, ' ').trim(),
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    )
  })

  test('the shared files are LF-only and end with exactly one newline', () => {
    // The digest is over bytes. A CRLF checkout or a stripped trailing newline
    // would make two identical-looking files hash differently.
    for (const [label, body] of [
      ['contract/cockpit-ui-v1.css', contractCss],
      ['contract/COCKPIT-UI-V1.md', contractDoc],
    ]) {
      assert.ok(!body.includes('\r'), `${label} has CRLF line endings`)
      assert.ok(body.endsWith('\n') && !body.endsWith('\n\n'), `${label} must end with exactly one newline`)
    }
  })
})
