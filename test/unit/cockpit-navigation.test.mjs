import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Cockpit's navigation is split into two contexts, and this test is what
 * keeps the split honest.
 *
 * The sidebar used to be one flat list of sixteen labels, and this file's first
 * job was the split beneath it: the site switcher governs the pages that name
 * the site in their path, and a large part of the documented /v1 surface does
 * not. Moderation, Credentials and Audit run on installation-wide endpoints, so
 * an operator reading them under a site switcher is being told something untrue.
 *
 * Sixteen labels in two headed lists is still not a navigation, though — the two
 * headings answered "whose endpoints?" and nothing answered "what am I doing?".
 * So there is now a second dimension, GROUPS: the blocks the sidebar is drawn
 * in. It is presentation, and it is checked against the contract rather than
 * trusted — a block declares one context and every entry in it must agree — so
 * "this page reads nicely under Content" cannot quietly move an
 * installation-wide page under the switcher.
 *
 * Two things this file used to do and no longer does, because both rotted:
 *
 *  - It quoted the split as two numbers in prose. Those numbers were
 *    already wrong on the day they were written. Every count below is derived
 *    from docs/openapi.json at test time and only the RELATIONSHIP is asserted.
 *  - It took shell.tsx's `api:` lists on trust and only checked them against the
 *    spec, so a page could reach an endpoint nobody had declared — and Sites did:
 *    it wrote POST /v1/sites/{site}/locales through the create wizard while
 *    declaring two registry paths and an installation context. The lists are now
 *    checked against the code that makes the requests (see `reach`).
 *
 * Every check is derived from committed files: docs/openapi.json and the Cockpit
 * sources — never from a build output such as assets/cockpit/* or
 * src/content/site.scoped.css, which are gitignored and therefore absent on a
 * clean checkout, and would make this test fail for the wrong reason.
 * src/api/schema.d.ts is generated as well, but it is committed, so it is not
 * that hazard; this file has no need of it in any case. The Cockpit has no test
 * runner of its own, so the assertions read the sources as text.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const shellPath = join(cockpit, 'app', 'shell.tsx')
const breadcrumbPath = join(cockpit, 'components', 'ui', 'breadcrumb.tsx')
const routerPath = join(cockpit, 'router.tsx')

// A missing file must surface as the assertion that cares about it, not as an
// ENOENT before the first test runs.
const source = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

const shell = source(shellPath)
const breadcrumb = source(breadcrumbPath)
const router = source(routerPath)
const spec = JSON.parse(readFileSync(join(root, 'docs', 'openapi.json'), 'utf8'))
const cockpitPackage = JSON.parse(readFileSync(join(root, 'apps', 'cockpit', 'package.json'), 'utf8'))

const specPaths = Object.keys(spec.paths)

/**
 * A path is the selected site's when the site is a parameter of the path.
 *
 * That includes `/v1/sites/{site}` itself: GET and PATCH on it are one site's
 * record, which is what the settings editor reads and writes. `/v1/sites` is the
 * registry — a list, and a creation that names no existing site. DELETE
 * `/v1/sites/{site}` is a registry act on a site-parameterised path, and no
 * path-shape rule can tell it from the PATCH; that is what the directional MIXED
 * declaration is for.
 */
const SITE_PARAMETER = '/v1/sites/{site}'

/**
 * `/v1/content/{item}…` has no `{site}` in it, but a content item id resolves
 * to exactly one site, and the list that produced the id is site-scoped
 * (`GET /v1/sites/{site}/content`). These are site-bound operations with an
 * item-addressed path, not installation-wide ones.
 */
const ITEM_ADDRESSED = '/v1/content/{item}'

const isSiteScoped = (path) => path === SITE_PARAMETER || path.startsWith(`${SITE_PARAMETER}/`)
const isItemAddressed = (path) => path === ITEM_ADDRESSED || path.startsWith(`${ITEM_ADDRESSED}/`)
/** Installation-wide: a /v1 path that is neither site-parameterised nor item-addressed. */
const isInstallationWide = (path) => path.startsWith('/v1/') && !isSiteScoped(path) && !isItemAddressed(path)

// ── Reading the tables out of shell.tsx ──────────────────────────────────────

// The parsers never assert: a table that is missing or unreadable has to fail
// inside the test that explains what it was for.
function tableBody(text, header) {
  const start = text.indexOf(header)
  if (start === -1) return ''
  const end = text.indexOf('\n] as const', start)
  if (end === -1) return ''
  return text.slice(start + header.length, end)
}

/**
 * Comments out, every other character through — a scanner, not two regexes.
 *
 * Two regexes could not do this, and the way they failed is the reason this
 * function is now twenty lines. `/\*[\s\S]*?\*\//` cannot tell the `/*` inside
 * the path glob '/v1/sites/{site}/stats/*' from a comment opener, so it deleted
 * everything from that glob to the next `*\/` anywhere below it: one block
 * comment added to a later NAV entry took the `},` separators of every entry in
 * between with it, `objectChunks` then read the whole table as ONE entry, and
 * eleven tests that do nothing but read that table went red for an edit that had
 * nothing to do with any of them — with the one real failure somewhere in the
 * middle of the list. The `//` half had the same hole in miniature, patched with
 * `[^:]` so that 'https://…' survived, which let a `//` inside any string that
 * is not a URL swallow the rest of its line.
 *
 * So string literals, template literals and regex literals are walked over
 * whole, and only what is genuinely a comment is dropped. Comment openers are
 * tested BEFORE a `/` is read as a regex start, because `{/* … *\/}` in JSX
 * follows a `{`, which is on the list of characters a regex may follow, and
 * would otherwise look like one. A block comment leaves a space behind so that
 * the tokens around it cannot fuse.
 */
function stripComments(text) {
  let out = ''
  let index = 0
  // The character a regex literal may follow. An allow-list rather than "not a
  // value", because `<` is not on it: `</div>` in JSX would otherwise start a
  // regex that runs to the next `/` on the line and hide a `{/* … *\/}` behind
  // it. Every regex in these sources sits behind `(` — .replace(/…/), .test(/…/)
  // — so the list is generous already.
  const opensRegex = '(,=:[!&|?{};+*%^~'
  let previous = ''
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      const close = text.indexOf('*/', index + 2)
      index = close === -1 ? text.length : close + 2
      out += ' '
      previous = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const start = index
      index += 1
      while (index < text.length) {
        if (text[index] === '\\') {
          index += 2
          continue
        }
        const done = text[index] === char
        index += 1
        if (done) break
      }
      out += text.slice(start, index)
      previous = char
      continue
    }
    if (char === '/' && (previous === '' || opensRegex.includes(previous))) {
      // A regex literal, or a `/` that only looked like one: a `[…]` class may
      // hold an unescaped `/`, and no regex spans a newline — so a close that is
      // not on this line means this was division or JSX, and the `/` is emitted
      // as itself.
      let scan = index + 1
      let inClass = false
      let closed = false
      while (scan < text.length && text[scan] !== '\n') {
        const inner = text[scan]
        if (inner === '\\') {
          scan += 2
          continue
        }
        if (inClass) inClass = inner !== ']'
        else if (inner === '[') inClass = true
        else if (inner === '/') {
          scan += 1
          closed = true
          break
        }
        scan += 1
      }
      if (closed) {
        out += text.slice(index, scan)
        index = scan
        previous = '/'
        continue
      }
    }
    out += char
    if (!/\s/.test(char)) previous = char
    index += 1
  }
  return out
}

function objectChunks(body) {
  return stripComments(body)
    .split(/\n\s*\},?/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('{'))
}

function field(chunk, pattern) {
  const match = chunk.match(pattern)
  return match ? (match[1] ?? match[0]) : undefined
}

/** A `name: ['a', 'b']` list, however it happens to be line-wrapped. */
function list(chunk, name) {
  const match = chunk.replace(/\n/g, ' ').match(new RegExp(`\\b${name}:\\s*\\[([^\\]]*)\\]`))
  return match ? [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]) : undefined
}

function parseNav() {
  return objectChunks(tableBody(shell, 'const NAV = [')).map((chunk) => {
    const scopeMatch = chunk.match(/\bscope:\s*(?:'([^']*)'|(null))/)
    return {
      to: field(chunk, /\bto:\s*'([^']*)'/),
      label: field(chunk, /\blabel:\s*'([^']*)'/),
      scope: scopeMatch ? (scopeMatch[1] ?? null) : undefined,
      context: field(chunk, /\bcontext:\s*'([^']*)'/),
      group: field(chunk, /\bgroup:\s*'([^']*)'/),
      selection: field(chunk, /\bselection:\s*'([^']*)'/),
      api: list(chunk, 'api'),
    }
  })
}

/**
 * The blocks the sidebar is drawn in — the dimension the flat list did not have.
 *
 * `context` still says whose endpoints a page reaches; `group` says which block
 * it is drawn in. They are different questions with different answers (four
 * blocks are site context), and the second is presentation, so it is checked
 * against the first rather than trusted: see “every block is one context, and
 * every entry sits in a block that agrees with it”.
 */
function parseGroups() {
  return objectChunks(tableBody(shell, 'const GROUPS = [')).map((chunk) => ({
    id: field(chunk, /\bid:\s*'([^']*)'/),
    // A block may deliberately have no heading — Overview is one page and a
    // heading over one page is noise — so '' is a value here, not a miss.
    label: field(chunk, /\blabel:\s*'([^']*)'/),
    context: field(chunk, /\bcontext:\s*'([^']*)'/),
    testId: field(chunk, /\btestId:\s*'([^']*)'/),
    collapsible: field(chunk, /\bcollapsible:\s*(true|false)/) === 'true',
    startsOpen: field(chunk, /\bstartsOpen:\s*(true|false)/) === 'true',
    separated: field(chunk, /\bseparated:\s*(true|false)/) === 'true',
  }))
}

function parseMixed() {
  return objectChunks(tableBody(shell, 'const MIXED = [')).map((chunk) => ({
    label: field(chunk, /\blabel:\s*'([^']*)'/),
    context: field(chunk, /\bcontext:\s*'([^']*)'/),
    crosses: list(chunk, 'crosses'),
    reason: field(chunk, /\breason:\s*\n?\s*'([^']*)'/),
  }))
}

const NAV = parseNav()
const MIXED = parseMixed()
const GROUPS = parseGroups()
const labelOf = (entry) => `${entry.label} (${entry.to})`

/** How many entries each table declares, counted without the chunk parser. */
const declaredNav = (tableBody(shell, 'const NAV = [').match(/\bto:\s*'/g) ?? []).length
const declaredGroups = (tableBody(shell, 'const GROUPS = [').match(/\bid:\s*'/g) ?? []).length

/**
 * Why nothing derived from the NAV table can be believed — or null.
 *
 * Everything below this line reads that table, so a parse that loses an entry or
 * cannot read a field makes twenty checks either vacuous or wrong. It used to
 * announce that by failing all of them at once: a block comment added to a NAV
 * entry collapsed the table into a single chunk (see `stripComments`) and ten
 * tests went red, in two suites, none of them about parsing. A review cannot use
 * a report like that.
 *
 * So the parse reconciles itself once, here. The suite that reports it runs
 * unconditionally; everything derived from the table skips with this reason
 * instead, so the mutation being reviewed is the only failure on screen.
 */
const navFailure = (() => {
  if (declaredNav === 0) return 'shell.tsx declares no NAV table this test can read'
  if (NAV.length !== declaredNav) return `the parser read ${NAV.length} of ${declaredNav} NAV entries`
  const unreadable = NAV.filter((entry) => !entry.to || !entry.label || entry.scope === undefined)
  if (unreadable.length > 0)
    return (
      `no to/label/scope could be read for ${unreadable.length} of ${declaredNav} NAV entries ` +
      `(${unreadable.map((entry) => entry.to ?? entry.label ?? '(nameless)').join(', ')})`
    )
  if (declaredGroups === 0) return 'shell.tsx declares no GROUPS table this test can read'
  if (GROUPS.length !== declaredGroups) return `the parser read ${GROUPS.length} of ${declaredGroups} GROUPS entries`
  const nameless = GROUPS.filter((group) => !group.id || !group.context || !group.testId)
  if (nameless.length > 0)
    return (
      `no id/context/testId could be read for ${nameless.length} of ${declaredGroups} GROUPS entries ` +
      `(${nameless.map((group) => group.id ?? group.testId ?? '(nameless)').join(', ')})`
    )
  const homeless = NAV.filter((entry) => !entry.group)
  if (homeless.length > 0)
    return `no group could be read for ${homeless.length} NAV entries (${homeless.map((entry) => entry.to).join(', ')})`
  return null
})()

// ── Running the rules, not just reading the tables ───────────────────────────
//
// The scope strings above were asserted twice over while the filter that
// consumes them was never run: `NAV.filter(…)` → `NAV.slice()` listed every page
// to every session, and a prefix match over the same strings handed a site:admin
// holder the pages of three other scopes — both with the whole suite green. The
// same held for the switcher's mount condition, whose count, position and testid
// were pinned and whose `if` was not.
//
// shell.tsx is JSX, so Node cannot import it. The rules are therefore sliced out
// of the committed source and run here against a table and a session this file
// controls. A mutation that deletes a rule fails on the slice; one that changes
// what it means fails on the value it produces.

/**
 * The right-hand side of a `const <name> =`, however it is line-wrapped.
 *
 * Read out of the comment-free source, because the slice is handed to
 * `new Function('return (…)')`: a `// why` written after the rule would comment
 * out the closing paren and turn every test that runs the rule into the same
 * SyntaxError, and a bracket inside such a comment would mis-count the depth.
 * Stripping first also means the anchor cannot be found in prose about the rule.
 */
function expressionOf(source, name) {
  const text = stripComments(source)
  const anchor = `const ${name} = `
  const start = text.indexOf(anchor)
  if (start === -1) return ''
  let depth = 0
  for (let index = start + anchor.length; index < text.length; index += 1) {
    const char = text[index]
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    else if (char === '\n' && depth === 0) return text.slice(start + anchor.length, index)
  }
  return ''
}

/**
 * One expression, evaluated with names this test binds.
 *
 * Everything the rules can plausibly reach is bound, so a mutation that reads
 * something else fails on its answer rather than on a ReferenceError that could
 * be mistaken for a broken test.
 */
const evaluate = (expression, scope) =>
  new Function(...Object.keys(scope), `return (${expression})`)(...Object.values(scope))

/** `entryFor` from shell.tsx, closed over a table this test provides. */
function entryForOver(table) {
  const start = shell.indexOf('function entryFor(')
  const end = shell.indexOf('\n}', start)
  if (start === -1 || end === -1) return undefined
  const declaration = shell
    .slice(start, end + 2)
    // The one thing `new Function` cannot read: the TypeScript signature.
    .replace(/function entryFor\([^)]*\)[^{]*\{/, 'function entryFor(pathname) {')
  return new Function('NAV', `${declaration}\nreturn entryFor`)(table)
}

/**
 * The three rules this file slices out of shell.tsx and runs.
 *
 * `carriesSwitcher` used to be the third and is gone with the thing it guarded.
 * It answered "does this group have to render even with no items, because the
 * switcher is inside it?" — the switcher now sits in the SidebarHeader, above
 * every block, so no block's emptiness can take it off screen and no block has
 * to be kept alive to hold it. What replaced it is `groupShown`, the rule that
 * drops an empty block; the guarantee that used to need three rules is now
 * structural, and the test that checked it (“no block’s emptiness can unmount
 * the switcher”) checks the structure instead.
 */
const visibleRule = expressionOf(shell, 'visible')
const switcherRule = expressionOf(shell, 'switcherUsed')
const groupRule = expressionOf(shell, 'groupShown')

/**
 * The same guard as `navFailure`, for the rules — or null.
 *
 * An unsliceable expression is an empty string, and `new Function('return ()')`
 * is a SyntaxError: six tests failing on a message about a paren, none of them
 * saying which rule went missing. The suite that names it runs either way.
 */
const unsliceable = Object.entries({ visible: visibleRule, switcherUsed: switcherRule, groupShown: groupRule })
  .filter(([, expression]) => !expression)
  .map(([name]) => name)
const rulesFailure =
  unsliceable.length > 0
    ? `shell.tsx no longer declares ${unsliceable.join(', ')} as a one-name const this test can slice and run`
    : null

const because = (failure) => `${failure} — see “Cockpit navigation: what this test reads out of shell.tsx”`
/** Nothing derived from the table may run while the table is misread. */
const withNav = { skip: navFailure ? because(navFailure) : false }
const withRules = { skip: navFailure || rulesFailure ? because(navFailure ?? rulesFailure) : false }

const SCOPES = [...new Set(NAV.map((entry) => entry.scope).filter(Boolean))]

/**
 * An entry declares the OpenAPI paths its page talks to. A pattern is either an
 * exact documented path or a prefix ending in `/*`.
 */
function resolve(pattern) {
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1)
    return specPaths.filter((path) => path.startsWith(prefix))
  }
  return specPaths.filter((path) => path === pattern)
}

const declaredPaths = (entry) => new Set((entry.api ?? []).flatMap(resolve))

// ── What a page actually reaches ─────────────────────────────────────────────
//
// F1: the declarations were hand-written and unchecked against the code, and the
// very first one was wrong. So they are now checked against the code.
//
// The chain is: router.tsx maps a route to an exported component; that export is
// sliced out of its module; every module it imports is walked; every `ck.*` call
// found is resolved through the one table in src/api/ck.ts that maps a method to
// the literal path it requests; every raw `/v1/…` string in the walked sources
// counts too (the assistant streams over `fetch`, not through `ck`).
//
// What this is NOT: a type-checked call graph. It is a regex reader of
// prettier-formatted sources, and it makes three assumptions, each asserted
// below rather than hoped for:
//
//   1. `src/api/ck.ts` is the only module that calls the typed client, so the
//      path literals are all in one place. Asserted by `no module outside
//      src/api reaches the API except through ck`.
//   2. The ck table parser attributes every path literal in the file to a
//      method. Asserted by `every path literal in ck.ts is attributed`.
//   3. Slicing a module by top-level declaration is sound for these files
//      because every nested line is indented. If it silently produced nothing,
//      each page would reach nothing and every check would pass vacuously —
//      asserted by `every page reaches at least one documented path`.
//
// Its limit, stated rather than papered over: precision is per exported
// component and per module, so a page that imports a module with several cards
// is credited with all of them. That over-approximates rather than under-
// approximates, which is the safe direction — an undeclared crossing cannot hide
// in it.

const CHROME = new Map([
  ['app/shell.tsx', 'the sidebar and the page header themselves'],
  ['lib/site.tsx', 'the switcher’s own GET /v1/sites'],
  ['lib/session.tsx', 'the session the whole console runs in'],
])
const chromePaths = new Set([...CHROME.keys()].map((rel) => join(cockpit, rel)))

/** Bare `import './x.css'` lines carry no bindings and would confuse the reader below. */
const withoutBareImports = (text) => text.replace(/^import\s+'[^']+'\s*;?$/gm, '')

function resolveImport(specifier, from) {
  let base
  if (specifier.startsWith('@/')) base = join(cockpit, specifier.slice(2))
  else if (specifier.startsWith('.')) base = join(from, '..', specifier)
  else return undefined
  // Never the build output under assets/cockpit, and nothing outside the repo.
  if (relative(root, base).startsWith('..') || base.startsWith(join(root, 'assets', 'cockpit'))) return undefined
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), base]) {
    if (existsSync(candidate) && !candidate.endsWith('.css')) return candidate
  }
  return undefined
}

const modules = new Map()
function moduleOf(path) {
  if (modules.has(path)) return modules.get(path)
  const text = source(path)
  const imports = new Map()
  for (const match of withoutBareImports(text).matchAll(/import\s+([\s\S]*?)\s+from\s+'([^']+)'/g)) {
    const target = resolveImport(match[2], path)
    if (!target) continue
    for (const binding of match[1].replace(/[{}]/g, ' ').split(',')) {
      const name = binding
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()
      if (/^[A-Za-z_$][\w$]*$/.test(name ?? '')) imports.set(name, target)
    }
  }
  // Top-level declarations, region-sliced: prettier keeps every nested line
  // indented, so a declaration owns the lines up to the next one.
  const lines = text.split('\n')
  const starts = []
  lines.forEach((line, index) => {
    const match = line.match(
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/,
    )
    if (match) starts.push({ name: match[1], index })
  })
  const declarations = new Map()
  starts.forEach((declaration, position) => {
    declarations.set(
      declaration.name,
      lines.slice(declaration.index, starts[position + 1]?.index ?? lines.length).join('\n'),
    )
  })
  const record = { text, imports, declarations }
  modules.set(path, record)
  return record
}

/**
 * Every `/v1/…`, `/health` or `/ready` literal in a piece of source.
 *
 * Quoted strings are read whole, per quote character, and then filtered — a
 * pattern that starts inside a string and stops at the first quote of any kind
 * silently swallowed `'/health', { parseAs: ` as a path. Comments go first: they
 * are prose, and prose contains apostrophes.
 */
function literals(text) {
  const found = []
  for (const match of stripComments(text).matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? ''
    const path = raw.includes('?') ? raw.slice(0, raw.indexOf('?')) : raw
    if (path === '/health' || path === '/ready' || path.startsWith('/v1/')) found.push(path)
  }
  return found
}

/**
 * The path literals in ck.ts, per method — `sites.addLocale` →
 * `/v1/sites/{site}/locales`.
 */
function parseCkTable(text) {
  const table = text.slice(text.indexOf('export const ck = {'))
  const methods = new Map()
  const stack = []
  let current = null
  for (const line of table.split('\n')) {
    const closing = line.match(/^(\s*)\}/)
    if (closing) {
      while (stack.length && stack[stack.length - 1].indent >= closing[1].length) stack.pop()
      current = null
    }
    const key = line.match(/^(\s+)([A-Za-z_$][\w$]*):\s*(.*)$/)
    if (key) {
      const indent = key[1].length
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
      if (key[3].trim() === '{') {
        stack.push({ indent, name: key[2] })
        current = null
      } else {
        current = [...stack.map((entry) => entry.name), key[2]].join('.')
        if (!methods.has(current)) methods.set(current, new Set())
      }
    }
    if (!current) continue
    for (const path of literals(line)) methods.get(current).add(path)
  }
  return methods
}

const ckPath = join(cockpit, 'api', 'ck.ts')
const ckSource = source(ckPath)
const ckMethods = parseCkTable(ckSource)

/**
 * A literal from the sources against the documented paths, segment by segment.
 *
 * `/v1/sites/{site}/stats/${kind}` is one call over ten documented paths, and
 * `/v1/assistant/elicitations/${id}` is the documented
 * `/v1/assistant/elicitations/{elicitation}`. An interpolation and a path
 * parameter are the same hole, so both become a wildcard segment.
 */
const shapeOf = (path) => path.split('/').map((part) => (/[{$]/.test(part) ? '§' : part))
function documented(literal) {
  const shape = shapeOf(literal)
  return specPaths.filter((path) => {
    const other = shapeOf(path)
    return (
      shape.length === other.length &&
      shape.every((part, index) => part === '§' || other[index] === '§' || part === other[index])
    )
  })
}

/** The documented paths one exported page component can reach. */
function reach(modulePath, exportName) {
  const entry = moduleOf(modulePath)
  const calls = new Set()
  const found = new Set()
  const sliced = []

  const localSeen = new Set()
  const localQueue = [exportName]
  const moduleQueue = []
  while (localQueue.length) {
    const name = localQueue.pop()
    if (localSeen.has(name)) continue
    localSeen.add(name)
    const body = entry.declarations.get(name)
    if (!body) continue
    sliced.push(body)
    for (const match of body.matchAll(/\bck\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g)) calls.add(match[1])
    for (const path of literals(body)) found.add(path)
    for (const [, identifier] of body.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
      if (entry.declarations.has(identifier)) localQueue.push(identifier)
      const target = entry.imports.get(identifier)
      if (target && !chromePaths.has(target)) moduleQueue.push(target)
    }
  }

  const walked = new Set()
  while (moduleQueue.length) {
    const path = moduleQueue.pop()
    if (walked.has(path) || chromePaths.has(path) || path === ckPath) continue
    walked.add(path)
    const module = moduleOf(path)
    for (const match of module.text.matchAll(/\bck\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g)) calls.add(match[1])
    for (const literal of literals(module.text)) found.add(literal)
    for (const target of module.imports.values()) moduleQueue.push(target)
  }

  const paths = new Set()
  const unresolved = []
  for (const call of calls) {
    const parts = call.split('.')
    let method
    for (let length = parts.length; length > 0; length -= 1) {
      const candidate = parts.slice(0, length).join('.')
      if (ckMethods.has(candidate)) {
        method = candidate
        break
      }
    }
    if (!method) {
      unresolved.push(call)
      continue
    }
    for (const literal of ckMethods.get(method)) for (const path of documented(literal)) paths.add(path)
  }
  for (const literal of found) for (const path of documented(literal)) paths.add(path)
  return { paths, calls, unresolved, slice: sliced.join('\n'), walked }
}

/** route → the module and export the router mounts there. */
function parseRoutes() {
  const byName = new Map()
  for (const match of router.matchAll(/import\s+\{([^}]+)\}\s+from\s+'([^']+)'/g)) {
    const target = resolveImport(match[2], routerPath)
    if (!target) continue
    for (const name of match[1].split(',').map((entry) => entry.trim())) if (name) byName.set(name, target)
  }
  return [...router.matchAll(/\['([^']+)',\s*([A-Za-z_$][\w$]*)\]/g)].map((match) => ({
    to: match[1],
    component: match[2],
    module: byName.get(match[2]),
  }))
}

const ROUTES = parseRoutes()
const routeFor = (to) => ROUTES.find((route) => route.to === to)

/** Everything each nav entry's page reaches, keyed by route. */
const REACHED = new Map(
  NAV.map((entry) => {
    const route = routeFor(entry.to)
    return [
      entry.to,
      route?.module
        ? reach(route.module, route.component)
        : { paths: new Set(), calls: new Set(), unresolved: [], slice: '', walked: new Set() },
    ]
  }),
)
const reachedPaths = (entry) => REACHED.get(entry.to).paths

/**
 * What the site switcher does to a page, read off the page itself.
 *
 * `selection` used to be checked against a list of three literals, which is no
 * check at all: /audit claimed to filter live while seeding `useState(site)`
 * once, and /moderation was dimmed as an optional filter while returning
 * <NoSite/> without a selection. The evidence is textual and narrow on purpose:
 *
 *  - which of `site`, `siteId`, `current` the page destructures out of
 *    `useSite()` — `setSite` and `sites` are writes and lists, not the selection;
 *  - whether the slice copies the selection into `useState`;
 *  - whether it renders <NoSite/> behind a test of the selection.
 */
function selectionEvidence(entry) {
  const { slice } = REACHED.get(entry.to)
  const reads = new Set()
  for (const match of slice.matchAll(/const\s*\{([^}]*)\}\s*=\s*useSite\(\)/g)) {
    for (const name of match[1].split(',').map((part) => part.trim())) {
      if (['site', 'siteId', 'current'].includes(name)) reads.add(name)
    }
  }
  return {
    reads,
    seeds: /useState\(\s*(?:site|siteId)\s*\)/.test(slice),
    guards: slice.includes('<NoSite') && /!\s*(?:site|siteId)\b/.test(slice),
  }
}

/** The one relation the page's own source supports. */
function expectedSelection(entry, evidence) {
  if (entry.context === 'site') return 'governs'
  if (evidence.reads.size === 0) return 'ignored'
  if (evidence.seeds) return 'seeds'
  if (evidence.guards) return 'requires'
  return 'scopes'
}

// ── What this file reads, before anything is asserted about it ────────────────
//
// This suite is never skipped: it is the one that says why the others were. Its
// three tests are the three ways the reading itself can break — the table, the
// rules, and the comment stripper both of them go through.

describe('Cockpit navigation: what this test reads out of shell.tsx', () => {
  test('the NAV table is readable out of shell.tsx, in full', () => {
    // A parser that silently drops an entry, or reads no scope for one, makes
    // every check in the other suites either vacuous or wrong — so they skip on
    // this and the reason is stated once, here.
    assert.equal(navFailure, null, navFailure ?? '')
    // Reachable means "something links to it", and the nav table is not the only
    // thing that links. /profile is about the OPERATOR rather than the
    // installation, so it is reached from the operator menu in the sidebar
    // footer — filing it under Installation beside Credentials and Audit would
    // say it is a property of the deployment.
    //
    // So the assertion stays "no route is unreachable" and gains a second source
    // of reachability rather than becoming an exemption list. A route linked
    // from neither still fails, and deleting the footer link starts failing here
    // on the same commit.
    const linkedFromShell = new Set([...source(shellPath).matchAll(/to="([^"]+)"/g)].map((match) => match[1]))
    const unreachable = ROUTES.map((route) => route.to).filter(
      (to) => !NAV.some((entry) => entry.to === to) && !linkedFromShell.has(to),
    )
    assert.deepEqual(
      unreachable,
      [],
      `these routes are in neither NAV nor a shell link — pages nobody can find: ${unreachable.join(', ')}`,
    )
  })

  test('the three rules the sidebar applies are still one sliceable const each', () => {
    // `visible`, `switcherUsed` and `groupShown` are run below out of the
    // committed source. Renaming or inlining one of them is a real change, and
    // this is where it is reported rather than six SyntaxErrors later.
    assert.equal(rulesFailure, null, rulesFailure ?? '')
    assert.match(visibleRule, /session\.product_scopes/, 'the sidebar filter must still ask the session for scopes')
    assert.doesNotMatch(
      `${visibleRule}${switcherRule}${groupRule}`,
      /\/\/|\/\*/,
      'a comment survived the slice: `evaluate` wraps the expression in `return (…)`, so a `//` inside it ' +
        'comments out the closing paren and every test that runs the rule fails on a SyntaxError instead',
    )
  })

  test('only comments are stripped from the sources this test reads', () => {
    // Every table and every rule above goes through `stripComments`, and the
    // regex pair it replaces deleted code: the `/*` inside a path glob such as
    // '/v1/sites/{site}/stats/*' opened a comment that ran to the next `*/`
    // anywhere below, so one block comment in a NAV entry collapsed the whole
    // table into a single chunk and ten tests failed for it, in two suites, none
    // of them about parsing.
    const cases = [
      ["api: ['/v1/x/*'],\n  },\n  { to: '/y' } /* note */", "api: ['/v1/x/*'],\n  },\n  { to: '/y' }  "],
      ["const url = 'https://x//y' // trailing", "const url = 'https://x//y' "],
      ['const re = /[`*_~]/g // trailing', 'const re = /[`*_~]/g '],
      ["const jsx = <div>{/* '/v1/ghost' */}</div>", 'const jsx = <div>{ }</div>'],
      ["// '/v1/ghost'\nconst kept = '/v1/real'", "\nconst kept = '/v1/real'"],
      ['const template = `a // b /* c */ ${x}` // gone', 'const template = `a // b /* c */ ${x}` '],
      ["const nested = '/*' + '*/' + '/v1/real'", "const nested = '/*' + '*/' + '/v1/real'"],
    ]
    for (const [input, expected] of cases) {
      assert.equal(stripComments(input), expected, `stripComments mangled: ${JSON.stringify(input)}`)
    }
    // And on the real thing: no path literal may be lost, whatever a comment
    // above it happens to contain.
    assert.ok(literals(ckSource).length > 0, 'no path literal survived stripping src/api/ck.ts')
    assert.deepEqual(
      literals("['/v1/sites/{site}/stats/*'] /* a block comment below the glob */"),
      ['/v1/sites/{site}/stats/*'],
      'the path glob and the comment after it are the exact pair that used to eat the table',
    )
  })
})

// ── The contract ─────────────────────────────────────────────────────────────

describe('Cockpit navigation: site context versus installation context', withNav, () => {
  test('every nav entry names a context, a switcher relation and its API surface', () => {
    for (const entry of NAV) {
      assert.ok(
        entry.context === 'site' || entry.context === 'installation',
        `${labelOf(entry)} must declare context: 'site' or 'installation' — got ${entry.context ?? 'nothing'}`,
      )
      assert.ok(
        ['governs', 'requires', 'scopes', 'seeds', 'ignored'].includes(entry.selection),
        `${labelOf(entry)} must declare how the site switcher relates to it ` +
          `(selection: 'governs' | 'requires' | 'scopes' | 'seeds' | 'ignored') — got ${entry.selection ?? 'nothing'}`,
      )
      assert.ok(
        entry.api && entry.api.length > 0,
        `${labelOf(entry)} must declare the OpenAPI paths it talks to, or its context cannot be checked`,
      )
    }
  })

  test('every nav target is a route the router actually serves', () => {
    for (const entry of NAV) {
      assert.ok(routeFor(entry.to), `${labelOf(entry)} is not in the router's route table`)
    }
  })

  test('the per-entry scopes are unchanged — authorize() has no hierarchy', () => {
    // Each page names one exact scope. Nothing is implied by a role, so this
    // list is a contract with the server, not a convenience. Splitting /sites
    // did not change it: both halves are site:admin, because creating, deleting
    // and PATCHing a site all need that one scope. Neither did grouping: the
    // /content entry is labelled 'Documents' now, because the block above it is
    // called Content, and it needs content:read exactly as it did.
    const expected = new Map([
      ['Overview', 'stats:read'],
      ['Sites', 'site:admin'],
      ['Site settings', 'site:admin'],
      ['Documents', 'content:read'],
      ['Published', 'content:read'],
      ['Compositions', 'content:read'],
      ['Decks', 'content:read'],
      ['Releases', 'content:read'],
      ['Audio', 'content:read'],
      ['Reader access', 'access:admin'],
      ['Webhooks', 'webhook:admin'],
      ['Moderation', 'moderation:write'],
      ['Credentials', 'api-key:admin'],
      ['Audit', 'audit:read'],
      ['Assistant', 'content:write'],
      ['System', null],
    ])
    assert.deepEqual(
      new Map(NAV.map((entry) => [entry.label, entry.scope])),
      expected,
      'the context split must not change which scope a page requires',
    )
  })

  test('every declared path exists in docs/openapi.json', () => {
    for (const entry of NAV) {
      for (const pattern of entry.api ?? []) {
        assert.ok(
          resolve(pattern).length > 0,
          `${labelOf(entry)} declares ${pattern}, which matches no path in docs/openapi.json`,
        )
      }
    }
  })

  // ── The declarations against the code ──────────────────────────────────────

  test('no module outside src/api reaches the API except through ck', () => {
    // The derivation below reads path literals out of src/api/ck.ts and out of
    // the page sources. A page calling the typed client directly would put a
    // fourth place in play and make the derivation quietly incomplete.
    const offenders = []
    for (const [path, module] of modules) {
      if (path.startsWith(join(cockpit, 'api'))) continue
      if (/\bapi\.(?:GET|POST|PATCH|PUT|DELETE)\(/.test(module.text)) offenders.push(relative(root, path))
    }
    assert.deepEqual(offenders, [], 'these modules bypass ck, so their requests are invisible to this test')
  })

  test('every path literal in ck.ts is attributed to a method', () => {
    // If the table parser lost literals, pages would reach fewer paths than
    // they do and the coverage check would pass on an empty promise.
    const attributed = new Set([...ckMethods.values()].flatMap((paths) => [...paths]))
    const missing = literals(ckSource).filter((path) => !attributed.has(path))
    assert.deepEqual(
      [...new Set(missing)],
      [],
      'the ck table parser dropped these paths, so every reach derived from them is short',
    )
    assert.ok(attributed.size > 0, 'no path literal was read out of src/api/ck.ts at all')
  })

  test('every page reaches at least one documented path', () => {
    for (const entry of NAV) {
      const { paths, unresolved } = REACHED.get(entry.to)
      assert.ok(
        paths.size > 0,
        `nothing could be derived for ${labelOf(entry)} — the module reader is broken, and a broken ` +
          `reader makes every declaration below unfalsifiable`,
      )
      assert.deepEqual(
        unresolved,
        [],
        `${labelOf(entry)} calls ck methods this test cannot resolve to a path: ${unresolved.join(', ')}`,
      )
    }
  })

  test('what a page declares is what its code reaches — no more, no less', () => {
    for (const entry of NAV) {
      const declared = declaredPaths(entry)
      const reached = reachedPaths(entry)
      const undeclared = [...reached].filter((path) => !declared.has(path)).sort()
      const unused = [...declared].filter((path) => !reached.has(path)).sort()
      assert.deepEqual(
        undeclared,
        [],
        `${labelOf(entry)} reaches ${undeclared.join(', ')} through its ck.* calls but declares neither — ` +
          `add it to api: and check the context still holds`,
      )
      assert.deepEqual(
        unused,
        [],
        `${labelOf(entry)} declares ${unused.join(', ')}, which nothing in its module tree calls — ` +
          `a declaration nobody reaches cannot be checked and hides the ones that are`,
      )
    }
  })

  // ── Context, and the crossings that are tolerated ──────────────────────────

  test('every site-context entry reaches at least one site-parameterised operation', () => {
    for (const entry of NAV.filter((candidate) => candidate.context === 'site')) {
      const scoped = [...reachedPaths(entry)].filter(isSiteScoped)
      assert.ok(
        scoped.length > 0,
        `${labelOf(entry)} sits in the site context but reaches no ${SITE_PARAMETER}… operation — ` +
          `it belongs in the installation context`,
      )
    }
  })

  test('every installation-context entry reaches at least one installation-wide operation', () => {
    // The other direction of the same claim. Without it, moving a site page
    // into the installation group cost nothing: the group heading, the
    // breadcrumb and the switcher's caption would all have lied and no check
    // would have noticed.
    for (const entry of NAV.filter((candidate) => candidate.context === 'installation')) {
      const wide = [...reachedPaths(entry)].filter(isInstallationWide)
      assert.ok(
        wide.length > 0,
        `${labelOf(entry)} sits in the installation context but everything it reaches names the site — ` +
          `it belongs in the site context, under the switcher`,
      )
    }
  })

  test('MIXED names each page’s context and every path that crosses out of it', () => {
    const byLabel = new Map(NAV.map((entry) => [entry.label, entry]))
    assert.equal(new Set(MIXED.map((entry) => entry.label)).size, MIXED.length, 'MIXED must not repeat a page')
    for (const mixture of MIXED) {
      const entry = byLabel.get(mixture.label)
      assert.ok(entry, `MIXED names "${mixture.label}", which is not a nav entry`)
      assert.equal(
        mixture.context,
        entry.context,
        `MIXED says "${mixture.label}" is ${mixture.context ?? 'nothing'} while NAV says ${entry.context} — ` +
          `an exemption is written for one direction and cannot be reused for the other`,
      )
      assert.ok(mixture.crosses && mixture.crosses.length > 0, `MIXED entry "${mixture.label}" must name what crosses`)
      assert.ok(mixture.reason, `MIXED entry "${mixture.label}" must carry a reason`)
      assert.match(mixture.reason, /\/v1\//, `the reason for "${mixture.label}" must name the paths that cross`)

      const crossing = [...reachedPaths(entry)]
        .filter(entry.context === 'site' ? isInstallationWide : isSiteScoped)
        .sort()
      assert.deepEqual(
        [...new Set(mixture.crosses)].sort(),
        crossing,
        `MIXED "${mixture.label}" (${entry.context}) must list exactly the paths that cross out of its context`,
      )
    }
  })

  test('no crossing is tolerated that MIXED has not named', () => {
    const named = new Map(MIXED.map((mixture) => [mixture.label, new Set(mixture.crosses ?? [])]))
    for (const entry of NAV) {
      const crossing = [...reachedPaths(entry)].filter(entry.context === 'site' ? isInstallationWide : isSiteScoped)
      if (crossing.length === 0) {
        assert.ok(
          !named.has(entry.label),
          `MIXED still exempts ${labelOf(entry)}, but nothing it reaches crosses its context any more — ` +
            `drop the exemption instead of letting it rot`,
        )
        continue
      }
      const tolerated = named.get(entry.label)
      assert.ok(
        tolerated,
        `${labelOf(entry)} is ${entry.context} context but reaches ${crossing.join(', ')} — ` +
          `move it to the other context, or declare the crossing in MIXED with its context and a reason`,
      )
      const unnamed = crossing.filter((path) => !tolerated.has(path)).sort()
      assert.deepEqual(
        unnamed,
        [],
        `${labelOf(entry)} crosses into ${unnamed.join(', ')}, which its MIXED entry does not name`,
      )
    }
  })

  // ── The switcher's relation to the open page ───────────────────────────────

  test('what a page claims the switcher does is what the page does with it', () => {
    for (const entry of NAV) {
      const evidence = selectionEvidence(entry)
      const expected = expectedSelection(entry, evidence)
      assert.equal(
        entry.selection,
        expected,
        `${labelOf(entry)} declares selection: '${entry.selection}', but its page ` +
          `${entry.context === 'site' ? 'is site context, where the site is a path parameter' : ''}` +
          `${entry.context === 'site' ? '' : `reads ${evidence.reads.size ? [...evidence.reads].join('+') : 'nothing'} out of useSite()`}` +
          `${evidence.seeds ? ', copies the selection into useState once' : ''}` +
          `${evidence.guards ? ', renders <NoSite/> without a selection' : ''} — that is '${expected}'`,
      )
    }
  })

  test('the switcher is dimmed only where moving it changes nothing on the page', () => {
    const dimmed = list(shell.replace(/const DIMMED[^=]*=/, 'DIMMED:'), 'DIMMED')
    assert.deepEqual(
      dimmed,
      ['seeds', 'ignored'],
      'only a seeded copy and an unread selection leave the open page unchanged; dimming a control the ' +
        'page needs — Moderation shows nothing without one — tells the operator to ignore the fix',
    )
    assert.match(
      shell,
      /DIMMED\.includes\(open\.selection\)/,
      'the opacity has to be driven by that list, not by a second rule written next to it',
    )
    const notes = shell.slice(shell.indexOf('const SELECTION_NOTE = {'))
    for (const value of ['governs', 'requires', 'scopes', 'seeds', 'ignored']) {
      assert.match(notes, new RegExp(`\\n\\s*${value}:`), `SELECTION_NOTE says nothing for '${value}'`)
    }
    const caption = notes.match(/\n\s*requires:\s*'([^']*)'/)?.[1] ?? ''
    assert.ok(caption.length > 0, 'a page that needs a site must say so where the switcher is')
    assert.doesNotMatch(
      caption,
      /filter/i,
      'a page that shows nothing without a selection is not filtering itself by it',
    )
    const seeded = notes.match(/\n\s*seeds:\s*'([^']*)'/)?.[1] ?? ''
    assert.doesNotMatch(
      seeded,
      /^Filters this page/i,
      'the seeded filter does not re-narrow when the switcher moves, so it must not claim to filter this page',
    )
  })

  // ── The statistic that rotted ──────────────────────────────────────────────

  test('the split between the two contexts is counted, never written down', () => {
    const paths = specPaths.filter((path) => path.startsWith('/v1/'))
    const scoped = paths.filter(isSiteScoped)
    const item = paths.filter(isItemAddressed)
    const wide = paths.filter(isInstallationWide)
    assert.equal(
      scoped.length + item.length + wide.length,
      paths.length,
      'every documented /v1 path must fall in exactly one of the three classes',
    )
    // The relationship the navigation asserts on screen: the switcher governs a
    // large part of the API and nothing like all of it.
    assert.ok(wide.length > 0, 'nothing is installation-wide, so the second group has no reason to exist')
    assert.ok(scoped.length > 0, 'nothing is site-parameterised, so the switcher governs nothing')
    assert.ok(
      wide.length * 4 > paths.length && scoped.length * 4 > paths.length,
      `neither side is a rounding error: ${scoped.length} site-parameterised, ${item.length} item-addressed, ` +
        `${wide.length} installation-wide of ${paths.length}`,
    )
    // And the number must not be repeated in prose, here or in the shell, where
    // it is stale the next time a path is documented — as it already was.
    for (const [name, text] of [
      ['shell.tsx', shell],
      ['this test', source(here)],
    ]) {
      assert.doesNotMatch(
        text,
        /\b\d{2,}\s+documented\b|\bdocumented\s+\/v1\s+paths,\s*\d+/,
        `${name} states a path count in prose; derive it or say "a large part"`,
      )
    }
  })

  // ── The chrome around it ───────────────────────────────────────────────────

  test('every block is one context, and every entry sits in a block that agrees with it', () => {
    // `group` is presentation and `context` is the contract, so the first is
    // checked against the second. Without this, "Moderation reads nicely under
    // Content" would silently move an installation-wide page under the switcher
    // — the exact claim the two contexts exist to refuse — because a block
    // heading is the only thing on screen saying which is which.
    const byId = new Map(GROUPS.map((group) => [group.id, group]))
    assert.equal(byId.size, GROUPS.length, 'two blocks share an id, so one of them can never be filled')
    assert.equal(
      new Set(GROUPS.map((group) => group.testId)).size,
      GROUPS.length,
      'two blocks share a testid, so a browser test cannot tell them apart',
    )
    for (const entry of NAV) {
      const group = byId.get(entry.group)
      assert.ok(group, `${labelOf(entry)} names the block '${entry.group}', which GROUPS does not declare`)
      assert.equal(
        group.context,
        entry.context,
        `${labelOf(entry)} is ${entry.context} context but is drawn in the ${group.context} block ` +
          `'${group.id}' — the heading over it would say the switcher does something it does not`,
      )
    }
    for (const group of GROUPS) {
      const items = NAV.filter((entry) => entry.group === group.id)
      assert.ok(
        items.length > 0,
        `the block '${group.id}' holds no entry, so it is never drawn — drop it rather than leaving it to rot`,
      )
      // A block with no heading has nothing to click, so it cannot be closed;
      // one that can be closed must say what it is.
      assert.equal(
        group.collapsible,
        group.label !== '',
        `the block '${group.id}' is ${group.collapsible ? 'collapsible' : 'fixed'} and its heading is ` +
          `${group.label === '' ? 'empty' : `'${group.label}'`} — a heading is the only thing there is to click, ` +
          `and a block that closes without one closes into nothing`,
      )
    }
    // The blocks partition the table: every entry drawn exactly once.
    assert.equal(
      GROUPS.flatMap((group) => NAV.filter((entry) => entry.group === group.id)).length,
      NAV.length,
      'the blocks must cover the table exactly once — an entry in no block is a page with no way in',
    )
  })

  test('the sidebar is drawn as the blocks the operator was promised', () => {
    // The shape the user decided: Overview alone above the site's work, that
    // work grouped by the job it belongs to, and INSTALLATION last and apart.
    // Pinned as a list because the ORDER is the navigation — reshuffling it is
    // a redesign, and a redesign should have to edit this line.
    assert.deepEqual(
      GROUPS.map((group) => [group.label, group.context]),
      [
        ['', 'site'],
        ['Content', 'site'],
        ['Deliver', 'site'],
        ['Access', 'site'],
        ['Settings', 'site'],
        ['Installation', 'installation'],
      ],
      'the blocks, in order, are Overview (unheaded), Content, Deliver, Access, Settings and Installation',
    )
    assert.deepEqual(
      GROUPS.map((group) => [group.id, group.label]).filter(([, label]) => label !== ''),
      GROUPS.map((group) => [group.id, group.label]).filter(([id]) => id !== 'overview'),
      'only the Overview block may go unheaded',
    )
    // Every block is addressable, and the installation one keeps the testid it
    // has always had so the browser suites do not have to be rewritten.
    for (const group of GROUPS) {
      assert.ok(shell.includes(group.testId), `the block '${group.id}' declares the testid ${group.testId}`)
    }
    assert.ok(
      GROUPS.some((group) => group.testId === 'nav-group-installation'),
      'the installation block keeps the testid nav-group-installation',
    )
    assert.match(
      shell,
      /data-testid=\{group\.testId\}\s+data-context=\{group\.context\}/,
      'each block renders its own testid AND its context, so a browser test can select the site blocks as a ' +
        'set — with five blocks there is no single nav-group-site to look for any more',
    )
    // Exactly one block is set apart, and it is the one the switcher does not
    // govern. Two rules would be two claims about where the sidebar divides.
    assert.deepEqual(
      GROUPS.filter((group) => group.separated).map((group) => group.id),
      ['installation'],
      'the installation block is the one that is set apart, because it is the one the switcher does not reach',
    )
    assert.equal(
      GROUPS.at(-1)?.id,
      'installation',
      'and it is last: a block set apart in the middle divides the site’s own pages from each other',
    )
    const navStart = shell.indexOf('<nav data-testid="nav"')
    const navEnd = shell.indexOf('</nav>', navStart)
    assert.ok(navStart !== -1 && navEnd !== -1, 'the sidebar must render a <nav data-testid="nav">')
    assert.match(
      shell.slice(navStart, navEnd),
      /GROUPS\.map\(/,
      'the blocks must be drawn from the GROUPS table, not written out one by one beside it',
    )
    // Closed by default is a judgement about how often a block is needed, and
    // it must not be made about a block the operator works in all day.
    assert.deepEqual(
      GROUPS.filter((group) => !group.startsOpen).map((group) => group.id),
      ['access', 'settings', 'installation'],
      'Overview, Content and Deliver are open on a cold load; the three that are visited to change something ' +
        'rather than to do the work are closed',
    )
    assert.match(
      shell,
      /if \(holdsOpenPage\) setExpanded\(true\)/,
      'a closed block must open itself when the page inside it is the open one — otherwise a ⌘K jump into ' +
        'Access lands on a page whose sidebar entry is not on screen',
    )
    assert.match(
      shell,
      /state === 'collapsed' \|\| expanded/,
      'collapsed to a rail there is no heading to click, so a closed block must still show its icons or its ' +
        'pages become unreachable',
    )
  })

  test('collapsed to the icon rail, every control still says what it is', () => {
    // The other half of the block above. A closed block keeps showing its icons
    // in the rail, which is only useful if an icon can still be read — and at
    // 3rem there is no label on screen, so `tooltip=` is not decoration but the
    // label itself. The switcher is the control this is written for: in the pass
    // that was lost it was the one thing in the rail without a tooltip, so the
    // control answering "which site am I about to change?" showed a globe and
    // nothing else.
    assert.match(shell, /<Sidebar collapsible="icon"/, 'the sidebar the operator was promised collapses to icons')
    assert.match(
      shell,
      /<TooltipProvider>/,
      'and every one of those labels needs a provider above it: without one Radix renders no tooltip at all, ' +
        'so the rail goes unlabelled everywhere at once rather than in one place a reviewer would notice',
    )
    const menu = shell.slice(shell.indexOf('const menu = ('))
    assert.match(
      menu.slice(0, menu.indexOf('</SidebarMenu>')),
      /<SidebarMenuButton[^>]*tooltip=\{label\}/,
      'each nav entry carries its own label as its tooltip, because in the rail that is where the label went',
    )
    const switcher = shell.slice(shell.indexOf('function SiteSwitcher('))
    assert.match(switcher, /<TooltipContent/, 'the switcher needs one too — a globe on its own names no site')
    // The switcher's tooltip is hand-rolled, because `SidebarMenuButton
    // tooltip=` returns a Tooltip *Root* and a `DropdownMenuTrigger asChild`
    // cloning that renders no DOM node at all. Hand-rolled means the condition
    // that ships for free on the other ten has to be typed out here, and
    // `|| isMobile` is the half that was missing: on the mobile sheet every
    // label is on screen while `state` still reports the desktop rail, so
    // without it this was the one entry in the rail popping a tooltip its
    // neighbours suppress. Both halves are pinned, so dropping either fails.
    assert.match(
      switcher,
      /hidden=\{state !== 'collapsed' \|\| isMobile\}/,
      'and only in the rail, on a pointer: expanded the site’s name is already on screen, and on the mobile ' +
        'sheet so is every neighbour’s — sidebar.tsx suppresses both with `state !== "collapsed" || isMobile` ' +
        'and the switcher must say the same thing, or it is the one control in the rail behaving differently',
    )
  })

  test('the switcher is chrome above the blocks, and says what it does to the open page', () => {
    assert.equal(
      (shell.match(/<SiteSwitcher/g) ?? []).length,
      1,
      'the switcher is rendered once, in one place, so it cannot mean two different things',
    )
    // It used to sit inside the site group, so that what it governed was what
    // appeared beneath it. With the site's pages in four blocks and
    // INSTALLATION below them that arrangement is no longer available, and the
    // team-switcher position — first thing in the sidebar, naming the thing the
    // console is pointed at — is the one the user chose. Position therefore no
    // longer carries the claim, so the words have to, and they are checked
    // below rather than left to a comment.
    const headerStart = shell.indexOf('<SidebarHeader>')
    const headerEnd = shell.indexOf('</SidebarHeader>', headerStart)
    assert.ok(headerStart !== -1 && headerEnd !== -1, 'the sidebar must render a SidebarHeader')
    assert.ok(
      shell.slice(headerStart, headerEnd).includes('<SiteSwitcher'),
      'the switcher belongs in the SidebarHeader, above every block',
    )
    const navStart = shell.indexOf('<nav data-testid="nav"')
    assert.ok(
      !shell.slice(navStart, shell.indexOf('</nav>', navStart)).includes('<SiteSwitcher'),
      'and not inside the block list, where four of the five blocks would each look like the one it governs',
    )
    assert.match(
      shell,
      /data-testid="site-switcher-scope"/,
      'the switcher needs a wrapper carrying its relation to the open page, so an installation route can dim it',
    )
    assert.match(
      shell,
      /data-relation=\{open\?\.selection \?\? 'governs'\}/,
      'that wrapper must carry the open page’s own relation, not a constant',
    )
    assert.match(
      shell,
      /data-testid="site-switcher-note"/,
      'on a page it does not govern, the switcher has to say so in words as well as in opacity',
    )
    // The one thing position used to say for free: an operator on an
    // installation page must be told, in words, that the control above the
    // sidebar does not reach it. Every relation but 'governs' therefore has a
    // caption, and it is not blank.
    const notes = shell.slice(shell.indexOf('const SELECTION_NOTE = {'))
    for (const relation of ['requires', 'scopes', 'seeds', 'ignored']) {
      const caption = notes.match(new RegExp(`\\n\\s*${relation}:\\s*'([^']*)'`))?.[1] ?? ''
      assert.ok(
        caption.length > 0,
        `'${relation}' has no caption: the switcher sits above every block now, so a page it does not govern ` +
          `has nothing but these words to say so`,
      )
    }
  })

  test('the breadcrumb is built on the Cockpit’s own primitives', () => {
    assert.match(shell, /from '@\/components\/ui\/breadcrumb'/, 'the page header must render the breadcrumb')
    const dependencies = new Set(Object.keys(cockpitPackage.dependencies ?? {}))
    for (const [, imported] of breadcrumb.matchAll(/from '([^']+)'/g)) {
      if (imported.startsWith('@/') || imported.startsWith('.')) continue
      assert.ok(
        dependencies.has(imported),
        `breadcrumb.tsx imports "${imported}", which is not already a Cockpit dependency`,
      )
    }
    // The testid used to be a default inside breadcrumb.tsx, which took an
    // `items` array and drew the whole trail. The component is now compound —
    // Breadcrumb / BreadcrumbList / BreadcrumbItem / BreadcrumbPage — so the
    // trail is composed at the call site and that is where the addressability
    // has to be asserted. Checking breadcrumb.tsx for a `data-testid=` would now
    // pass on a testid the console never renders.
    assert.match(shell, /data-testid="breadcrumb"/, 'the composed trail must be addressable in the browser')
    assert.match(
      shell,
      /data-trail=\{crumbs\.map\(/,
      'and it must keep carrying the joined trail, so a browser test reads it in one go instead of stitching ' +
        'the crumbs back together',
    )
    assert.match(
      shell,
      /data-testid=\{`breadcrumb-item-\$\{index\}`\}/,
      'each crumb keeps its indexed testid: breadcrumb-item-0 is the context, and that is what a browser test ' +
        'asserts to know which context the page runs in',
    )
    // The reason the old file gave for being non-interactive still holds, and
    // shadcn's BreadcrumbLink is the thing that would end it. Two of the three
    // crumbs are not routes at all — the console has no page for "the site
    // context" — and the third is the page already open, so a link here could
    // only leave a half-filled form or change the site.
    // The element, not the word: shell.tsx names BreadcrumbLink in prose to
    // explain why it is not rendered, and a substring match would read that
    // explanation as the thing it warns about.
    assert.doesNotMatch(
      shell,
      /<BreadcrumbLink\b/,
      'no crumb may be a link: two of them name no route and the last is the open page',
    )
    assert.equal(
      (shell.match(/<BreadcrumbPage/g) ?? []).length,
      1,
      'exactly one crumb is the page: BreadcrumbPage carries aria-current="page", and three of them announce ' +
        'three current pages to a screen reader',
    )
    assert.match(
      shell,
      /index === crumbs\.length - 1/,
      'and it is the last one, not whichever crumb happens to be rendered first',
    )
  })

  test('the breadcrumb names the context the open page runs in', () => {
    // Scoped to useCrumbs: 'Installation' is also a block heading in GROUPS now,
    // so matching the whole file would pass on the sidebar alone even if the
    // trail had stopped naming the context at all.
    const start = shell.indexOf('function useCrumbs(')
    assert.notEqual(start, -1, 'the page header must still derive its trail from the open entry')
    const crumbs = shell.slice(start, shell.indexOf('\n}', start))
    assert.match(crumbs, /'Installation'/, "an installation route must read 'Installation · <page>'")
    assert.match(crumbs, /'Site'/, "a site route must read 'Site · <site name> · <page>'")
    assert.match(
      crumbs,
      /open\.context === 'installation'/,
      'the trail must branch on the entry’s declared context, not on the block it is drawn in',
    )
  })

  // ── The /sites split ───────────────────────────────────────────────────────

  test('the registry and the settings editor are two pages, and only one is governed', () => {
    // /sites read useSite(), loaded and PATCHed the selected site's settings and
    // hosted the delete dialog, all under the heading "Installation" and a
    // switcher dimmed with "Filters this page only" — over the control that
    // decided which site was about to be deleted.
    const registry = NAV.find((entry) => entry.to === '/sites')
    const settings = NAV.find((entry) => entry.to === '/settings')
    assert.ok(registry, 'the site registry must stay at /sites')
    assert.ok(settings, 'the settings editor for the selected site needs its own route')
    assert.equal(registry.context, 'installation', 'listing, creating and deleting sites is an installation act')
    assert.equal(settings.context, 'site', 'the settings editor reads and writes the selected site’s record')
    assert.equal(settings.selection, 'governs', 'the switcher picks the site whose settings are being edited')

    const registrySource = source(join(cockpit, 'pages', 'sites.tsx'))
    const settingsSource = source(routeFor('/settings')?.module ?? '')
    assert.ok(settingsSource.includes('ck.sites.update'), 'the settings editor is the page that PATCHes the site')
    assert.ok(!registrySource.includes('ck.sites.update'), 'the registry must not PATCH the selected site’s settings')
    assert.ok(registrySource.includes('ck.sites.remove'), 'deleting a site belongs to the registry')
    assert.ok(!settingsSource.includes('ck.sites.remove'), 'the settings editor must not delete a site')

    // The deletion has to name the row it was started from. `site.slug` inside
    // the dialog is that; a `useSite()` read of the selection would not be.
    assert.match(
      registrySource,
      /const\s*\{[^}]*\}\s*=\s*useSite\(\)/,
      'the registry still needs the loaded site list from the provider',
    )
    assert.doesNotMatch(
      registrySource,
      /const\s*\{[^}]*\b(?:site|siteId|current)\b[^}]*\}\s*=\s*useSite\(\)/,
      'the registry must not read the selection: the site it deletes is the row, not the switcher',
    )
    for (const testId of ['site-new', 'site-create-submit', 'site-create-cancel']) {
      assert.ok(
        source(join(cockpit, 'forms', 'site', 'wizard.tsx')).includes(`data-testid="${testId}"`),
        `${testId} must keep working — it is how the create wizard is driven`,
      )
    }
    assert.match(
      registrySource,
      /data-testid=\{`ck-site-delete-\$\{site\.slug\}`\}/,
      'each row carries its own delete control, addressable by the slug it would delete',
    )
    assert.match(registrySource, /data-testid="ck-sites-row"/, 'the registry rows have to be addressable')
    assert.ok(registrySource.includes('<CreateSiteWizard'), 'creating a site belongs to the registry')
  })
})

/**
 * Scope strings no page names, each one an extension of a scope some page does.
 *
 * Every real product scope leaves the shape of the match untestable: no entry in
 * PRODUCT_SCOPES (src/oauth/policy.mjs) is a strict extension of another, so over
 * the live table `startsWith`, `includes` and `===` agree on every input the
 * table can supply — which is why four relaxations of the one gate survived a
 * whole round of review with the suite green. These four are fabricated to break
 * that tie, one per relaxation:
 *
 *  - 'content:read:own' is read as content:read by `held.startsWith(scope)` and
 *    by `held.includes(scope)`;
 *  - 'content' is read as content:read (and content:write) by the other
 *    direction, `scope.startsWith(held)`;
 *  - 'site:admin-ro' is read as site:admin by either suffix-tolerant match;
 *  - '*' is read as everything by a wildcard clause.
 *
 * None is a live leak today. `session.product_scopes` is the grant's stored
 * ceiling verbatim (GET /v1/identity/session), and no write puts a string like
 * these in one: the admin write validates every scope against PRODUCT_SCOPES and
 * answers 422 otherwise, the api-key mirror strips `'*'` before it inserts, a
 * signup gets a role default — and the one place a `'*'` ceiling is still
 * honoured expands it into the real list before anything reads it (src/auth.mjs).
 * The first three become a leak the moment a scope string gains a suffix —
 * 'content:read:own' is exactly the kind of scope a product adds — and the
 * console is not where that decision should be made silently.
 */
const FABRICATED_EXTENSIONS = ['content:read:own', 'site:admin-ro', 'content', '*']

describe('Cockpit navigation: the rules the sidebar applies to that table', withRules, () => {
  /** The sidebar's own filter, run over the real table with the scopes given. */
  const visibleFor = (scopes) => evaluate(visibleRule, { NAV, session: { product_scopes: scopes } })
  const labelsFor = (scopes) => visibleFor(scopes).map((entry) => entry.label)

  test('a page is offered only to a session holding its one exact scope', () => {
    // System is the only entry that needs no scope, so it is the whole sidebar
    // for a session that holds nothing.
    assert.deepEqual(labelsFor([]), ['System'], 'a session with no scopes may see only what needs none')
    assert.deepEqual(labelsFor(['audit:read']), ['Audit', 'System'])
    assert.deepEqual(labelsFor(['stats:read']), ['Overview', 'System'])
    assert.deepEqual(labelsFor(['moderation:write']), ['Moderation', 'System'])
    // Held twice, or held alongside something no page names: still the same set.
    assert.deepEqual(labelsFor(['audit:read', 'audit:read', 'not:a-scope']), ['Audit', 'System'])
  })

  test('no scope is implied by another — authorize() has no hierarchy', () => {
    // Real scopes first. site:admin is the dangerous one: it must not open
    // Credentials (api-key:admin), Reader access (access:admin) or Webhooks
    // (webhook:admin), and it carries no read scope at all.
    assert.deepEqual(labelsFor(['site:admin']), ['Site settings', 'Sites', 'System'])
    assert.deepEqual(labelsFor(['content:write']), ['Assistant', 'System'], 'writing content is not reading it')
    assert.deepEqual(labelsFor(['access:admin']), ['Reader access', 'System'])
    assert.deepEqual(labelsFor(['api-key:admin']), ['Credentials', 'System'])

    // Then the shapes the real strings cannot ask about (see
    // FABRICATED_EXTENSIONS): the gate is exact membership, so a session holding
    // nothing but extensions of real scopes may open nothing but the page that
    // needs no scope at all.
    assert.deepEqual(
      labelsFor(FABRICATED_EXTENSIONS),
      ['System'],
      'holding an extension of a scope is not holding it: the gate must be exact string membership, not a ' +
        'prefix, suffix, substring or wildcard match',
    )
    // One at a time, so the failure names the shape that got through.
    for (const held of FABRICATED_EXTENSIONS) {
      assert.deepEqual(labelsFor([held]), ['System'], `'${held}' must open no page — no page names it`)
      // And alongside a real scope it must add nothing to it.
      assert.deepEqual(
        labelsFor(['audit:read', held]),
        ['Audit', 'System'],
        `'${held}' widened a session that holds audit:read and nothing else`,
      )
    }
  })

  test('every scope in the table is load-bearing, and holding all of them shows all of it', () => {
    // The other half of `NAV.slice()`: a filter that drops nothing passes every
    // check above except this one, where each scope is withheld in turn.
    assert.deepEqual(
      labelsFor(SCOPES),
      NAV.map((entry) => entry.label),
    )
    for (const scope of SCOPES) {
      const withheld = NAV.filter((entry) => entry.scope === scope).map((entry) => entry.label)
      assert.deepEqual(
        labelsFor(SCOPES.filter((held) => held !== scope)),
        NAV.filter((entry) => entry.scope !== scope).map((entry) => entry.label),
        `without ${scope} the sidebar must not offer ${withheld.join(', ')} — authorize() answers 403 for each`,
      )
    }
  })

  test('the switcher stays mounted wherever a visible page reads the selection', () => {
    assert.ok(switcherRule, 'shell.tsx must still derive `switcherUsed` from the visible entries')
    const mounted = (scopes, label) => {
      const visible = visibleFor(scopes)
      const open = NAV.find((entry) => entry.label === label)
      assert.ok(open, `${label} is not a nav entry`)
      assert.ok(
        visible.includes(open),
        `${label} is not visible to [${scopes.join(', ')}], so it cannot be the open page`,
      )
      return evaluate(switcherRule, { visible, open, NAV, session: { product_scopes: scopes } })
    }
    // Moderation is the page this condition exists for: installation-wide
    // endpoints, <NoSite/> until a site is chosen, and the switcher is the only
    // control that chooses one. Unmounting it there leaves an empty page and no
    // way out of it.
    assert.equal(
      mounted(['moderation:write'], 'Moderation'),
      true,
      'Moderation renders <NoSite/> without a selection — the switcher must be on screen exactly there',
    )
    assert.equal(mounted(['audit:read'], 'Audit'), true, 'the audit filter is seeded from it')
    assert.equal(mounted(['content:write'], 'Assistant'), true, 'the assistant sends the selection with every turn')
    assert.equal(mounted(['content:read'], 'Documents'), true, 'and a governed page, obviously')
    // The condition is not `true`: with nothing visible that reads the selection
    // there is nothing for the control to do, and it says so by being absent.
    assert.equal(
      mounted(['api-key:admin'], 'Credentials'),
      false,
      'Credentials and System both ignore the selection, so a switcher there would govern nothing',
    )
    assert.equal(mounted([], 'System'), false)
  })

  test('no block’s emptiness can unmount the switcher', () => {
    // The same failure from the other side, and the reason the switcher moved
    // out of the block list. A block returns null on an empty item list, and
    // while the switcher lived inside the site block that null took the switcher
    // with it — which is exactly the case a moderation-only session is in:
    // installation-wide endpoints, <NoSite/> until a site is chosen, and not one
    // site-context page to hang the control off.
    //
    // It is now header chrome, so the guarantee is structural rather than a
    // second condition inside a block. Both halves are checked: every site block
    // really is empty for that session, and the switcher really is rendered
    // outside every block.
    assert.ok(groupRule, 'a block with nothing in it must still be able to render nothing')

    const scopes = ['moderation:write']
    const visible = visibleFor(scopes)
    for (const group of GROUPS.filter((candidate) => candidate.context === 'site')) {
      const items = visible.filter((entry) => entry.group === group.id)
      assert.deepEqual(items, [], `a moderation-only session has no page in the '${group.id}' block`)
      assert.equal(
        evaluate(groupRule, { items }),
        false,
        `the '${group.id}' block must draw nothing rather than an empty heading`,
      )
    }
    assert.equal(
      evaluate(switcherRule, {
        visible,
        open: NAV.find((entry) => entry.label === 'Moderation'),
        NAV,
        session: { product_scopes: scopes },
      }),
      true,
      'and the switcher is still mounted: Moderation shows nothing without a site and this is the only control ' +
        'that chooses one',
    )
    // The rule itself, driven both ways, so a `groupShown = true` that draws
    // empty headings for every scope a session lacks fails here.
    assert.equal(evaluate(groupRule, { items: [] }), false)
    assert.equal(evaluate(groupRule, { items: [NAV[0]] }), true)

    // The structural half: the mount condition is the session's, and the JSX
    // that renders the switcher is outside the block list. Guarded by the
    // element the block list is drawn into, so moving <SiteSwitcher/> back
    // inside it fails here rather than only in a browser.
    const navStart = shell.indexOf('<nav data-testid="nav"')
    const navEnd = shell.indexOf('</nav>', navStart)
    assert.ok(navStart !== -1 && navEnd !== -1, 'the sidebar must render a <nav data-testid="nav">')
    assert.ok(
      !shell.slice(navStart, navEnd).includes('<SiteSwitcher'),
      'the switcher must not be rendered by a block: a block that can return null cannot be trusted with it',
    )
    assert.match(
      shell,
      /\{switcherUsed \? \(/,
      'and its mount must still be `switcherUsed`, so it is absent only where no visible page reads the selection',
    )
  })

  test('the open entry is the longest match, and "/" matches only itself', () => {
    // Neither rule changes an outcome for the sixteen routes the router serves —
    // no `to` is a prefix of another — which is why two mutations to entryFor
    // survived. The rules are driven with a table of this test's own instead, so
    // they are pinned by what they do rather than by a table that never asks.
    const nested = entryForOver([{ to: '/' }, { to: '/content' }, { to: '/content/drafts' }])
    assert.ok(nested, 'shell.tsx must still resolve the open path to one nav entry')
    assert.equal(nested('/')?.to, '/')
    assert.equal(nested('/content')?.to, '/content')
    assert.equal(nested('/content/hello')?.to, '/content', 'a route owns the paths below it')
    assert.equal(
      nested('/content/drafts')?.to,
      '/content/drafts',
      'both entries match, and the longer one is the page that is open',
    )
    assert.equal(nested('/content/drafts/x')?.to, '/content/drafts')
    assert.equal(
      nested('//content'),
      undefined,
      "'/' must be matched exactly: the general branch would read startsWith('//') and light up Overview for a " +
        'path that is not it',
    )
    assert.equal(nested('/other'), undefined, 'an unknown path opens no entry rather than the first one')

    // And over the real table: every route resolves to its own entry, whatever
    // order the table is in.
    const real = entryForOver(NAV)
    for (const entry of NAV) {
      assert.equal(real(entry.to)?.to, entry.to, `${labelOf(entry)} must resolve to itself`)
      assert.equal(real(`${entry.to === '/' ? '' : entry.to}/deeper`)?.to, entry.to === '/' ? undefined : entry.to)
    }
  })
})
