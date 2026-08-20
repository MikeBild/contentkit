import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Overview, after the nine equally weighted boxes were given a hierarchy.
 *
 * Two rules from UI-UX.md meet on this page and pull in opposite directions, so
 * both are pinned here rather than left to whoever edits it next:
 *
 *  - §1, "one `Empty` per *surface*, not per card". The page used to draw one
 *    empty state inside every tile that had nothing to plot, so three tiles
 *    side by side each carried its own paragraph saying nothing was measured —
 *    three near-identical sentences carrying one fact between them.
 *  - §4, "a value nobody sent is not zero". `lib/stat-tile.ts` exists to keep a
 *    measured zero and an unmeasured value apart, and `cockpit-dates-progress`
 *    already drives that module. What no test could see is the *rendering*: the
 *    cheapest way to collapse nine paragraphs into one is to stop saying which
 *    of the two a tile is, and that would undo the module without touching it.
 *
 * So the words are read as data. `QUIET_WORD` and `QUIET_WORD_USAGE` are plain
 * records with no type annotation on purpose — Node cannot import a `.tsx`, and
 * a rule asserted as source text is a rule nobody has ever executed.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const overview = readFileSync(join(cockpit, 'pages', 'overview.tsx'), 'utf8')
const system = readFileSync(join(cockpit, 'pages', 'system.tsx'), 'utf8')
/**
 * The tiles moved. §1 puts operational numbers under Installation → System, and
 * durations and success ratios are operational numbers whatever the tile is
 * called, so the reading, the classification and the three renderers now live in
 * `components/statistics.tsx` and are rendered from System. Everything this file
 * asserted about them is asserted about them still — the rules did not move, the
 * code did, and a rule that quietly stopped applying because its file was
 * renamed is the failure this file exists to prevent.
 */
const statistics = readFileSync(join(cockpit, 'components', 'statistics.tsx'), 'utf8')

/** Comments first: this page documents the defects it fixed, quoting them. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** The `{…}` that follows an anchor, braces balanced. */
function braceGroup(text, from) {
  const start = text.indexOf('{', from)
  assert.ok(start > 0, 'no object literal follows that anchor')
  let depth = 0
  for (let at = start; at < text.length; at += 1) {
    if (text[at] === '{') depth += 1
    else if (text[at] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, at + 1)
    }
  }
  assert.fail('unbalanced braces')
}

const record = (name) => new Function(`return (${braceGroup(statistics, statistics.indexOf(`const ${name} =`))})`)()

describe('the Overview says "nothing measured" once, and still says which nothing it is', () => {
  test('a measured zero and a value nobody recorded never share a word', () => {
    for (const [name, words] of [
      ['QUIET_WORD', record('QUIET_WORD')],
      ['QUIET_WORD_USAGE', record('QUIET_WORD_USAGE')],
    ]) {
      // The two states `tileEmptiness` returns, and no third: a key the module
      // cannot produce is dead text, and a key it can produce and this record
      // cannot answer renders `undefined` beside a statistic's name.
      assert.deepEqual(
        Object.keys(words).sort(),
        ['measured-all-zero', 'nothing-came-back'],
        `${name} must answer exactly the two states tileEmptiness reports`,
      )
      for (const word of Object.values(words)) assert.ok(word.length > 0, `${name} has an empty word`)
      assert.notEqual(
        words['measured-all-zero'],
        words['nothing-came-back'],
        `${name}: "we measured and it is zero" and "nothing came back" are different facts, and one word for both is the collapse this page must not make`,
      )
    }
  })

  test('an opt-in statistic that was never switched on says so, rather than "nothing recorded"', () => {
    const product = record('QUIET_WORD')
    const usage = record('QUIET_WORD_USAGE')
    assert.notEqual(
      usage['nothing-came-back'],
      product['nothing-came-back'],
      'usage telemetry is opt-in per site, so an empty usage window is ordinarily a site that never enabled it',
    )
    // A measured zero is a measured zero either way; a second word for it would
    // be a distinction the data does not carry.
    assert.equal(usage['measured-all-zero'], product['measured-all-zero'])
  })

  test('the emptiness comes from the module that owns it, not from a second rule here', () => {
    assert.match(statistics, /from '@\/lib\/stat-tile'/)
    assert.match(statistics, /tileEmptiness\(metrics\)/, 'the tile is classified by the module the tests can call')
    assert.match(statistics, /visibleMetrics\(metrics\)/)
    // The classification is what the page groups by, so it has to reach the DOM
    // for a browser test as well as this one.
    assert.match(statistics, /data-emptiness=\{tile\.emptiness\}/)
  })

  test('the empty state and the refusal are one per surface, not one per tile', () => {
    // One of each in the whole file. Nine tiles with nothing to plot is one
    // sentence about this window; nine tiles that answered 403 is one sentence
    // about this operator's scope.
    const clean = stripComments(statistics)
    const quiet = clean.slice(clean.indexOf('function QuietStats'), clean.indexOf('function StatCard'))
    const unreadable = clean.slice(clean.indexOf('function UnreadableStats'), clean.indexOf('function QuietStats'))
    assert.equal([...quiet.matchAll(/<Empty\b/g)].length, 1, 'one quiet state serves the whole statistics surface')
    assert.equal([...unreadable.matchAll(/<Alert\b/g)].length, 1, 'one refusal serves the whole statistics surface')
    // Both must sit outside the card, or the count above is satisfied by a card
    // that renders the only one.
    const card = stripComments(statistics).indexOf('function StatCard')
    assert.ok(card > 0, 'StatCard must exist')
    const inCard = stripComments(statistics).slice(card)
    assert.doesNotMatch(inCard, /<Empty\b/, 'the tile must not carry an empty state of its own')
    assert.doesNotMatch(inCard, /<Alert\b/, 'nor a refusal of its own')
  })

  test('the surface-level empty and the surface-level refusal are still two different things', () => {
    // UI-UX.md §5: an empty result and a failed request must never look the
    // same. Grouping them was the change; merging them would be the defect.
    assert.match(statistics, /<Empty[\s\S]{0,400}?data-testid="ck-overview-quiet"/)
    assert.match(statistics, /<Alert variant="destructive"[\s\S]{0,200}?data-testid="ck-overview-unreadable"/)
  })

  test('a refusal keeps the server’s own words, grouped rather than rewritten', () => {
    // A 403 and a 500 on one page are two problems, and a refusal that names
    // counts loses them the moment it is summarised into one sentence.
    assert.match(statistics, /grouped\.set\(message/, 'the message is what the kinds are grouped by')
    assert.match(statistics, /error instanceof Error \? tile\.result\.error\.message/, 'verbatim, not paraphrased')
  })

  test('the release chain is the page’s first answer and the §4 sentence is the reference under it', () => {
    const body = overview.slice(overview.indexOf('export function OverviewPage'))
    const chain = body.indexOf('<ReleaseChain')
    const section = body.indexOf('data-testid="ck-overview-statistics"')
    assert.ok(chain > 0, 'the chain must be on the page')
    assert.ok(section > chain, 'the chain is the thing an operator acts on, so it comes first')
    assert.match(
      body,
      /<h2[^>]*>\{t\('overview\.statistics'\)\}<\/h2>/,
      'the reference half needs a heading to be a half rather than more tiles',
    )
  })

  test('the tiles moved to Installation → System, and the measured zero stayed', () => {
    // §1, verbatim: "Betriebsmetriken (HTTP, p95, Calls) wohnen unter
    // Installation → System, nie auf dem Startscreen." The eight product tiles
    // carried durations and success ratios, which is that class of number under
    // a different name — so the grid and the refusal render from System now.
    const clean = stripComments(overview)
    assert.doesNotMatch(clean, /<StatCard\b/, 'no statistic tile renders on the first screen')
    assert.doesNotMatch(clean, /<UnreadableStats\b/, 'nor the refusal that belongs beside them')
    assert.doesNotMatch(
      clean,
      /'duration'|'ratio'|'percentage'|'data-size'/,
      'nor the unit formatting that only operational numbers need',
    )
    assert.match(stripComments(system), /<StatisticsSection\b/, 'System renders the surface they moved to')
    assert.match(stripComments(statistics), /<StatCard\b/, 'and the tiles live in the module both pages read')

    // The one exception, and the reason it is one: ContentKit is the family's
    // reference for §4's "gemessene Null". "5 von 8 haben nichts darzustellen"
    // is a measurement about all eight, which is why the page still READS all
    // eight while rendering none of them.
    assert.match(clean, /<QuietStats\b/, 'the "gemessene Null" card is what stayed on the Overview')
    assert.match(clean, /useStatTiles\(site\)/, 'and it is still measured over every statistic, not over one')
    // §1 again: "Kein Zähler ohne Link." The count is on the Overview and the
    // things counted are on System, so the way between them has to exist.
    assert.match(clean, /to="\/system"/, 'the count links to the tiles it counts')
  })

  test('the page description says what the page is for, not how the numbers are computed', () => {
    const description = /description=\{t\('page\.overview\.description',\s*\{ site \}\)\}/.exec(overview)
    assert.ok(description, 'the page must carry a description')
    assert.doesNotMatch(
      description[0],
      /bucket|aggregate|UTC/i,
      'the window is a fact about the numbers and belongs beside them, not in the page’s purpose',
    )
    // Moved, not deleted: the window is still stated where the numbers are —
    // which is now the statistics surface itself, under Installation → System.
    assert.match(statistics, /t\('overview\.statisticsWindow'\)/)
  })
})
