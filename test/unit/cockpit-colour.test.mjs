// A colour is never the only thing said — CUI-A11Y-5.
//
// "Nothing is conveyed by colour alone. A status has a word; a warning has an
// icon." Both halves are load-bearing here, and this console holds them
// differently from the sibling — which is why the checks are not a copy.
//
// The word: `StatusBadge` and `Badge` render a tinted pill whose entire content
// is its children. Delete the child and what is left is a colour that means
// something to nobody — not to a reader who cannot separate the hues, and not to
// a screen reader, which reaches an element with no content at all. It looks
// almost right on screen, which is why nothing catches it by eye.
//
// The icon: `ui/alert.tsx` is registry output and draws no glyph of its own — it
// only re-grids when it FINDS one (`has-[>svg]`). So in this console the icon is
// a call-site responsibility on `Alert`, and a component responsibility on
// `StatusBadge`, and each is checked where it lives.
//
// Every check reads source as TEXT. Stated once, here: this can see that a badge
// has a child, not that the child says anything useful. What it refuses is the
// shape that is wrong regardless of wording.
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const SRC = join(root, 'apps', 'cockpit', 'src')

/**
 * Comments are stripped before every check.
 *
 * Not a nicety: this file's own prose quotes `<StatusBadge tone="danger" />` —
 * the exact shape it forbids — and `forms/status-badge.tsx` explains its tone
 * mapping in a comment full of badge vocabulary. A scan that reads prose reports
 * the explanation as the violation.
 */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) out.push(path)
  }
  return out
}

/** Icon identifiers a module imported. An icon is decoration, never the word. */
function lucideNames(src) {
  const names = new Set()
  for (const block of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
    for (const specifier of block[1].split(',')) {
      const local = specifier
        .trim()
        .split(/\s+as\s+/)
        .pop()
      if (local) names.add(local)
    }
  }
  return names
}

/**
 * Every `<Tag …>` opening tag, read to the `>` that actually ends it.
 *
 * A regex cannot do this and the naive one is worse than useless: this console's
 * badges are written `<StatusBadge tone={entry.severity === 'error' ? 'danger' :
 * 'warning'}>` and its buttons `onClick={() => save()}`, both of which contain a
 * `>` that ends nothing. `<StatusBadge\b[^>]*>` returns a truncated tag,
 * everything after the arrow goes unseen — including the `aria-label` this file
 * accepts as a name — and the check reports a named element as nameless.
 *
 * So: scan, tracking brace depth and quote state. Lifted from the sibling
 * console's `cockpit-testids.test.ts`, which found this out on twelve controls
 * that were correctly named.
 */
function openingTags(src, tag) {
  const out = []
  for (const match of src.matchAll(new RegExp(`<${tag}(?![A-Za-z0-9_])`, 'g'))) {
    let depth = 0
    let quote = null
    for (let i = match.index; i < src.length; i++) {
      const char = src[i]
      if (quote) {
        if (char === quote) quote = null
      } else if (char === '"' || char === "'" || char === '`') {
        quote = char
      } else if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0) {
        out.push({ text: src.slice(match.index, i + 1), end: i + 1 })
        break
      }
    }
  }
  return out
}

/**
 * What sits between an opening tag and the `</Tag>` that closes it.
 *
 * `null` means the element was written self-closing and so has no children at
 * all — the defect this file is named for. Nesting is counted so a badge inside
 * a badge does not hand back the inner one's terminator.
 */
function childrenOf(src, tag, open) {
  if (/\/>$/.test(open.text)) return null
  let depth = 1
  for (const match of src.slice(open.end).matchAll(new RegExp(`<(/?)${tag}(?![A-Za-z0-9_])`, 'g'))) {
    const at = open.end + match.index
    if (match[1] === '/') {
      depth -= 1
      if (depth === 0) return src.slice(open.end, at)
    } else {
      const inner = openingTags(src.slice(at), tag)[0]
      if (inner && !/\/>$/.test(inner.text)) depth += 1
    }
  }
  return ''
}

/**
 * The elements whose whole visual job is a colour.
 *
 * `Badge` and its domain wrapper `StatusBadge` state a status as a tinted pill;
 * `Alert` states one as a tinted panel. `<Alert>` is matched on its own and
 * never on `AlertTitle` or `AlertDescription`, which are the slots INSIDE it —
 * hence the `(?![A-Za-z0-9_])` guard rather than `\b`, which would match both.
 */
const COLOUR_TAGS = ['Badge', 'StatusBadge', 'Alert']

const MODULES = walk(SRC)
  .map((path) => ({ id: relative(SRC, path).split(sep).join('/'), src: stripComments(readFileSync(path, 'utf8')) }))
  .map((file) => ({ ...file, icons: lucideNames(file.src) }))

const OCCURRENCES = MODULES.flatMap((file) =>
  COLOUR_TAGS.flatMap((tag) =>
    openingTags(file.src, tag).map((open) => ({
      file,
      tag,
      opening: open.text,
      children: childrenOf(file.src, tag, open),
    })),
  ),
)

/** An element carries an accessible name when a machine can read one off the tag. */
const named = (opening) => /\baria-label(?:ledby)?=/.test(opening)

/** Whatever is left of the children once decoration and empty braces are gone. */
function wordsIn(file, children) {
  let rest = children
  for (const icon of file.icons) rest = rest.replace(new RegExp(`<${icon}(?![A-Za-z0-9_])[^>]*/>`, 'g'), '')
  // `stripComments` has already turned `{/* … */}` into `{}`; an empty
  // expression container is not a word either.
  return rest.replace(/\{\s*\}/g, '').trim()
}

describe('a status has a word — CUI-A11Y-5', () => {
  test('the corpus is found at all', () => {
    // A scan that silently reads nothing passes every check under it. Both
    // numbers are floors, not counts: they may grow with the console.
    assert.ok(MODULES.length >= 40, `only ${MODULES.length} modules read`)
    assert.ok(OCCURRENCES.length >= 80, `only ${OCCURRENCES.length} colour-carrying elements found`)
    assert.ok(MODULES.some((file) => file.id === 'forms/status-badge.tsx'))
  })

  test('no colour-carrying element is written self-closing', () => {
    // `<StatusBadge tone="danger" />` is the pure form of the defect: a colour,
    // and nothing else in the element for anybody to read. An `aria-label` is
    // accepted because it IS the word — said to the machine rather than drawn.
    const offenders = OCCURRENCES.filter((found) => found.children === null && !named(found.opening)).map(
      (found) => `${found.file.id}: <${found.tag}/> is self-closing and unnamed`,
    )
    assert.deepEqual(offenders, [])
  })

  test('no colour-carrying element has empty children', () => {
    // The same defect one edit later: the tag still has a closing partner, but
    // the word between them was deleted. Whitespace and a stripped comment are
    // not a word.
    const offenders = OCCURRENCES.filter(
      (found) => found.children !== null && !named(found.opening) && !wordsIn(found.file, found.children),
    ).map((found) => `${found.file.id}: <${found.tag}> encloses no word`)
    assert.deepEqual(offenders, [])
  })

  test('an icon is never the whole of what a badge says', () => {
    // A lucide glyph inside a tinted pill is decoration on top of a colour, not
    // a substitute for the word — the reader still has to know what the shape
    // means. Checked apart from the empty case so the failure names the real
    // problem: the element has content, and none of it is language.
    const offenders = OCCURRENCES.filter((found) => {
      if (found.children === null || named(found.opening)) return false
      const decorated = [...found.file.icons].some((icon) =>
        new RegExp(`<${icon}(?![A-Za-z0-9_])`).test(found.children),
      )
      return decorated && !wordsIn(found.file, found.children)
    }).map((found) => `${found.file.id}: <${found.tag}> says everything with an icon and nothing with a word`)
    assert.deepEqual(offenders, [])
  })
})

describe('a warning has an icon — CUI-A11Y-5', () => {
  const statusBadge = readFileSync(join(SRC, 'forms', 'status-badge.tsx'), 'utf8')
  const code = stripComments(statusBadge)

  test('StatusBadge attaches an icon on the warning tone, and that is the whole reason it exists', () => {
    // This is the mechanism the module was written for, spelled out in its own
    // header: shadcn's Badge ships `destructive` as its ONLY severity, so
    // `warning` and `info` both land on `outline` and render IDENTICALLY. The
    // colour cannot tell them apart, so the icon does. Remove it and two
    // different readings become one grey pill with no way back.
    assert.match(code, /tone === 'warning' \?/, 'the warning tone no longer branches on anything')
    const branch = code.slice(code.indexOf("tone === 'warning' ?"))
    const glyph = branch.match(/<([A-Z][A-Za-z0-9]*)\b/)
    assert.ok(glyph, 'the warning tone renders no element at all')
    assert.ok(
      lucideNames(code).has(glyph[1]),
      `the warning tone renders <${glyph?.[1]}>, which is not an icon this module imported`,
    )
  })

  test('that icon is decoration beside the word, never a replacement for it', () => {
    // `aria-hidden` because the word is already there and announcing the glyph
    // as well would say the status twice. `data-icon="inline-start"` is what
    // earns the leading padding Badge reserves — without it the glyph collides
    // with the text and the pair reads as one smudge.
    assert.match(code, /aria-hidden/, 'the warning glyph is announced as well as drawn')
    assert.match(code, /data-icon="inline-start"/)
    assert.match(code, /\{children\}/, 'StatusBadge no longer renders the word it was handed')
  })

  test('every tone StatusBadge accepts still resolves to a variant', () => {
    // A tone with no entry in the map renders `variant={undefined}`, which falls
    // back to `default` — the token that means "primary", worn by a badge that
    // meant "danger". Compared key-for-key rather than counted.
    const tones = (code.match(/export type StatusTone =([^\n]*)/)?.[1] ?? '')
      .split('|')
      .map((word) => word.trim().replace(/['\s]/g, ''))
      .filter(Boolean)
    const mapped = [...code.slice(code.indexOf('const VARIANT')).matchAll(/(?:^|[{,])\s*(\w+):\s*'/g)].map(
      (match) => match[1],
    )
    assert.ok(tones.length >= 5, `only ${tones.length} tones parsed`)
    assert.deepEqual(new Set(mapped), new Set(tones))
  })

  test('an Alert that means danger draws a glyph as well as a hue', () => {
    // This console's Alert is registry output: it re-grids on `has-[>svg]` but
    // supplies no icon of its own, so the glyph is the call site's job. A
    // destructive Alert without one states its severity in colour alone — the
    // exact thing CUI-A11Y-5 forbids — and every other error banner in the
    // console already puts `<TriangleAlert />` first, so the odd one out is a
    // slip rather than a decision.
    //
    // The variant is read off the FULL opening tag, which is why the scanner
    // above is needed: `variant={verdict.ok ? 'default' : 'destructive'}` is a
    // real call site here, and a regex that stops at the first `>` never sees
    // the word `destructive` in it at all.
    const offenders = []
    for (const found of OCCURRENCES) {
      if (found.tag !== 'Alert' || found.children === null) continue
      if (!/variant=[\s\S]*destructive/.test(found.opening)) continue
      const hasGlyph = [...found.file.icons].some((icon) => new RegExp(`<${icon}(?![A-Za-z0-9_])`).test(found.children))
      if (!hasGlyph) offenders.push(`${found.file.id}: a destructive <Alert> with no icon`)
    }
    assert.deepEqual(offenders, [])
  })

  test('the glyph is a direct child, before the title', () => {
    // Not a style preference: the CVA switches to `grid-cols-[auto_1fr]` on
    // `has-[>svg]`, and an icon wrapped in a div is not a `>svg` child. The
    // layout then puts a full-width glyph above the headline instead of beside
    // it, which is how a correct icon still ends up looking like a mistake.
    const offenders = []
    for (const found of OCCURRENCES) {
      if (found.tag !== 'Alert' || found.children === null) continue
      if (!/variant=[\s\S]*destructive/.test(found.opening)) continue
      const first = found.children.match(/<([A-Za-z][A-Za-z0-9]*)/)
      if (first && !found.file.icons.has(first[1])) {
        offenders.push(`${found.file.id}: a destructive <Alert> whose first child is <${first[1]}>, not an icon`)
      }
    }
    assert.deepEqual(offenders, [])
  })
})
