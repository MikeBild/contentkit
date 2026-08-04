import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * How much prose the console's forms render, and where it is rendered.
 *
 * The console was too text-heavy, and the cause was structural: without real
 * components every explanation had to become a paragraph. A field grew two lines
 * of help beneath it, an empty state became a sentence, a section opened with
 * three explanatory paragraphs. The text itself is good — it says what unset
 * means, what a 409 will answer, which decision is expensive to reverse — so the
 * fix is never to delete it. It is to move each piece to where it is asked for:
 * one line stays on screen, a definition becomes a tooltip on the label, a
 * paragraph goes behind an info affordance, a consequence becomes an alert.
 *
 * This file therefore asserts the *rule*, not the strings. Two halves, and they
 * pull in opposite directions on purpose:
 *
 *  - the density half caps what is rendered unasked. One sentence per inline
 *    slot, one inline slot per field, no multi-sentence paragraph outside a
 *    disclosure. Names are never asserted, so a rewording is free.
 *  - the floor half counts every prose sentence in the file, wherever it sits,
 *    and refuses to let the total drop. Moving a sentence into a tooltip keeps
 *    the total; deleting it does not. That is what stops "too text-heavy" from
 *    being answered with a delete key, and it is the mutation this file is built
 *    around.
 *
 * Only committed files are read, and the density rules read only source under
 * apps/cockpit/src/forms. One rule does not: a native `title=` used as a tooltip
 * is unreachable by keyboard in any directory, so that test walks the whole of
 * apps/cockpit/src. Nothing here touches a generated artefact.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const formsDir = join(cockpit, 'forms')

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (path.endsWith('.tsx')) out.push(path)
  }
  return out
}

export const FILES = walk(formsDir).map((path) => ({
  id: relative(formsDir, path).split(sep).join('/'),
  path,
  src: readFileSync(path, 'utf8'),
}))

/**
 * Every `.tsx` in the console, not only the forms.
 *
 * The density budgets below are about forms and stay about forms — a page is
 * allowed a paragraph a field is not. One rule in this file was never about
 * forms at all: a native `title=` is invisible on touch and unreachable by
 * keyboard *wherever* it is written, and enforcing it under src/forms while
 * nine of them sat in the shell, the pages and the shared components meant the
 * suite certified the directory that happened to be clean. A rule enforced in
 * one directory is not a rule, so that one test reads this list instead.
 */
export const ALL = (function walkTree(dir) {
  const out = []
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walkTree(path))
    else if (path.endsWith('.tsx')) out.push(path)
  }
  return out
})(cockpit).map((path) => ({
  id: relative(cockpit, path).split(sep).join('/'),
  path,
  src: readFileSync(path, 'utf8'),
}))

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

/**
 * Comments are documentation, not rendered text. They are stripped first so a
 * long explanation *about* the code never counts as an explanation *in* it —
 * and, in the other direction, so a paragraph cannot be "moved" into a comment
 * and still satisfy the floor.
 */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

/**
 * A sentence is a run ended by `.`, `!` or `?` at a word boundary.
 *
 * Dotted identifiers are why the lookahead matters: `settings.presentation.preset`,
 * `plausible.io's`, `.svg` and `schema.org` all carry a dot that no reader hears
 * as a full stop, and each one appears in real help text here. A string with no
 * terminator at all is still one sentence — most one-liners have no period.
 */
export function sentences(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (!clean) return 0
  const ends = clean.match(/[.!?]+(?=\s|$)/g)
  return Math.max(1, ends ? ends.length : 0)
}

function words(text) {
  return String(text).trim().split(/\s+/).filter(Boolean)
}

/**
 * Tailwind, not English. A class list is a string literal like any other, and
 * the floor would happily count `flex flex-col gap-4` as a sentence of prose;
 * one utility token anywhere in a string is enough to disqualify it, because no
 * sentence in this console contains `rounded-lg`.
 */
const CLASSY =
  /(?:^|[\s:[])(?:flex|grid|gap-|p[xytblr]?-\d|m[xytblr]?-\d|space-[xy]-|text-(?:xs|sm|base|lg|xl|left|right|center|balance|muted|foreground|accent|chart|destructive|popover|card|primary|white)|bg-|border|rounded|w-(?:full|fit|\d)|h-\d|size-\d|items-|justify-|overflow|truncate|list-|shrink|font-(?:mono|medium|semibold|normal|bold)|hover:|focus|disabled:|sm:|md:|lg:|absolute|relative|inline-flex|min-w|max-w|whitespace|tabular-nums|animate-|opacity-|ring-|col-span|grid-cols|subgrid|dvh|shadow|cursor-)/

/**
 * Prose, for counting purposes: enough words to be a line someone reads.
 *
 * Three words, not four. "Revisions are immutable." and "No groups yet." are
 * both real sentences that a reader acts on, and a four-word floor quietly
 * excused deleting them.
 */
function isProse(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim()
  if (words(clean).length < 3) return false
  if (CLASSY.test(clean)) return false
  // A bare identifier, path or enum value is not prose however long it is.
  if (!/[a-z]{2,}\s+[a-z]{2,}/i.test(clean)) return false
  return true
}

/**
 * The literals inside one attribute value or object-property value.
 *
 * Template placeholders are dropped rather than resolved — `${SITE_LOCALE_MAX}`
 * is a number, not a clause. A ternary yields two literals and the caller takes
 * the larger, because only one of them is ever on screen.
 */
const APOSTROPHE = '\u0001'

function literalsIn(text) {
  const out = []
  // Same apostrophe problem as literalRanges, one level down: a JSX fragment in
  // an attribute value ("this site's settings") would otherwise be read as the
  // start of a string literal and pull the rest of the value into it.
  const masked = text.replace(/([A-Za-z0-9])'([A-Za-z0-9])/g, `$1${APOSTROPHE}$2`)
  const pattern = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
  for (const match of masked.matchAll(pattern)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? ''
    out.push(
      raw
        .replace(/\$\{[^}]*\}/g, ' ')
        .replace(/\\n/g, ' ')
        .split(APOSTROPHE)
        .join("'"),
    )
  }
  return out
}

/**
 * Where the file's string literals are.
 *
 * Needed because prose contains `=` and `:` too: "published with rel=me", "the
 * `?site=` parameter", "itunes:category". Without this, the slot reader would
 * find an attribute called `rel` inside a sentence and then read the rest of the
 * file as its value. A slot only counts if its name sits in code.
 */
function literalRanges(src) {
  const ranges = []
  const wordish = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch)
  let at = 0
  while (at < src.length) {
    const ch = src[at]
    // An apostrophe is not a quote. "the renderer's defaults" appears as JSX
    // text all over these forms, and treating that `'` as a string opener made
    // the lexer swallow the code after it — which silently moved every offset in
    // the rest of the file and let real violations go unreported.
    if (ch === "'" && wordish(src[at - 1]) && wordish(src[at + 1])) {
      at += 1
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const start = at
      at += 1
      while (at < src.length) {
        if (src[at] === '\\') at += 2
        else if (src[at] === ch) break
        else at += 1
      }
      ranges.push([start, Math.min(at, src.length - 1)])
    }
    at += 1
  }
  return ranges
}

/**
 * Every `name=` attribute and `name:` property whose value carries a literal,
 * with the widest literal it holds. Values are read with a brace/quote counter
 * rather than a regex so a nested object or arrow function cannot end the value
 * early.
 */
function slots(src) {
  const out = []
  const strings = literalRanges(src)
  const inString = (index) => strings.some(([from, to]) => index > from && index < to)
  const start = /\b([A-Za-z][A-Za-z0-9_]*)\s*([=:])\s*/g
  for (const match of src.matchAll(start)) {
    if (inString(match.index)) continue
    const name = match[1]
    const from = match.index + match[0].length
    let at = from
    let depth = 0
    let quote = null
    while (at < src.length) {
      const ch = src[at]
      if (quote) {
        if (ch === '\\') at += 1
        else if (ch === quote) quote = null
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
      else if (ch === '{' || ch === '(' || ch === '[') depth += 1
      else if (ch === '}' || ch === ')' || ch === ']') {
        if (depth === 0) break
        depth -= 1
      } else if (depth === 0 && (ch === ',' || ch === '\n')) break
      at += 1
    }
    const value = src.slice(from, at)
    const found = literalsIn(value).filter(isProse)
    if (found.length === 0) continue
    let widest = found[0]
    for (const entry of found) if (sentences(entry) > sentences(widest)) widest = entry
    out.push({ name, text: widest, all: found })
  }
  return out
}

/**
 * The span of one named element, found by its own name.
 *
 * A general JSX parser is the wrong tool here: TypeScript generics
 * (`Record<string, string>`, `useState<StepId>`) look exactly like tags to one,
 * and an unbalanced stack would silently misattribute every paragraph after it.
 * Matching one name at a time cannot make that mistake — `</p>` closes `<p`, and
 * nothing else does.
 */
function spans(src, name) {
  const out = []
  const open = new RegExp(`<${name}(?=[\\s/>])`, 'g')
  for (const match of src.matchAll(open)) {
    // Walk the opening tag to its own `>`, ignoring quoted and braced text.
    let at = match.index + name.length + 1
    let depth = 0
    let quote = null
    let selfClosing = false
    while (at < src.length) {
      const ch = src[at]
      if (quote) {
        if (ch === '\\') at += 1
        else if (ch === quote) quote = null
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
      else if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
      else if (ch === '>' && depth === 0) {
        selfClosing = src[at - 1] === '/'
        break
      }
      at += 1
    }
    const openTag = src.slice(match.index, at + 1)
    if (selfClosing) {
      out.push({ start: match.index, end: at + 1, openTag, body: '' })
      continue
    }
    // Then to the matching close, counting same-named elements on the way.
    let cursor = at + 1
    let level = 1
    const bodyStart = cursor
    const step = new RegExp(`<${name}(?=[\\s/>])|</${name}\\s*>`, 'g')
    step.lastIndex = cursor
    let end = src.length
    let hit
    while ((hit = step.exec(src))) {
      if (hit[0].startsWith('</')) {
        level -= 1
        if (level === 0) {
          end = hit.index + hit[0].length
          cursor = hit.index
          break
        }
      } else if (!/\/>\s*$/.test(hit[0])) level += 1
    }
    out.push({ start: match.index, end, openTag, body: src.slice(bodyStart, cursor) })
  }
  return out
}

/**
 * Where a component used in `file` is declared, as an absolute path, or null for
 * a package (`Link` from @tanstack/react-router is not this tree's business).
 */
function resolveFrom(fromPath, specifier) {
  const base = specifier.startsWith('@/')
    ? join(cockpit, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(fromPath), specifier)
      : null
  if (base === null) return null
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return null
}

/**
 * The declaration of `name`, from its keyword to the closing brace in column one.
 *
 * `'\n}\n'` and not `'\n}'`: a component that destructures its props over several
 * lines closes that pattern with a `}` in column one too — `}: ChipProps) {` —
 * and stopping there returns the signature instead of the component. `Chip`
 * spreads onto a `<Badge>` two lines below that point, so the shorter read said
 * "takes no props it forwards" about a component that forwards all of them.
 */
function definitionOf(src, name) {
  const at = src.search(new RegExp(`(?:export\\s+)?(?:function|const)\\s+${name}\\b`))
  if (at < 0) return null
  const end = src.indexOf('\n}\n', at)
  return src.slice(at, end < 0 ? src.length : end + 3)
}

/**
 * Does `<Name title=…>` end up as a native tooltip?
 *
 * Yes when the component never names `title` in its own declaration *and*
 * spreads the rest of its props onto something — `{...props}` on a `<span>`, or
 * on a Radix primitive that does the same one level down. A component that
 * destructures `title` has taken it as a heading and is rendering it somewhere
 * this rule has no opinion about.
 *
 * Both conditions, deliberately: a false alarm here would be a rule about
 * component prop names, which is not what this is. The cost is that a
 * forwarding component whose declaration happens to contain the word `title`
 * for another reason is missed — reported rather than papered over.
 */
function forwardsToDom(file, name) {
  const local = definitionOf(file.src, name)
  let declaration = local
  if (!declaration) {
    const importing = [...file.src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s*["']([^"']+)["']/g)].find(
      ([, names]) => names.split(',').some((piece) => (piece.split(/\s+as\s+/).pop() ?? '').trim() === name),
    )
    const home = importing ? resolveFrom(file.path, importing[2]) : null
    if (home === null) return false
    declaration = definitionOf(stripComments(readFileSync(home, 'utf8')), name)
  }
  if (!declaration) return false
  return !/\btitle\b/.test(stripComments(declaration)) && /\{\s*\.\.\.[\w$]+\s*\}/.test(declaration)
}

/**
 * The words an element renders itself: nested tags and `{expressions}` removed.
 *
 * Braces are peeled innermost-first until none are left, because a ternary that
 * renders JSX nests them arbitrarily deep and one pass would leak `? (` and the
 * branch's own markup into what looks like rendered text.
 */
function directText(body) {
  // A list is structure. Three numbered steps inside an Alert are three lines a
  // reader scans, not a paragraph, so they are not measured as one.
  let text = body.replace(/<(ol|ul)\b[\s\S]*?<\/\1>/g, ' ')
  for (let pass = 0; pass < 20; pass += 1) {
    const next = text.replace(/\{[^{}]*\}/g, ' ')
    if (next === text) break
    text = next
  }
  return text
    .replace(/<[^<>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// The two budgets
// ---------------------------------------------------------------------------

/**
 * Slots that put a line on screen before anyone asks for it.
 *
 * `description` is deliberately absent. It is not a field's second line of help:
 * it is the description slot of whichever component owns it — a confirm dialog's
 * body, an option's consequence inside a HoverCard — and each of those is
 * measured where it is rendered instead.
 */
const INLINE_SLOTS = ['help', 'fallback', 'emptyMessage', 'message', 'summary', 'detail']

/**
 * Slots the floor ignores. Everything else that holds a sentence is prose the
 * console shows someone, wherever it sits: a `help`, a `definition`, an `aside`,
 * a lookup table of scope descriptions, a validation message. Counting by
 * exclusion rather than by allow-list is deliberate — a new slot is protected
 * from deletion the moment it exists, instead of the day someone remembers to
 * add its name here.
 */
const UNCOUNTED_SLOTS = ['className', 'class', 'queryKey', 'to', 'href', 'id', 'key']

/**
 * Disclosures that are *visible* rather than on demand: they appear when a
 * condition holds — the list is empty, the save failed, the dialog opened — and
 * then they are simply on screen. Two sentences is their ceiling, or every
 * paragraph this refactor moved would just move into an Alert instead.
 */
const VISIBLE_DISCLOSURES = [
  'AlertTitle',
  'AlertDescription',
  'AlertDialogDescription',
  'DialogDescription',
  'EmptyTitle',
  'EmptyDescription',
]

/** Regions where a paragraph is what the reader asked for. */
const DISCLOSURES = [
  'TooltipContent',
  'PopoverContent',
  'PopoverDescription',
  'HoverCardContent',
  'Alert',
  'AlertDescription',
  'AlertTitle',
  'AlertDialogDescription',
  'DialogDescription',
  'EmptyDescription',
  'EmptyTitle',
  'CollapsibleContent',
]

/**
 * Elements that render a line of prose directly and are therefore capped.
 *
 * `Note` is a local wrapper this console grew — a `<p>` with two tones — and it
 * is listed so that the paragraphs passed through it are counted rather than
 * hidden behind a component name. A separate test forbids re-inventing it.
 */
const PROSE_ELEMENTS = ['p', 'li', 'FieldDescription', 'CardDescription', 'dd', 'figcaption', 'Note']

export function analyse(src) {
  const body = stripComments(src)
  const disclosureSpans = DISCLOSURES.flatMap((name) => spans(body, name))
  // `>=` because a disclosure is its own region: a DialogDescription is already
  // the place a short paragraph belongs, and must not report itself as loose.
  const inDisclosure = (index) => disclosureSpans.some((span) => index >= span.start && index < span.end)

  const attributes = slots(body)
  const inline = attributes.filter((slot) => INLINE_SLOTS.includes(slot.name))
  const counted = attributes.filter((slot) => !UNCOUNTED_SLOTS.includes(slot.name))

  const paragraphs = []
  for (const name of PROSE_ELEMENTS) {
    for (const span of spans(body, name)) {
      const text = directText(span.body)
      if (!isProse(text)) continue
      paragraphs.push({ name, text, start: span.start, disclosed: inDisclosure(span.start) })
    }
  }

  /**
   * The floor counts text runs, not elements.
   *
   * Attributing a paragraph to its enclosing element is the right way to cap
   * density and the wrong way to count prose: the moment a sentence moves from a
   * `<p>` into the children of a component — a SectionAside, an Empty, a step
   * summary — an element-based count loses sight of it and reports a deletion
   * that never happened. A run of rendered words counts wherever it sits.
   */
  const runs = [...body.matchAll(/>([^<>{}]+)</g)].map((match) => match[1]).filter(isProse)

  const floor =
    counted.reduce((n, slot) => n + sentences(slot.text), 0) + runs.reduce((n, run) => n + sentences(run), 0)

  return { body, attributes, inline, counted, paragraphs, runs, floor, inDisclosure }
}

/**
 * The floor, per file: the prose each one carried when this test was written.
 *
 * Recorded rather than derived, because a derived floor is no floor at all. The
 * numbers only ever go up: a file that loses a sentence fails here, and the
 * failure names the file.
 */
const FLOOR = {
  'aside.tsx': 0,
  'audience/groups.tsx': 19,
  'audience/moderation.tsx': 23,
  'audience/readers.tsx': 24,
  'audience/rebuild-banner.tsx': 11,
  'audience/rules.tsx': 15,
  'content/body.tsx': 2,
  'content/editor.tsx': 12,
  'content/fields.tsx': 79,
  'content/preview.tsx': 5,
  'content/revisions.tsx': 3,
  'fields/choice.tsx': 1,
  'fields/color.tsx': 5,
  'fields/date.tsx': 0,
  'fields/field.tsx': 1,
  'fields/list.tsx': 5,
  'fields/map.tsx': 11,
  'fields/number.tsx': 4,
  'fields/object-list.tsx': 0,
  'fields/scopes.tsx': 4,
  'fields/secret.tsx': 3,
  'fields/subtree.tsx': 1,
  'fields/text.tsx': 2,
  'fields/url.tsx': 4,
  'gallery.tsx': 16,
  'platform/api-keys.tsx': 19,
  'platform/identity.tsx': 33,
  'platform/previews.tsx': 18,
  'platform/webhooks.tsx': 33,
  'save-bar.tsx': 0,
  'site/conflict.tsx': 3,
  'site/sections.tsx': 129,
  'site/wizard.tsx': 55,
  // Two modules the forms migration added. `status-badge.tsx` is a mapping and
  // renders no prose of its own; `table-state.tsx` carries the two sentences the
  // empty and failed states say, which used to live in ui/primitives.tsx.
  'status-badge.tsx': 0,
  'table-state.tsx': 2,
  /**
   * Four became two, and no sentence left the screen.
   *
   * The old four counted "Save and leave" twice. The label was written as
   * `{isSaving ? 'Saving…' : 'Save and leave'}`, and `literalsIn` reads both
   * branches of a ternary — so one button contributed two prose slots, of which
   * at most one was ever rendered. UI-UX.md §2 now forbids a button that rewrites
   * its own label while it works (`Spinner` + `disabled`, the label stays), so
   * the ternary is gone and the label is a plain child of `<Button>`.
   *
   * A plain child that follows a brace expression is invisible to `runs`, whose
   * pattern is `>text<` and cannot span the `}` that the spinner's conditional
   * leaves in front of the words. So the honest count this analyser can see is
   * two, and `ck-unsaved-save` is guarded instead by
   * `test/unit/cockpit-affordances.test.mjs`, which asserts that a button's label
   * is a literal rather than a function of a pending flag — a label that ceased
   * to exist would not be one.
   */
  'use-unsaved-guard.tsx': 2,
  /**
   * The DOM test that renders the shell, co-located with it — a `.tsx` under
   * `forms/`, so the walk finds it, and it has to be declared or the first test
   * below fails on a file nobody forgot.
   *
   * Zero, and deliberately not its 36. Every other entry here is a promise about
   * a console someone reads; this file's sentences are fixtures ("Shown in the
   * browser tab.", "Already taken") whose only job is to be findable in the
   * accessibility tree, and freezing them would mean a test could not stop using
   * one. It is still held to every *density* rule above — a fixture that models a
   * field ought to model a legal one — which is the half that has meaning here.
   */
  'fields/field.test.tsx': 0,
  /**
   * Zero for the same reason as `fields/field.test.tsx`: a co-located DOM test is
   * a `.tsx` under `forms/`, so the walk finds it and it has to be declared, but
   * its strings are fixtures rather than anything an operator reads. Freezing them
   * would mean a test could not change the sentence on a button it renders.
   */
  'use-unsaved-guard.test.tsx': 0,
}

describe('cockpit forms — text density', () => {
  test('every form file is accounted for in the floor', () => {
    const seen = FILES.map((file) => file.id).sort()
    const declared = Object.keys(FLOOR).sort()
    assert.deepEqual(
      seen.filter((id) => !declared.includes(id)),
      [],
      'a new form file must declare its prose floor',
    )
    assert.deepEqual(
      declared.filter((id) => !seen.includes(id)),
      [],
      'the floor names a file that no longer exists',
    )
  })

  test('no inline prose slot carries more than one sentence', () => {
    const over = []
    for (const file of FILES) {
      for (const slot of analyse(file.src).inline) {
        const count = sentences(slot.text)
        if (count > 1) over.push(`${file.id}: ${slot.name}= holds ${count} sentences — ${slot.text.slice(0, 70)}…`)
      }
    }
    assert.deepEqual(over, [], `move the extra sentences to a definition, an aside or an Alert:\n${over.join('\n')}`)
  })

  test('no field renders two inline prose slots at once', () => {
    const doubled = []
    for (const file of FILES) {
      const { body } = analyse(file.src)
      // help and fallback on the same opening tag is the two-lines-of-help defect.
      for (const name of [
        'TextField',
        'TextAreaField',
        'DateField',
        'DateTimeField',
        'NumberField',
        'UrlField',
        'SlugField',
        'EnumSelect',
        'TriToggle',
        'TagListField',
        'LocaleField',
        'ObjectListField',
        'ChoiceCards',
        'EnumMultiSelect',
        'ExtraFieldsField',
        'SwitchField',
        'SegmentedField',
        'KeyValueField',
        'TokenMapField',
        'SecretField',
        'ScopePicker',
        'PathField',
        'ColorField',
      ]) {
        for (const span of spans(body, name)) {
          // Only the tag's own attributes. `options={[{ description: … }]}` is a
          // list of choices, not a second line of help for the field, so the
          // braced values are peeled before the names are read.
          let flat = span.openTag
          for (let pass = 0; pass < 20; pass += 1) {
            const next = flat.replace(/\{[^{}]*\}/g, '')
            if (next === flat) break
            flat = next
          }
          const attrs = [...flat.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)=/g)].map((match) => match[1])
          // Narrower than INLINE_SLOTS on purpose. `emptyMessage` is a state, not
          // an explanation — it replaces the list rather than sitting under it —
          // so a field may carry one line of help beside it. Two *explanations*
          // is the defect.
          const carried = ['help', 'fallback', 'description', 'detail'].filter((slot) => attrs.includes(slot))
          if (carried.length > 1) doubled.push(`${file.id}: <${name}> carries ${carried.join(' + ')}`)
        }
      }
    }
    assert.deepEqual(doubled, [], `one inline line per field:\n${doubled.join('\n')}`)
  })

  test('a multi-sentence paragraph is only rendered inside a disclosure', () => {
    const loose = []
    for (const file of FILES) {
      for (const entry of analyse(file.src).paragraphs) {
        if (entry.disclosed) continue
        const count = sentences(entry.text)
        if (count > 1)
          loose.push(`${file.id}: <${entry.name}> renders ${count} sentences — ${entry.text.slice(0, 70)}…`)
      }
    }
    assert.deepEqual(loose, [], `put the paragraph behind a Popover, HoverCard or Alert:\n${loose.join('\n')}`)
  })

  test('a visible disclosure stays within two sentences', () => {
    const over = []
    for (const file of FILES) {
      const body = stripComments(file.src)
      for (const name of VISIBLE_DISCLOSURES) {
        for (const span of spans(body, name)) {
          const text = directText(span.body)
          if (!isProse(text)) continue
          const count = sentences(text)
          if (count > 2) over.push(`${file.id}: <${name}> renders ${count} sentences — ${text.slice(0, 60)}…`)
        }
      }
    }
    assert.deepEqual(over, [], `an Alert or an Empty is not a place to park a paragraph:\n${over.join('\n')}`)
  })

  test('prose is never dropped straight into a div or a span', () => {
    const bare = []
    for (const file of FILES) {
      const body = stripComments(file.src)
      for (const name of ['div', 'span']) {
        for (const span of spans(body, name)) {
          const lead = span.body.split(/[<{]/)[0]
          if (isProse(lead) && words(lead).length >= 6) {
            bare.push(`${file.id}: <${name}> renders “${lead.trim().slice(0, 60)}…” itself`)
          }
        }
      }
    }
    assert.deepEqual(bare, [], `use FieldDescription, Empty or Alert:\n${bare.join('\n')}`)
  })

  test('no form re-invents a prose wrapper', () => {
    const wrappers = []
    for (const file of FILES) {
      const body = stripComments(file.src)
      // A component whose whole body is a paragraph of children is how a form
      // grows its own private "explanatory text" slot again.
      if (/<p[^>]*>\s*\{children\}\s*<\/p>/.test(body)) wrappers.push(`${file.id}: renders {children} as a bare <p>`)
    }
    assert.deepEqual(wrappers, [], `use FieldDescription, Alert or a Popover:\n${wrappers.join('\n')}`)
  })

  test('no native title attribute is used as a tooltip, anywhere in the console', () => {
    /**
     * Old scope: the twelve element names hard-coded above, under src/forms only.
     * New scope: every `.tsx` under apps/cockpit/src, every tag in it.
     *
     * Two holes closed at once, and the second is why the first was survivable.
     *
     *  - The directory. Nine native titles sat outside src/forms — two in the
     *    shell, one on an overview `<dt>`, the rest in shared components — and
     *    the guard never walked there. A tooltip is no more reachable by
     *    keyboard in app/ than it is in forms/.
     *  - The element list. `<time>` and `<dt>` were not on it, so two of the
     *    twelve would have passed even inside the directory that was walked.
     *    Tag names are now read off the file: anything lowercase is a DOM
     *    element, and there is no list to forget to extend.
     *
     * `title` stays a perfectly good prop name on a component — `Page`, `Group`,
     * `Confirm` and `RevealOnce` all take a heading called that, and each of them
     * *names* `title` in its own signature. What is not fine is a component that
     * never mentions `title` and spreads its props onto a DOM node: `<Chip
     * title=…>`, `<AppLink title=…>` and `<ToggleGroupItem title=…>` are native
     * tooltips with a capital letter in front of them, and the old rule — which
     * looked only at lowercase names — missed all three inside its own directory.
     */
    const native = []
    for (const file of ALL) {
      const body = stripComments(file.src)
      const tags = [...new Set([...body.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)].map((match) => match[1]))]
      for (const name of tags) {
        const dom = /^[a-z]/.test(name)
        if (!dom && !forwardsToDom(file, name)) continue
        for (const span of spans(body, name)) {
          if (!/\btitle=/.test(span.openTag)) continue
          native.push(`${file.id}: <${name} title=…>${dom ? '' : ' — spreads its props onto a DOM node'}`)
        }
      }
    }
    assert.deepEqual(native, [], `a native title is invisible to touch and to the keyboard:\n${native.join('\n')}`)
  })

  test('every disclosure affordance is addressable and non-empty', () => {
    const problems = []
    for (const file of FILES) {
      const body = stripComments(file.src)
      for (const name of ['TooltipTrigger', 'PopoverTrigger', 'HoverCardTrigger']) {
        for (const span of spans(body, name)) {
          const region = body.slice(span.start, span.end)
          if (!/data-testid=/.test(region)) problems.push(`${file.id}: <${name}> has no data-testid beneath it`)
        }
      }
      for (const name of ['TooltipContent', 'PopoverContent', 'HoverCardContent']) {
        for (const span of spans(body, name)) {
          if (span.body.trim().length === 0) problems.push(`${file.id}: <${name}> is empty`)
        }
      }
    }
    assert.deepEqual(problems, [], problems.join('\n'))
  })

  test('the prose that moved is still there — no file may lose a sentence', () => {
    const lost = []
    for (const file of FILES) {
      const { floor } = analyse(file.src)
      const expected = FLOOR[file.id]
      if (expected === undefined) continue
      if (floor < expected) lost.push(`${file.id}: ${floor} prose sentences, floor is ${expected}`)
    }
    assert.deepEqual(lost, [], `text-heavy is fixed by moving prose, never by deleting it:\n${lost.join('\n')}`)
  })

  test('the shared field shell offers the three destinations, and reaches them accessibly', () => {
    const shell = FILES.find((file) => file.id === 'fields/field.tsx')
    assert.ok(shell, 'fields/field.tsx is the shell every field composes')
    const src = shell.src
    for (const symbol of ['Field', 'FieldLabel', 'FieldDescription', 'FieldError']) {
      assert.match(src, new RegExp(`\\b${symbol}\\b`), `the shell composes shadcn's ${symbol}`)
    }
    assert.match(src, /data-invalid=/, 'invalid state is data-invalid on the Field')
    assert.match(src, /'aria-invalid'|aria-invalid=/, 'and aria-invalid on the control')
    // The rendered element, not the import line: a shell that imports a popover
    // and then draws a div has moved the text out of reach again.
    assert.match(src, /<TooltipContent[\s>]/, 'a definition has a tooltip to live in')
    assert.match(src, /<PopoverContent[\s>]/, 'a paragraph has a popover to live in')
    assert.match(src, /<Alert[\s>]/, 'a consequence has an alert to live in')
    // The hidden text has to stay reachable, or the move is a regression.
    assert.match(src, /aria-label=/, 'each affordance names itself for a screen reader')
    assert.match(src, /aria-describedby/, 'and the description is still bound to the control')
  })

  test('a closed set of choices is a ToggleGroup, not looped buttons', () => {
    const choice = FILES.find((file) => file.id === 'fields/choice.tsx')
    assert.ok(choice, 'fields/choice.tsx holds every closed-set field')
    assert.match(choice.src, /ToggleGroupItem/, 'the options are ToggleGroupItems')
    assert.doesNotMatch(
      stripComments(choice.src),
      /aria-checked=/,
      'ToggleGroup owns the pressed state; a hand-rolled aria-checked means the loop is still there',
    )
    // Each option's consequence is a paragraph, so it lives behind an affordance
    // rather than in six stacked cards.
    assert.match(choice.src, /HoverCardContent|PopoverContent|TooltipContent/, 'an option describes itself on request')
  })
})
