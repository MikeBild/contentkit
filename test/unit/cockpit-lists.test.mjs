import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The console's lists: what they may claim about their own order and size.
 *
 * Both claims are cheap to fake. A header arrow that reorders the twenty-five
 * rows on screen, in a list of four thousand, is indistinguishable from a sorted
 * list. A "1–25 of 106" counted client-side over a response the server truncated
 * is a number nobody said. So the rules live in a dependency-free `.ts` module —
 * apps/cockpit/src/lib/table-view.ts — and this file calls them.
 *
 * Two halves, following cockpit-primitives.test.mjs. The behavioural half imports
 * that module and the cursor reducer it builds on; Node reads TypeScript by
 * stripping types, which landed in 22.6, so on Node 20 those tests skip with a
 * printed reason rather than passing silently. The structural half runs
 * everywhere and guards what a pure function cannot: that the data table is the
 * console's one Table rather than a second one, that its four states are
 * still four, that every control is addressable, that the editor no longer
 * renders the word "Loading…", and that the sort capability the page claims is
 * the capability docs/openapi.json actually describes.
 *
 * Only committed files are read. Nothing here touches a generated artefact.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const source = (...parts) => readFileSync(join(cockpit, ...parts), 'utf8')

/**
 * Every `.ts`/`.tsx` in the console, with its path.
 *
 * One rule below is about the whole tree rather than about lists: a severity
 * painted with a chart colour is the same defect in a shared component as it is
 * on a page, and reading only `pages` is what let thirty of them stand.
 * `content/site.scoped.css` and the rest of the generated output are not read —
 * this walk takes source only, so it sees the same files on a clean checkout as
 * it does after a build.
 */
const allSources = (function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
})(cockpit).map((path) => ({ id: relative(cockpit, path).split(sep).join('/'), src: readFileSync(path, 'utf8') }))

const dataTable = source('components', 'ui', 'data-table.tsx')
const contentPage = source('pages', 'content.tsx')
/**
 * The audio summary and the readiness tiles, which used to share a file.
 *
 * `pages/authoring.tsx` was five routed pages in one module — Published,
 * Compositions, Decks, Audio and System, each with its own `<Page>` — and it is
 * now five files. The rules below are about two of them plus the rule they both
 * import, so this is those three sources read as one text: every assertion here
 * is a `const` or an element lifted out by name, and none of them spans a file.
 */
const authoringPage = [source('pages', 'audio.tsx'), source('pages', 'system.tsx'), source('lib', 'reported.ts')].join(
  '\n',
)
const openapi = JSON.parse(readFileSync(join(root, 'docs', 'openapi.json'), 'utf8'))

/**
 * What the file would show on screen, with the prose about it removed.
 *
 * Both files below explain at length why the word "Loading…" is not good enough
 * as a placeholder, which means both files contain it. An assertion that the word
 * is gone has to look at the code, not at the argument for the code.
 */
const code = (text) => text.replaceAll(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1')
const dataTableCode = code(dataTable)
const contentPageCode = code(contentPage)
const authoringCode = code(authoringPage)

// ── Reading a number off a page that cannot be rendered here ─────────────────

/**
 * An expression lifted out of a `.tsx` and answered for real values.
 *
 * A regex can only ask whether a line is present, and twice in a row that was not
 * enough: `?? 0` next to a fixed sentence was replaced with `?? 999999` and every
 * assertion still matched, because what was pinned was the sentence. The three
 * readers below take the expression the page actually evaluates and evaluate it, so
 * the number is what is pinned. Same `new Function` idiom as
 * cockpit-navigation.test.mjs, for the same reason: the rule is small, pure and
 * unreachable through an import because the file around it is JSX.
 */
const evaluate = (expression, scope) =>
  new Function(...Object.keys(scope), `return (${expression})`)(...Object.values(scope))

/** The contents of the `{…}` group starting at or after `from`, braces balanced. */
function braceGroup(text, from) {
  const open = text.indexOf('{', from)
  if (open < 0) return null
  let depth = 0
  for (let index = open; index < text.length; index++) {
    if (text[index] === '{') depth++
    else if (text[index] === '}' && --depth === 0) return text.slice(open + 1, index)
  }
  return null
}

/**
 * The right-hand side of `const <name> =`, however many lines it runs to.
 *
 * The statement ends at the first following line that is non-empty and indented no
 * deeper than the declaration — which is what a `const` on one line and a ternary
 * broken over four have in common.
 */
function rightHandSide(text, name) {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => line.trimStart().startsWith(`const ${name} =`))
  if (at < 0) return null
  const indent = lines[at].length - lines[at].trimStart().length
  const collected = [lines[at]]
  for (let index = at + 1; index < lines.length; index++) {
    const line = lines[index]
    if (line.trim() === '') break
    if (line.length - line.trimStart().length <= indent) break
    collected.push(line)
  }
  return collected.join('\n').replace(`const ${name} =`, '')
}

/** A top-level `function <name>` from the page, callable, with its types dropped. */
function functionOf(text, name) {
  const start = text.indexOf(`function ${name}(`)
  if (start < 0) return null
  const end = text.indexOf('\n}', start)
  if (end < 0) return null
  const declaration = text
    .slice(start, end + 2)
    // The one thing `new Function` cannot read: the TypeScript signature.
    .replace(/function \w+\(([^)]*)\)[^{]*\{/, (_, parameters) => `function ${name}(${parameters.split(':')[0]}) {`)
  return new Function(`${declaration}\nreturn ${name}`)()
}

/**
 * What an element renders, as a template literal: `{expr}` becomes `${expr}` and the
 * text between two expressions is kept exactly as JSX keeps it — a whitespace run
 * containing a line break is dropped, anything else stays.
 *
 * An emptied brace pair is skipped: `code()` above strips `/* … *\/` and a JSX
 * comment leaves `{}` behind, which rendered nothing before it was stripped either.
 * Only elements with no child elements can be read this way, which is the case for
 * every sentence below.
 */
function renderedText(text, anchor) {
  const at = text.indexOf(anchor)
  if (at < 0) return null
  const open = text.indexOf('>', at)
  const close = text.indexOf('</', open)
  if (open < 0 || close < 0) return null
  const children = text.slice(open + 1, close)
  let out = ''
  for (let index = 0; index < children.length; index++) {
    if (children[index] !== '{') {
      out += children[index]
      continue
    }
    const group = braceGroup(children, index)
    if (group === null) return null
    if (group.trim() !== '') out += `\${${group}}`
    index += group.length + 1
  }
  return `\`${out.replaceAll(/\s*\n\s*/g, '')}\``
}

/**
 * The part of `DataTable` that decides which rows are on screen and in what order.
 *
 * A `.tsx` cannot be imported here — Node strips types, it does not compile JSX —
 * so the three rules this stretch of code carries are read off the source. They are
 * worth reading off: each one was deleted in an adversarial pass and the whole
 * suite stayed green, which means the rule was documented and not guarded.
 */
const ordering = (() => {
  const start = dataTableCode.indexOf('const ordered = useMemo')
  const end = dataTableCode.indexOf('const activeReach')
  return start >= 0 && end > start ? dataTableCode.slice(start, end) : ''
})()

test('the ordering half of the data table was found, so the rules below are read off code', () => {
  assert.ok(
    ordering.includes('useMemo') && ordering.includes('clampPage'),
    'ordered/position/slice must still live between `const ordered` and `const activeReach`',
  )
})

const stripsTypes = typeof process.features.typescript === 'string'
let logic = null
let failure = null
try {
  logic = {
    view: await import('../../apps/cockpit/src/lib/table-view.ts'),
    cursor: await import('../../apps/cockpit/src/lib/cursor.ts'),
  }
} catch (error) {
  failure = error
}
const behavioural = {
  skip: logic ? false : `this Node cannot import TypeScript (type stripping landed in 22.6): ${failure?.message}`,
}

test('the behavioural half is skipped only because the runtime cannot read TypeScript', () => {
  if (stripsTypes) assert.ok(logic, `type stripping is available, so the modules must load: ${failure?.message}`)
  else assert.equal(logic, null, 'a Node without type stripping cannot have imported them')
})

/**
 * The columns of the authoring list, as capabilities. This is the same shape
 * `DataTable` derives from its column definitions — comparator presence becomes
 * `comparable` — so the reach of every sort control in the console is decided by
 * data of exactly this form.
 */
const CONTENT_COLUMNS = [
  { id: 'title', comparable: true, required: true },
  { id: 'kind', comparable: true },
  { id: 'locale', comparable: true },
  { id: 'slug', comparable: true },
  // Two independent facts in one cell. No order, therefore no control.
  { id: 'live' },
  { id: 'updated', comparable: true, descFirst: true },
  { id: 'created', comparable: true, descFirst: true, hiddenByDefault: true },
  { id: 'actions', required: true },
]

const DEFAULT_VISIBLE = ['title', 'kind', 'locale', 'slug', 'live', 'updated', 'actions']

describe('walking a window over a list the endpoint answers whole', behavioural, () => {
  const size = 25

  test('the first page starts at the first row and offers only forward', () => {
    const { firstPage, hasNext, hasPrevious, pageNumber } = logic.cursor
    const window = logic.view.windowOf(106, firstPage.cursor, size)
    assert.deepEqual({ start: window.start, end: window.end }, { start: 0, end: 25 })
    assert.equal(window.nextCursor, '25', 'the cursor forward is the offset of the next window')
    assert.equal(hasNext(window.nextCursor), true)
    assert.equal(hasPrevious(firstPage), false)
    assert.equal(pageNumber(firstPage), 1)
  })

  test('next advances one window and back returns to the one before it', () => {
    const { firstPage, nextPage, pageNumber, previousPage } = logic.cursor
    const { windowOf } = logic.view

    const second = nextPage(firstPage, windowOf(106, firstPage.cursor, size).nextCursor)
    assert.equal(second.cursor, '25')
    assert.equal(pageNumber(second), 2)
    assert.deepEqual([windowOf(106, second.cursor, size).start, windowOf(106, second.cursor, size).end], [25, 50])

    const third = nextPage(second, windowOf(106, second.cursor, size).nextCursor)
    assert.equal(pageNumber(third), 3)
    assert.equal(windowOf(106, third.cursor, size).start, 50)

    const back = previousPage(third)
    assert.equal(back.cursor, '25', 'previous is remembered, because a keyset list has no cursor for it')
    assert.equal(pageNumber(back), 2)
    assert.deepEqual(previousPage(previousPage(back)), firstPage)
  })

  test('the last page reports no cursor forward and refuses to advance', () => {
    const { firstPage, hasNext, nextPage } = logic.cursor
    const { windowOf } = logic.view

    // 60 rows, 25 to a window: the third window is the short one.
    const last = { cursor: '50', seen: [firstPage.cursor, '25'] }
    const window = windowOf(60, last.cursor, size)
    assert.deepEqual({ start: window.start, end: window.end }, { start: 50, end: 60 })
    assert.equal(window.nextCursor, null, 'a window that reaches the end names no window after it')
    assert.equal(hasNext(window.nextCursor), false)
    assert.equal(nextPage(last, window.nextCursor), last, 'no cursor forward is not a page forward')
  })

  test('a failed request mid-sequence loses neither the position nor the way back', () => {
    const { hasPrevious, nextPage, pageNumber, previousPage } = logic.cursor

    // The operator is three windows in when a refetch fails. The rows are gone,
    // so there is no `next_cursor` and no row count to derive one from.
    const third = { cursor: '50', seen: [null, '25'] }
    assert.equal(nextPage(third, undefined), third, 'a failed response must not advance the walk')
    assert.equal(nextPage(third, null), third)
    assert.equal(pageNumber(third), 3, 'the position survives the failure, so Retry lands where it left off')
    assert.equal(hasPrevious(third), true)
    assert.equal(previousPage(third).cursor, '25', 'back still works while the error is on screen')
  })

  test('a walk the result can no longer support is forgotten rather than mislabelled', () => {
    const { firstPage } = logic.cursor
    const { clampPage, windowOf } = logic.view
    const third = { cursor: '50', seen: [null, '25'] }

    assert.equal(clampPage(third, 106, size), third, 'a cursor the result can honour is kept, by identity')

    // A narrower filter — or a failed request — leaves four rows. windowOf clamps
    // to the start of the list, and `seen` would still print "Page 3" over rows
    // 1–4 if the page state were not reset with it.
    assert.equal(windowOf(4, third.cursor, size).start, 0)
    assert.deepEqual(clampPage(third, 4, size), firstPage)
    assert.deepEqual(clampPage(third, 0, size), firstPage, 'an emptied result has only a first page')
  })

  test('a cursor that was not minted by this module never addresses a wrong window', () => {
    const { windowOf } = logic.view
    assert.equal(windowOf(106, 'abc', size).start, 0, 'unparseable')
    assert.equal(windowOf(106, '-5', size).start, 0, 'negative')
    assert.equal(windowOf(106, '2.5', size).start, 0, 'not a row boundary at all')
    assert.equal(windowOf(106, '500', size).start, 0, 'beyond the end of the list')
    assert.equal(windowOf(106, '37', size).start, 25, 'a hand-edited offset snaps to a window boundary')
    assert.equal(windowOf(Number.NaN, '25', size).start, 0)
  })
})

describe('which columns are on screen', behavioural, () => {
  test('the default view is every column that is not hidden by default', () => {
    assert.deepEqual(logic.view.defaultVisible(CONTENT_COLUMNS), DEFAULT_VISIBLE)
    assert.ok(!DEFAULT_VISIBLE.includes('created'), 'Created is the endpoint’s own order, off until asked for')
  })

  test('a URL names the visible set, and a required column is added back whatever it says', () => {
    assert.deepEqual(logic.view.decodeVisible(CONTENT_COLUMNS, 'kind,created'), ['title', 'kind', 'created', 'actions'])
    assert.deepEqual(
      logic.view.decodeVisible(CONTENT_COLUMNS, 'created , kind'),
      ['title', 'kind', 'created', 'actions'],
      'the table’s column order wins over the order in the parameter, and whitespace is not an id',
    )
  })

  test('a stale or hand-edited parameter opens the default view, never an empty table', () => {
    for (const param of [undefined, null, '', '   ', ',,', 'nonesuch', 'a,b,c']) {
      assert.deepEqual(
        logic.view.decodeVisible(CONTENT_COLUMNS, param),
        DEFAULT_VISIBLE,
        `${JSON.stringify(param)} names no column this version has`,
      )
    }
    assert.deepEqual(
      logic.view.decodeVisible(CONTENT_COLUMNS, 'kind,nonesuch'),
      ['title', 'kind', 'actions'],
      'an id a later version added is dropped; the ones this version knows still apply',
    )
  })

  test('the URL carries a column choice only when it is one', () => {
    assert.equal(logic.view.encodeVisible(CONTENT_COLUMNS, DEFAULT_VISIBLE), undefined)
    assert.equal(
      logic.view.encodeVisible(CONTENT_COLUMNS, ['kind', 'created']),
      'title,kind,created,actions',
      'what is encoded is what will be seen, required columns included',
    )
    const chosen = ['title', 'kind', 'actions']
    assert.deepEqual(
      logic.view.decodeVisible(CONTENT_COLUMNS, logic.view.encodeVisible(CONTENT_COLUMNS, chosen)),
      chosen,
      'a round trip through the URL is the identity',
    )
  })

  test('a column goes away and comes back in the table’s own order', () => {
    const without = logic.view.toggleVisible(CONTENT_COLUMNS, DEFAULT_VISIBLE, 'slug')
    assert.deepEqual(without, ['title', 'kind', 'locale', 'live', 'updated', 'actions'])
    assert.deepEqual(logic.view.toggleVisible(CONTENT_COLUMNS, without, 'slug'), DEFAULT_VISIBLE)
    assert.deepEqual(logic.view.toggleVisible(CONTENT_COLUMNS, DEFAULT_VISIBLE, 'created'), [
      'title',
      'kind',
      'locale',
      'slug',
      'live',
      'updated',
      'created',
      'actions',
    ])
  })

  test('the column that names the row and the one that opens it cannot be put away', () => {
    for (const id of ['title', 'actions']) {
      assert.deepEqual(
        logic.view.toggleVisible(CONTENT_COLUMNS, DEFAULT_VISIBLE, id),
        DEFAULT_VISIBLE,
        `${id} is required: hiding it leaves a row nobody can identify or open`,
      )
    }
    assert.deepEqual(logic.view.toggleVisible(CONTENT_COLUMNS, DEFAULT_VISIBLE, 'nonesuch'), DEFAULT_VISIBLE)
  })

  test('the last visible column cannot be hidden even where none is required', () => {
    const optional = [{ id: 'a' }, { id: 'b' }]
    const one = logic.view.toggleVisible(optional, ['a', 'b'], 'b')
    assert.deepEqual(one, ['a'])
    assert.deepEqual(
      logic.view.toggleVisible(optional, one, 'a'),
      ['a'],
      'a table of no columns cannot say whether it is empty, loading or broken',
    )
  })

  test('the module exports the four moves a column chooser needs', () => {
    for (const name of ['decodeVisible', 'defaultVisible', 'encodeVisible', 'toggleVisible'])
      assert.equal(typeof logic.view[name], 'function', name)
  })
})

describe('how far a sort would actually reach', behavioural, () => {
  const reach = (id, paging) =>
    logic.view.sortReach(
      CONTENT_COLUMNS.find((column) => column.id === id),
      paging,
    )

  test('a comparator plus a response that holds every row is a complete sort', () => {
    assert.equal(reach('title', 'whole'), 'complete')
    assert.equal(logic.view.isOfferable('complete'), true)
  })

  test('the same comparator over a cursor-paged endpoint reaches one page, and is refused', () => {
    assert.equal(reach('title', 'cursor'), 'page')
    assert.equal(logic.view.isOfferable('page'), false, 'a sort that covers one page of many is a lie')
    assert.equal(reach('updated', 'cursor'), 'page')
  })

  test('a column the endpoint orders itself reaches the whole result however the rows arrive', () => {
    const served = { id: 'updated', server: true }
    assert.equal(logic.view.sortReach(served, 'cursor'), 'server')
    assert.equal(logic.view.sortReach(served, 'whole'), 'server')
    assert.equal(logic.view.isOfferable('server'), true)
    assert.equal(
      logic.view.sortReach({ id: 'updated', server: true }, 'cursor'),
      'server',
      'the endpoint needs no client comparator to order what it orders',
    )
  })

  test('a column with no order, and a column that does not exist, offer nothing', () => {
    assert.equal(reach('live', 'whole'), 'none', 'published-plus-newer-draft is two facts, not a direction')
    assert.equal(reach('actions', 'whole'), 'none')
    assert.equal(reach('nonesuch', 'whole'), 'none')
    assert.equal(logic.view.isOfferable('none'), false)
  })

  test('a sort in a URL is honoured only where it could be offered', () => {
    const { decodeSort } = logic.view
    assert.deepEqual(decodeSort(CONTENT_COLUMNS, 'whole', 'updated:desc'), { column: 'updated', direction: 'desc' })
    assert.equal(decodeSort(CONTENT_COLUMNS, 'cursor', 'updated:desc'), null, 'the same link over a paged endpoint')
    assert.equal(decodeSort(CONTENT_COLUMNS, 'whole', 'live:asc'), null, 'a column with no order')
    assert.equal(decodeSort(CONTENT_COLUMNS, 'whole', 'nonesuch:asc'), null)
    assert.equal(decodeSort(CONTENT_COLUMNS, 'whole', 'updated'), null, 'no direction')
    assert.equal(decodeSort(CONTENT_COLUMNS, 'whole', 'updated:sideways'), null)
    assert.equal(decodeSort(CONTENT_COLUMNS, 'whole', undefined), null)
    assert.equal(logic.view.encodeSort({ column: 'title', direction: 'asc' }), 'title:asc')
    assert.equal(logic.view.encodeSort(null), undefined, 'no sort is an absent parameter, not an empty one')
  })

  test('three clicks on a header: one way, the other way, and the endpoint’s own order back', () => {
    const { nextSort } = logic.view
    const first = nextSort(CONTENT_COLUMNS, 'whole', null, 'title')
    assert.deepEqual(first, { column: 'title', direction: 'asc' })
    const second = nextSort(CONTENT_COLUMNS, 'whole', first, 'title')
    assert.deepEqual(second, { column: 'title', direction: 'desc' })
    assert.equal(
      nextSort(CONTENT_COLUMNS, 'whole', second, 'title'),
      null,
      'the endpoint’s own order is a real state and nothing else reaches it',
    )
  })

  test('a date column starts newest first', () => {
    const { nextSort } = logic.view
    const first = nextSort(CONTENT_COLUMNS, 'whole', null, 'updated')
    assert.deepEqual(first, { column: 'updated', direction: 'desc' }, 'nobody asks a list of edits for the oldest')
    assert.deepEqual(nextSort(CONTENT_COLUMNS, 'whole', first, 'updated'), { column: 'updated', direction: 'asc' })
    assert.equal(nextSort(CONTENT_COLUMNS, 'whole', { column: 'updated', direction: 'asc' }, 'updated'), null)
  })

  test('moving to another column starts that column over rather than carrying a direction', () => {
    const { nextSort } = logic.view
    const onTitle = { column: 'title', direction: 'desc' }
    assert.deepEqual(nextSort(CONTENT_COLUMNS, 'whole', onTitle, 'kind'), { column: 'kind', direction: 'asc' })
    assert.deepEqual(nextSort(CONTENT_COLUMNS, 'whole', onTitle, 'updated'), { column: 'updated', direction: 'desc' })
  })

  test('a click on a column that offers nothing changes nothing', () => {
    const { nextSort } = logic.view
    const current = { column: 'title', direction: 'asc' }
    assert.equal(nextSort(CONTENT_COLUMNS, 'whole', current, 'live'), current)
    assert.equal(nextSort(CONTENT_COLUMNS, 'whole', null, 'actions'), null)
    assert.equal(nextSort(CONTENT_COLUMNS, 'cursor', current, 'title'), current, 'not over a paged endpoint either')
  })

  test('hiding the sorted column drops the sort instead of ordering by something off screen', () => {
    const { reconcileSort } = logic.view
    const sort = { column: 'updated', direction: 'desc' }
    assert.equal(reconcileSort(CONTENT_COLUMNS, 'whole', DEFAULT_VISIBLE, sort), sort)
    const withoutUpdated = DEFAULT_VISIBLE.filter((id) => id !== 'updated')
    assert.equal(reconcileSort(CONTENT_COLUMNS, 'whole', withoutUpdated, sort), null)
    assert.equal(reconcileSort(CONTENT_COLUMNS, 'cursor', DEFAULT_VISIBLE, sort), null, 'nor a reach it lost')
    assert.equal(reconcileSort(CONTENT_COLUMNS, 'whole', DEFAULT_VISIBLE, null), null)
  })

  test('comparators put missing values somewhere predictable and never answer NaN', () => {
    const { compareText, compareTime } = logic.view
    assert.ok(compareText('a', 'b') < 0)
    assert.ok(compareText(null, 'b') < 0, 'a missing slug is the empty string: first ascending, last descending')
    assert.equal(compareText(undefined, null), 0)
    assert.ok(compareTime('2026-07-30T10:00:00Z', '2026-07-29T10:00:00Z') > 0)
    assert.ok(compareTime(null, '2026-07-29T10:00:00Z') < 0, 'an absent instant is the oldest, never the newest')
    assert.equal(compareTime(null, undefined), 0, 'two absent instants are equal — NaN would leave sort() undefined')
    assert.equal(compareTime('not a date', 'also not'), 0)
  })
})

describe('the data table is the shared Table, with three things added', () => {
  test('it renders the shared table rather than a second one', () => {
    // The hand-rolled `components/ui/primitives.tsx` is gone; its Table/THead/
    // TBody/TR/TH/TD are shadcn's Table parts and its TableState moved to
    // forms/table-state.tsx. What this test guards is unchanged: the console has
    // one table implementation and this file is not a second one.
    assert.match(dataTable, /from '\.\/table'/, 'the table parts come from ui/table.tsx')
    assert.match(dataTable, /from '@\/forms\/table-state'/, 'and the four states from the single TableState')
    for (const part of ['Table', 'TableHeader', 'TableBody', 'TableRow', 'TableHead', 'TableCell', 'TableState'])
      assert.match(dataTable, new RegExp(`\\b${part}\\b`), `${part} is used, not replaced`)
    assert.doesNotMatch(dataTable, /<table|<thead|<tbody|<tr\b|<th\b|<td\b/, 'no raw table markup of its own')
  })

  test('the four states are still four, and loading is a skeleton rather than a word', () => {
    assert.match(dataTable, /isLoading \? \(\s*<SkeletonRows/, 'loading holds the layout at row height')
    assert.match(dataTable, /error=\{error\}/)
    assert.match(dataTable, /isEmpty=\{visibleRows\.length === 0\}/)
    assert.match(dataTable, /emptyMessage=\{emptyMessage\}/)
    assert.match(dataTable, /onRetry=\{onRetry\}/, 'a failed request offers the retry an empty one must not')
    assert.doesNotMatch(dataTableCode, /Loading…/, 'the placeholder is a shape; TableState owns no loading branch here')
    // Empty and failed must not share a branch: TableState is the single place
    // that distinguishes them, so the table must not answer either question itself.
    assert.doesNotMatch(dataTableCode, /Nothing here|No rows|Request failed/)
  })

  test('every control the table adds is addressable', () => {
    for (const testId of [
      '`${testId}-sort-${column.id}`',
      '`${testId}-columns`',
      '`${testId}-columns-toggle`',
      '`${testId}-columns-option-${column.id}`',
      '`${testId}-columns-checkbox-${column.id}`',
      '`${testId}-columns-reset`',
      '`${testId}-pagination`',
      '`${testId}-skeleton`',
      '`${testId}-table`',
    ])
      assert.ok(dataTable.includes(`data-testid={${testId}}`), `${testId} must be a data-testid`)
  })

  test('a header that can be clicked says so to something other than a mouse', () => {
    assert.match(dataTable, /aria-sort=/, 'the sorted column and its direction are in the accessibility tree')
    assert.match(dataTable, /'ascending'/)
    assert.match(dataTable, /'descending'/)
    assert.match(dataTable, /'none'/, 'an offerable column that is not sorted is aria-sort=none, not absent')
  })

  test('a sort control exists only where the sort would cover the whole result', () => {
    assert.match(
      dataTable,
      /isOfferable\(reach\) \? \(\s*<button/,
      'the header renders a control only for an offerable reach',
    )
    assert.match(dataTable, /aria-sort=\{\s*!isOfferable\(reach\)/, 'and claims no order for the others')
  })

  test('a page of a cursor-paged result keeps the order the endpoint sent it in', () => {
    // Without the `paging` half of this guard the first cursor-paged caller gets a
    // header arrow that reorders the twenty-five rows it happens to hold, on top of
    // the server's own order — the exact lie `sortReach` refuses to offer a control
    // for. `content.tsx` is 'whole' today, so nothing on screen would show it.
    assert.match(
      ordering,
      /if \(paging !== 'whole'[^)]*\) return rows/,
      'the client-side sort applies to a whole result only; a cursor page is handed on untouched',
    )
    assert.doesNotMatch(
      ordering,
      /if \(!sort\) return rows\s*$/m,
      'a guard on the sort alone would re-sort one page of many',
    )
  })

  test('sorting copies the array, because the array belongs to the query cache', () => {
    // `rows` is `items.data` straight from React Query, and content.tsx hands the
    // same array to the detail view as `allItems` to derive sibling slugs and
    // locales. `Array.prototype.sort` reorders in place, so sorting `rows` itself
    // would silently reorder what a second consumer is reading.
    assert.match(ordering, /const sorted = \[\.\.\.rows\]/, 'the sort runs over a copy of the rows')
    assert.doesNotMatch(ordering, /const sorted = rows\b/, 'aliasing the cache’s array is not copying it')
    assert.doesNotMatch(ordering, /\brows\.sort\(/, 'and nothing sorts the cached array in place')
    assert.match(ordering, /sorted\.sort\(/, 'the copy is what gets sorted')
  })

  test('the page number and the rows under it cannot disagree', () => {
    // windowOf clamps a cursor the result can no longer honour to row 0, while
    // `seen` still counts the walk: dropping clampPage puts "Page 3" over rows 1–25.
    assert.match(
      ordering,
      /const position = paging === 'whole' \? clampPage\(page, ordered\.length, pageSize\) : page/,
      'a whole result clamps the walk to what it can still address',
    )
    assert.match(
      ordering,
      /windowOf\(ordered\.length, position\.cursor, pageSize\)/,
      'and the window is taken from the clamped position, not the raw one',
    )
    assert.match(dataTable, /page=\{position\}/, 'so is the position the pager prints')
  })

  test('a total is printed only where the endpoint supplied every row', () => {
    assert.match(
      dataTable,
      /paging === 'whole'[\s\S]*?t\('pagination\.totalUnit', \{ total: ordered\.length, unit: unitLabel \}\)[\s\S]*?: unitLabel/,
      'a cursor-paged list has no total, so it is not given one',
    )
  })

  test('the pagination and skeleton primitives are reused, not reimplemented', () => {
    assert.match(dataTable, /import \{ Pagination \} from '\.\/pagination'/)
    assert.match(dataTable, /import \{ SkeletonRows \} from '\.\/skeleton'/)
    assert.match(dataTable, /import \{ Checkbox \} from '\.\/checkbox'/)
    assert.match(dataTable, /from '@\/lib\/cursor'/, 'the window runs the existing cursor reducer')
  })

  test('nothing new was installed for any of it', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'apps', 'cockpit', 'package.json'), 'utf8'))
    const dependencies = new Set(Object.keys(manifest.dependencies ?? {}))
    for (const [name, text] of [
      ['data-table.tsx', dataTable],
      ['content.tsx', contentPage],
      ['lib/table-view.ts', source('lib', 'table-view.ts')],
    ]) {
      for (const [, imported] of text.matchAll(/from '([^']+)'/g)) {
        if (imported.startsWith('@/') || imported.startsWith('.')) continue
        assert.ok(dependencies.has(imported), `${name} imports "${imported}", which is not a Cockpit dependency`)
      }
    }
  })

  test('the view travels in the URL, with the last choice as the opening guess', () => {
    assert.match(dataTable, /useSearch\(\{ strict: false \}\)/, 'read the way SiteProvider reads ?site=')
    assert.match(dataTable, /to: '\.'/, "rewrite the current route's search rather than navigating away")
    assert.match(dataTable, /\$\{listId\}\.cols/, 'parameters are per list, so two lists cannot read each other’s ids')
    assert.match(dataTable, /\$\{listId\}\.sort/)
    assert.match(dataTable, /localStorage/, 'the console’s own links carry only ?site=, so the choice is remembered')
    assert.match(
      dataTable,
      /replace: true|write\(\{ visible, sort \}, true\)/,
      'adopting a guess must not push history',
    )
  })
})

describe('the content list claims only what the API can do', () => {
  const operation = openapi.paths['/v1/sites/{site}/content'].get
  const parameters = (operation.parameters ?? []).map((parameter) => parameter.name)

  test('the authoring list endpoint pages nothing and orders nothing', () => {
    assert.equal(operation.operationId, 'contentList')
    assert.deepEqual(
      parameters.filter((name) => name !== 'site').sort(),
      ['kind', 'locale'],
      'kind and locale are the whole query: no limit, no cursor, no order',
    )
    assert.equal(operation.responses['200'].content['application/json'].schema.type, 'array')
  })

  test('so the page windows a whole result, and would have to stop if that changed', () => {
    const paged = parameters.includes('cursor') || parameters.includes('limit')
    if (paged)
      assert.match(
        contentPage,
        /paging="cursor"/,
        'the endpoint now pages: the table must be told, which withdraws every client-side sort',
      )
    else
      assert.doesNotMatch(
        contentPageCode,
        /^\s*paging=/m,
        'the endpoint answers whole, which is the DataTable default and the reason the sorts are honest',
      )
    assert.match(
      dataTableCode,
      /paging(\?: Paging)? = 'whole'/,
      'and "whole" is what the default means, so the page not passing it is the page claiming it',
    )
  })

  test('no column claims the endpoint can order it', () => {
    assert.doesNotMatch(
      contentPage,
      /server: true/,
      'contentList takes no order parameter, so nothing in this list is server-sortable',
    )
  })

  test('the sortable columns are the ones with a comparator, and Live is not among them', () => {
    const live = contentPage.slice(contentPage.indexOf("id: 'live'"), contentPage.indexOf("id: 'updated'"))
    assert.ok(live.includes("id: 'live'"), 'the Live column is still there')
    assert.doesNotMatch(live, /compare:/, 'two independent facts in one cell have no direction')
    for (const [id, next] of [
      ['title', 'kind'],
      ['updated', 'created'],
    ]) {
      const column = contentPage.slice(contentPage.indexOf(`id: '${id}'`), contentPage.indexOf(`id: '${next}'`))
      assert.match(column, /compare: \(left, right\)/, `${id} is ordered by a comparator over every row`)
    }
    assert.match(contentPage, /id: 'created',[\s\S]*?hiddenByDefault: true/, 'the endpoint’s own order is available')
  })

  test('Updated reads as a sentence and keeps the instant', () => {
    assert.match(contentPage, /<RelativeTime value=\{item\.updated_at\}/, '"29.7.2026, 21:43:19" is not a glance')
    assert.doesNotMatch(contentPage, /formatDate/, 'no cell renders a bare locale timestamp any more')
    // RelativeTime is the only reason the precision survives, so this file may
    // not use it without that guarantee holding in the component itself.
    const relative = source('components', 'ui', 'relative-time.tsx')
    assert.match(relative, /dateTime=\{iso\}/, 'the exact instant stays in <time datetime>')
    // The claim is unchanged — the precision survives the rounding — but the
    // channel is not. This used to demand `title={formatExact(…)}`, which serves
    // a pointer and nobody else, and it contradicted the console-wide rule in
    // cockpit-forms-density.test.mjs that no DOM element carries a native title.
    // A Tooltip keeps the instant reachable by hover, focus and tap alike.
    assert.match(
      relative,
      /const exact = formatExact\(value,\s*LOCALE_TAGS\[locale\]\)/,
      'the exact instant is still computed in the selected locale',
    )
    assert.match(relative, /<TooltipContent[^>]*>\{exact\}<\/TooltipContent>/, 'and shown in a disclosure')
    assert.doesNotMatch(relative, /\btitle=/, 'never in a native tooltip — a pointer is not everyone')
  })

  test('the editor no longer renders the word "Loading…"', () => {
    assert.doesNotMatch(contentPageCode, /Loading…</, 'the production screenshot showed it as body text')
    assert.doesNotMatch(contentPageCode, />\s*Loading…/)
    assert.match(contentPage, /<SkeletonFields fields=\{6\}/, 'a form-shaped placeholder holds the layout still')
    assert.match(contentPage, /<SkeletonText lines=\{8\}/, 'and a prose-shaped one for the published document')
  })

  test('the detail view still sees every item, not the window on screen', () => {
    assert.match(
      contentPage,
      /allItems=\{items\.data \?\? \[\]\}/,
      'sibling slugs and locales are derived from the whole workspace',
    )
  })

  test('the list state resets when the result it addresses changes', () => {
    // The rule, not the list: a cursor names a position in one particular result,
    // so everything that makes it a different result has to be in this array. The
    // previous version of this test quoted the array verbatim, which pinned the
    // site's absence from it as if it were the intent.
    const effect = /useEffect\(\(\) => setPage\(firstPage\), \[([^\]]*)\]\)/.exec(contentPageCode)
    assert.ok(effect, 'the page walk is reset by an effect over what names the result')
    const deps = effect[1]
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    for (const [dep, why] of [
      ['site', 'another site is another list, and the switcher only rewrites ?site= — the page does not remount'],
      ['kind', 'a narrower filter has fewer windows than the walk has steps'],
      ['locale', 'the same'],
      ['order', 'a reordered result puts different rows at the position the cursor names'],
    ])
      assert.ok(deps.includes(dep), `${dep} must reset the walk: ${why} (dependencies: ${deps.join(', ')})`)
    assert.match(
      contentPageCode,
      /const order = encodeSort\(view\.sort\)/,
      'and the sort dependency is its encoding, or a new object every render would reset the walk after every Next',
    )
  })
})

/**
 * What a list may print about numbers nobody sent it.
 *
 * Two of these were shipped as a fallback that draws absence as zero: the order
 * note counted `ordered.length` beside the skeleton and beside a failed request,
 * and the audio summary printed "0 characters used this month" for a month the
 * response carried no count for — the reading an operator most needs to tell from a
 * quiet month, and the exact case lib/audio-budget.ts answers `null` for.
 *
 * Everything here evaluates the page's own expression. A fallback that is merely
 * absent from the source passes a regex; a fallback that answers the wrong number
 * does not pass these.
 */
describe('a value nobody sent is not drawn as zero', () => {
  // ── The order note, over a list the endpoint answers whole ─────────────────

  const noteGate = (state) => evaluate(rightHandSide(dataTableCode, 'describable'), state)
  const someRows = [{ id: 'a' }, { id: 'b' }]

  test('the note is printed only where rows are on screen for it to describe', () => {
    assert.ok(rightHandSide(dataTableCode, 'describable'), 'the guard is a `const describable` in data-table.tsx')
    assert.equal(
      noteGate({ isLoading: true, error: null, visibleRows: [] }),
      false,
      'a sorted link opened cold renders the skeleton, and `sort` is already set from the URL',
    )
    assert.equal(
      noteGate({ isLoading: true, error: null, visibleRows: someRows }),
      false,
      'nor while a page is in flight over rows the cache still holds',
    )
    assert.equal(
      noteGate({ isLoading: false, error: new Error('offline'), visibleRows: someRows }),
      false,
      'TableState renders the error ahead of the rows, so a non-empty array is still no rows on screen',
    )
    assert.equal(
      noteGate({ isLoading: false, error: null, visibleRows: [] }),
      false,
      'and an empty result has nothing to order',
    )
    assert.equal(noteGate({ isLoading: false, error: null, visibleRows: someRows }), true, 'rows, and only then')
  })

  test('that guard is what gates the note, and the total in it is the response’s own', () => {
    const gate = /\{([^?{}]*)\?\s*\(\s*<span data-testid=\{`\$\{testId\}-order-note`\}/.exec(dataTableCode)
    assert.ok(gate, 'the note is a conditional over one condition, so the condition can be pointed at')
    assert.match(
      gate[1],
      /^\s*describable && /,
      'the note is gated by the guard evaluated above, not by a second condition beside it',
    )
    assert.match(
      dataTableCode.slice(dataTableCode.indexOf('-order-note')),
      /count:\s*ordered\.length,\s*unit/,
      'the count is the rows the response supplied — the same array the pager takes its total from',
    )
  })

  test('the pager beside it still guards itself, so neither prints a total alone', () => {
    // `Pagination` returns null when there is nothing to page, which is why the
    // finding was the note and not the pager. If that guard moves, the note's guard
    // is not enough on its own.
    const pagination = source('components', 'ui', 'pagination.tsx')
    assert.match(pagination, /if \(!back && !forward\) return null/, 'a list that fits on one page has no pager')
  })

  // ── The audio summary, above the jobs list ─────────────────────────────────

  const reportedCount = functionOf(authoringCode, 'reportedCount')

  test('a count the response did not carry is null, and a zero it did carry is zero', () => {
    assert.equal(typeof reportedCount, 'function', 'reportedCount is a plain function of one value')
    assert.equal(reportedCount(undefined), null, 'a key the response omitted — the status counters are optional')
    assert.equal(reportedCount(null), null)
    assert.equal(reportedCount(Number.NaN), null, 'and nothing derived from a missing number either')
    assert.equal(reportedCount(0), 0, 'a reported zero is a measurement and stays one')
    assert.equal(reportedCount(12_000), 12_000)
  })

  /**
   * The binding, not the function.
   *
   * Evaluating `reportedCount` proves the rule; it does not prove the page uses it.
   * `usedChars = summary?.chars_this_month ?? 0` is one character outside every
   * expression the tests above slice, and it is exactly how "0 characters used this
   * month" was reintroduced for a figure the server never sent — with the whole suite
   * green. This is a text assertion and cannot be more: nothing here renders the page.
   * It is written down as the weaker check it is, next to the stronger one it guards.
   */
  test('every count the page prints is routed through it, with no numeric fallback', () => {
    for (const binding of ['usedChars', 'budgetChars']) {
      const right = rightHandSide(authoringCode, binding)
      assert.match(right, /reportedCount\(/, `${binding} must go through reportedCount`)
      assert.doesNotMatch(right, /(?:\?\?|\|\|)\s*-?\d/, `${binding} must not answer a missing count with a number`)
    }
    // And no count reaches a reader by another route: a bare `?? 0` anywhere in the
    // page is the shape being banned, whatever it is bound to.
    const fallbacks = [...authoringCode.matchAll(/summary(?:\?)?\.\w+\s*(?:\?\?|\|\|)\s*-?\d/g)].map((hit) => hit[0])
    assert.deepEqual(fallbacks, [], `the page answers a missing count with a number: ${fallbacks.join(', ')}`)
  })

  test('the unmeasured line prints the count it was sent, and says so when it was sent none', () => {
    const used = rightHandSide(authoringCode, 'usedThisMonth')
    assert.match(used, /usedChars === null/)
    assert.match(used, /t\('audio\.usedNotReported'\)/, 'an absent numerator is named, not printed as zero')
    assert.match(
      used,
      /t\('audio\.usedThisMonth', \{ count: number\(usedChars\) \}\)/,
      'a reported numerator is locale-formatted before translation',
    )
    const lineStart = authoringCode.indexOf('data-testid="audio-budget-unmeasured"')
    assert.ok(lineStart > 0, 'the unmeasured audio budget line exists')
    const line = authoringCode.slice(lineStart, authoringCode.indexOf('</span>', lineStart))
    assert.match(line, /\{usedThisMonth\}/)
    assert.match(line, /budgetChars === null[\s\S]*t\('audio\.noBudget'\)/)
    assert.match(line, /t\('audio\.budgetConfigured', \{ count: number\(budgetChars\) \}\)/)
    assert.doesNotMatch(line, /(?:\?\?|\|\|)\s*0/, 'neither missing value is defaulted to a measured zero')
  })

  test('a per-status counter the response omitted is an em dash rather than a status with no jobs', () => {
    const counter = renderedText(authoringCode, 'data-testid={`audio-count-')
    assert.ok(counter, 'the counter renders one expression per status')
    assert.match(counter, /t\(STATUS_KEYS\[name\]\)/, 'the status name comes from the shared catalogue')
    assert.match(counter, /reportedCount\(summary\[name\]\) === null \? '—'/)
    assert.match(
      counter,
      /number\(reportedCount\(summary\[name\]\)!\)/,
      'a reported zero or count is locale-formatted without changing its value',
    )
  })

  // ── The readiness tiles, which are counts with no list under them ──────────

  test('an unanswered /ready draws no counts and claims nothing is running', () => {
    const reading = (name, readiness) => evaluate(rightHandSide(authoringCode, name), { readiness, reportedCount })
    for (const name of ['inflight', 'deckInflight', 'deckQueued']) {
      assert.equal(reading(name, undefined), null, `${name} has no value before /ready answers, and 503 is an answer`)
      assert.equal(reading(name, {}), null, `${name} is optional in ReadinessReport, or absent from an older server`)
    }
    assert.equal(reading('deckQueued', { deck_queued: 0 }), 0)

    const opens = authoringCode.indexOf('testId="system-decks"')
    const tile = authoringCode.slice(opens, authoringCode.indexOf('/>', opens))
    const attribute = (name) => braceGroup(tile, tile.indexOf(`${name}=`))
    assert.ok(tile.includes("label={t('system.deckRenders')}"), 'the translated tile was found whole')
    const t = (key, values = {}) => {
      if (key === 'system.running') return `${values.count} running`
      if (key === 'system.queued') return `${values.count} queued`
      return key
    }
    const number = (value) => String(value)
    const scope = { deckInflight: null, deckQueued: null, t, number }
    assert.equal(evaluate(attribute('value'), scope), '— running', 'no reading, no number')
    assert.equal(evaluate(attribute('detail'), scope), '— queued')
    assert.equal(
      evaluate(attribute('tone'), scope),
      'warning',
      'green is a claim as well: a queue nobody reported is not a queue known to be empty',
    )
    assert.equal(
      evaluate(attribute('tone'), { deckInflight: 0, deckQueued: 0, t, number }),
      'success',
      'a reported zero is fine',
    )
    assert.equal(evaluate(attribute('tone'), { deckInflight: 2, deckQueued: 3, t, number }), 'warning')
    assert.equal(evaluate(attribute('value'), { deckInflight: 2, deckQueued: 3, t, number }), '2 running')
  })
})

/**
 * What the shadcn migration moved, and what it must not have dropped on the way.
 *
 * Three of these guard a contract that used to be enforced by hand-written code
 * and is now a prop on somebody else's component — which is exactly the kind of
 * rule that disappears silently. The toast one is the sharpest: the old
 * `DISMISS_AFTER` map spelled `null` for "never expires" in a file that also
 * contained the loop honouring it, so the rule was visible next to its
 * implementation. sonner's default duration is finite for every method, so the
 * same rule is now a `duration` this file has to insist on. Drop it and every 422
 * that names a field the form does not render vanishes after four seconds — the
 * only evidence the operator gets that a save did nothing.
 */
describe('the components the console stopped hand-rolling', () => {
  const toast = source('components', 'ui', 'toast.tsx')
  const chip = source('components', 'ui', 'chip.tsx')
  const segmented = source('components', 'ui', 'segmented.tsx')
  // Seventeen now rather than eight: `authoring.tsx` was five of these pages in
  // one file and `governance.tsx` was five more, and the rules below are per
  // page, so splitting them widened the scope rather than narrowing it. This is
  // the whole of pages/, and it is meant to stay that way.
  const pages = [
    'overview',
    'sites',
    'site-settings',
    'content',
    'releases',
    'published',
    'compositions',
    'decks',
    'audio',
    'system',
    'assistant',
    'access',
    'webhooks',
    'moderation',
    'credentials',
    'decisions',
    'audit',
    'profile',
  ]

  test('the list above is every page, so a new one cannot arrive unruled', () => {
    // The list used to be written out and then quietly fall behind: it named
    // `authoring` and `governance` — one entry each for ten routed pages — so
    // the two rules below graded a tenth of what they claimed to. Derived from
    // the directory, the next page to be added is either in it or this fails.
    const found = readdirSync(join(cockpit, 'pages'))
      .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
      .map((name) => name.replace(/\.tsx$/, ''))
      .sort()
    assert.deepEqual([...pages].sort(), found, 'every module in src/pages must be graded by the rules below')
  })

  test('an error and a warning still outlive the four seconds a confirmation gets', () => {
    // The map is read as data rather than matched as text: a regex for
    // `Infinity` would also pass for `info: Infinity`, which is the opposite rule.
    // `braceGroup`, not `rightHandSide`, because the declaration carries a type
    // annotation — `const DURATION: Record<ToastTone, number> = {`.
    const toastCode = code(toast)
    const durations = evaluate(`{${braceGroup(toastCode, toastCode.indexOf('const DURATION'))}}`, {})
    assert.equal(durations.danger, Number.POSITIVE_INFINITY, 'a failed save must stay on screen until it is dismissed')
    assert.equal(durations.warning, Number.POSITIVE_INFINITY)
    assert.ok(Number.isFinite(durations.info), 'and a confirmation must not, or the corner fills with stale news')
    assert.ok(Number.isFinite(durations.success))
    // An eternal toast with no close control is an unremovable one.
    assert.match(toast, /closeButton/, 'the two tones that never expire need a way out')
  })

  test('every tone reaches sonner, so no severity is quietly downgraded', () => {
    const emit = code(toast).slice(code(toast).indexOf('const EMIT'))
    for (const [tone, method] of [
      ['info', 'info'],
      ['success', 'success'],
      ['warning', 'warning'],
      ['danger', 'error'],
    ])
      assert.match(
        emit,
        new RegExp(`${tone}: \\(title, options\\) => sonner\\.${method}\\(`),
        `${tone} must arrive as sonner.${method} — mapping it to anything milder loses the severity`,
      )
  })

  test('the toaster follows the console’s own theme, not next-themes', () => {
    // ui/sonner.tsx reads next-themes, which lib/theme.ts exists instead of. It
    // spreads props last, so passing `theme` is what overrides it; without this a
    // manual light choice under a dark OS leaves the toasts dark.
    assert.match(toast, /from '@\/lib\/theme'/, 'the theme comes from the store that owns the .dark class')
    assert.match(toast, /theme=\{resolved\}/, 'and it is passed to the Toaster, or next-themes wins')
    // The code, not the prose: this file names next-themes to say it is not used.
    assert.doesNotMatch(code(toast), /next-themes/, 'this file must not reach for it either')
  })

  test('the hand-rolled stack is gone, not merely unused', () => {
    for (const [name, why] of [
      ['createContext', 'sonner needs no provider of ours'],
      ['setTimeout', 'the dismissal schedule is sonner’s'],
      ['z-\\[', 'no manual z-index on an overlay'],
    ])
      // Comments stripped for the same reason: the header describes what it deleted.
      assert.doesNotMatch(code(toast), new RegExp(name), `${name} should have gone with the markup: ${why}`)
    // The file that had no callers left at all.
    assert.throws(
      () => source('components', 'ui', 'empty-state.tsx'),
      /ENOENT/,
      'empty-state.tsx was replaced by Empty and must not sit there as a second answer',
    )
  })

  test('a chip is a Badge and a segmented control is a ToggleGroup', () => {
    // Every assertion here reads `code(…)`, not the file. Both headers *describe*
    // the props they adopted, so matching the raw text would let the prose satisfy
    // the rule: `spacing={0}` survived being changed to `spacing={2}` on the JSX
    // because the sentence above it still said `spacing={0}`.
    const chipCode = code(chip)
    const segmentedCode = code(segmented)
    assert.match(chipCode, /from '\.\/badge'/, 'the pill is Badge’s, so a chip and a status badge match')
    assert.match(chipCode, /<Badge/)
    assert.match(segmentedCode, /from '@\/components\/ui\/toggle-group'/)
    assert.match(segmentedCode, /type="single"/, 'single mode is what gives Radix role=radiogroup/radio')
    assert.match(segmentedCode, /spacing=\{0\}/, 'zero gap is the joined look this replaced')
    // Both files used to build their own surface out of chart colours.
    for (const [name, text] of [
      ['chip.tsx', chipCode],
      ['segmented.tsx', segmentedCode],
    ])
      assert.doesNotMatch(text, /chart-\d/, `${name} must take its colour from the component, not a chart series`)
  })

  test('nothing in the console paints a severity with a chart colour', () => {
    /**
     * Old scope: the eight files in `pages`.
     * New scope: every `.ts`/`.tsx` under apps/cockpit/src.
     *
     * The eight pages were cleaned and the rule was then written around them, so
     * it passed over thirty of these — every one of them in a shared component or
     * a form, which is to say in the code the eight pages render. A rule that
     * walks the caller and not the callee grades the diff that produced it.
     *
     * What is a violation and what is not, because a chart is allowed its own
     * colours: a chart series reaches the screen as the CSS variable
     * `var(--color-chart-N)` — that is how overview.tsx strokes its sparkline,
     * and it is untouched here. A severity reaches it as a Tailwind utility on
     * something that is not a graph: `text-chart-5` on a failure count,
     * `bg-chart-3` on a warning dot, `border-chart-5` on an invalid input. Those
     * are `--destructive` and the warning tone spelled as a series index, and
     * index.css maps `--destructive` onto the same value — which is exactly what
     * makes the substitution invisible on screen and wrong in the source.
     */
    const offenders = []
    // The class alone, opacity modifier included: `bg-chart-5/5` is the same
    // decision as `bg-chart-5`, and the rest of the line is not the finding.
    const utility =
      /(?:text|bg|border|ring|fill|stroke|from|via|to|outline|divide|decoration|accent|caret)-chart-[235](?:\/\d+)?/g
    // chart-2 joined 3 and 5 once `--success` existed to route it through. Two
    // uses stay, and they are named rather than left to look like oversights: a
    // diff's green is a convention older than this console, and an up-vote count
    // is a quantity in a column of quantities. Both are data, neither is severity.
    const DATA = { 'forms/content/revisions.tsx': /chart-[25]/, 'forms/audience/moderation.tsx': /text-chart-2/ }
    for (const file of allSources)
      for (const [hit] of code(file.src).matchAll(utility)) {
        if (DATA[file.id]?.test(hit)) continue
        offenders.push(`${file.id}: ${hit}`)
      }
    assert.deepEqual(
      offenders,
      [],
      `route these through Alert, Badge, Progress’s tone or the destructive token:\n${offenders.join('\n')}`,
    )
  })

  test('no page hand-writes a pulsing rectangle', () => {
    for (const name of pages)
      assert.doesNotMatch(
        source('pages', `${name}.tsx`),
        /animate-pulse/,
        `${name}.tsx must ask Skeleton for a placeholder rather than animating a div`,
      )
  })

  test('the word "Loading…" is not a placeholder on any page', () => {
    // content.tsx already had this rule; the same defect was live on three more
    // pages, where a one-line sentence stood where a form was about to appear.
    for (const name of pages) {
      const text = code(source('pages', `${name}.tsx`))
      assert.doesNotMatch(text, />\s*Loading…/, `${name}.tsx renders "Loading…" as body text`)
      assert.doesNotMatch(text, /Loading…</, `${name}.tsx renders "Loading…" as body text`)
    }
  })
})
