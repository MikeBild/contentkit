import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Dates, and honesty about how far along something is.
 *
 * Three claims are worth holding onto, and every one of them is about a value
 * rather than about a pixel:
 *
 * 1. An empty date is a decision. `date` unset means "the moment the release is
 *    built", `scheduledAt` unset means "with the next release", `updatedAt` unset
 *    means "no update line". A control that helpfully filled in today would change
 *    what gets published and what the page says about itself, so the whole chain —
 *    the document as parsed, the value the field is handed, the value it hands back,
 *    the document as emitted — has to carry absence as absence. That chain is run
 *    here for real: `detect` and `toWire` are the console's own frontmatter
 *    functions and `date-value.ts` is the field's own value handling.
 *
 * 2. The quick sets are arithmetic on an instant somebody passes in. `Date.now()`
 *    does not appear in this file: a test that read the clock would pass in July and
 *    be unexplainable in October, and the whole reason `presetInstant` takes `now`
 *    is that its result must be a function of its arguments.
 *
 * 3. A progress bar may only draw a fraction that exists. The releases list
 *    reports no percentage — the schema is asserted below, so this is not a matter
 *    of opinion — and the audio budget reports a real one, but only for a site that
 *    configured a budget. Two shapes, two forms, and the choice between them is
 *    made in `ui/progress-value.ts`, code a test can call: `progressPercent`
 *    answers `null` for a value nobody measured and for a denominator that is
 *    absent, null or zero, and `ui/progress.tsx` then draws a pulsing track that
 *    publishes no `aria-valuenow`, `aria-valuemin` or `aria-valuemax` at all —
 *    which is why that branch cannot be Radix's root, since Radix emits the last
 *    two unconditionally.
 *
 * The Cockpit has no test runner, so this file works in two halves like
 * cockpit-primitives.test.mjs: the behavioural half imports the dependency-free
 * `.ts` modules and calls them (skipping on a Node that cannot strip types, with
 * the reason printed), and the structural half asserts over committed source text
 * for the things a pure function cannot see — which component a field is, that work
 * of unknown length reaches for the bar that publishes no value rather than
 * rolling its own readout, that every control is addressable.
 *
 * What source text cannot see is the accessibility tree, and that is where the
 * third claim actually lives. `apps/cockpit/src/components/ui/progress.test.tsx`
 * and `apps/cockpit/src/pages/releases.test.tsx` render both shapes and read the
 * roles and the value attributes off the DOM; nothing below can, and nothing
 * below should be read as if it had.
 *
 * Only committed source is read. Nothing here touches a generated artefact.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const source = (...parts) => readFileSync(join(cockpit, ...parts), 'utf8')

/**
 * Every `.ts`/`.tsx` the console is built from, with its path.
 *
 * A rule about what the console may import cannot be checked against a list of
 * files somebody remembered to extend — the file that breaks it is by definition
 * the new one. All committed source; the generated artefacts are a stylesheet and
 * a bundle, and neither is a module of ours.
 */
const sources = () => {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
        found.push([full.slice(cockpit.length + 1), readFileSync(full, 'utf8')])
    }
  }
  walk(cockpit)
  return found
}

/** Comments go first: a component that documents a rule is not a component that keeps it. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const fields = source('forms', 'content', 'fields.tsx')
const releases = source('pages', 'releases.tsx')
// Was `pages/authoring.tsx`, which held five routed pages. The budget bar is the
// Audio page's alone, and "exactly one bar on this page" below now means it.
const authoring = source('pages', 'audio.tsx')
const budgetModule = source('lib', 'audio-budget.ts')
const progressSource = source('components', 'ui', 'progress.tsx')
const fieldIndex = source('forms', 'fields', 'index.ts')
const spec = JSON.parse(readFileSync(join(root, 'docs', 'openapi.json'), 'utf8'))

/**
 * The one JSX element that carries a `data-testid`, from its `<` to the `/>` that
 * closes it.
 *
 * Per element, not per file: "the publication date is a DateField" must not be
 * satisfiable by a DateField somewhere else on the page, and "the build bar passes
 * no value" must not be satisfiable by the absence of the word `value` from a file
 * that has one. Attribute braces are counted so a nested element inside an
 * attribute — `hint={<RelativeTime … />}` — cannot end the scan early.
 */
function element(text, testId, label = testId) {
  const at = text.indexOf(`data-testid="${testId}"`)
  assert.ok(at >= 0, `nothing carries data-testid="${testId}" (${label})`)
  const open = text.lastIndexOf('<', at)
  assert.ok(open >= 0, `data-testid="${testId}" is not inside an element`)
  let braces = 0
  for (let index = open; index < text.length; index++) {
    const char = text[index]
    if (char === '{') braces++
    else if (char === '}') braces--
    else if (braces === 0 && char === '/' && text[index + 1] === '>') return text.slice(open, index + 2)
  }
  return assert.fail(`the element carrying data-testid="${testId}" never closes`)
}

const stripsTypes = typeof process.features.typescript === 'string'
let logic = null
let failure = null
try {
  logic = {
    date: await import('../../apps/cockpit/src/forms/fields/date-value.ts'),
    frontmatter: await import('../../apps/cockpit/src/forms/content/frontmatter.ts'),
    budget: await import('../../apps/cockpit/src/lib/audio-budget.ts'),
    progress: await import('../../apps/cockpit/src/components/ui/progress-value.ts'),
    tile: await import('../../apps/cockpit/src/lib/stat-tile.ts'),
  }
} catch (error) {
  failure = error
}

const behavioural = {
  skip: logic ? false : `this Node cannot import TypeScript (type stripping landed in 22.6): ${failure?.message}`,
}

/** 30 July 2026, 12:00 UTC. Midday so that no operator's timezone moves the day. */
const NOW = Date.UTC(2026, 6, 30, 12, 0, 0)

describe('Cockpit dates: unset is a value', () => {
  test('the modules these tests drive load wherever Node can read TypeScript', () => {
    if (!stripsTypes) {
      assert.equal(logic, null, 'a Node without type stripping cannot have imported them')
      return
    }
    assert.ok(logic, `the behavioural half could not load: ${failure?.stack}`)
  })

  describe('a date the author never set, all the way through', behavioural, () => {
    /** What fields.tsx does between the form state and the field, in both directions. */
    const toField = (ui, key) => ui[key] || undefined
    const fromField = (value) => value ?? ''

    test('an absent date arrives as absent, is offered as absent, and is emitted as absent', () => {
      const { detect, toWire, emit } = logic.frontmatter
      const { dateState, toDayInput } = logic.date

      const ui = detect({ title: 'A document with no date' })
      assert.equal(ui.date, '', 'the form holds an unset date as the empty string')
      assert.equal(toField(ui, 'date'), undefined, 'and hands the field undefined rather than an empty string')
      assert.equal(dateState(toField(ui, 'date')), 'unset')
      // The same absence either way round: a form that handed its raw '' over
      // must not turn the author's silence into "not a date".
      assert.equal(dateState(ui.date), 'unset')
      assert.equal(toDayInput(toField(ui, 'date')), '', 'the control renders nothing at all')

      const wire = toWire(ui)
      assert.equal('date' in wire, false, 'nothing was invented on the way out')
      assert.doesNotMatch(emit(ui, 'Body'), /date:/, 'and the document gains no date line')
    })

    test('a day chosen on an empty document reaches the wire as that day, not as an instant', () => {
      const { detect, toWire } = logic.frontmatter
      const { dateState, fromDayInput, toDayInput } = logic.date

      const ui = detect({ title: 'x' })
      // Nothing was there, so there is no time of day to keep and no zone the
      // operator implied: a day goes out as a day. Asserted as the literal, because
      // comparing the result against the expression that produced it is an equality
      // that holds whatever the function returns.
      const chosen = fromDayInput('2026-08-15', toField(ui, 'date'))
      assert.equal(chosen, '2026-08-15', 'the day itself, with no local midnight invented for it')
      const set = { ...ui, date: fromField(chosen) }

      assert.equal(dateState(set.date), 'set')
      assert.equal(toDayInput(set.date), '2026-08-15', 'and the control shows the day that was picked')
      assert.equal(toWire(set).date, '2026-08-15', 'which is what the API is sent')
    })

    test('a document carrying an instant keeps the instant, and its time of day, across an edit', () => {
      const { detect, toWire } = logic.frontmatter
      const { fromDayInput, toDayInput } = logic.date

      // 08:30 UTC: a moment, not a day the API normalised — so this is the row where
      // the field must carry a time of day rather than hand back a bare day.
      const ui = detect({ title: 'x', date: '2026-01-09T08:30:00.000Z' })
      const moved = fromDayInput('2026-08-15', toField(ui, 'date'))
      const wire = toWire({ ...ui, date: fromField(moved) })

      assert.match(wire.date, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'an instant went out, not a day')
      assert.equal(toDayInput(wire.date), '2026-08-15', 'shown as the day the operator picked')
      // The zone is the machine's, so the time of day is read off the value that was
      // there rather than written down here — the claim is that it was carried, and
      // a hardcoded hour would only be the claim that this machine is in UTC.
      const before = new Date('2026-01-09T08:30:00.000Z')
      const after = new Date(wire.date)
      assert.equal(after.getHours(), before.getHours(), 'a publication at 08:30 did not become one at midnight')
      assert.equal(after.getMinutes(), before.getMinutes())
      assert.notEqual(wire.date, '2026-08-15', 'and the document did not lose its time of day to a bare day')
    })

    test('set and unset are different documents, not two spellings of one', () => {
      const { detect, toWire } = logic.frontmatter
      const { dateState, fromDayInput } = logic.date

      const ui = detect({ title: 'x' })
      const chosen = { ...ui, date: fromField(fromDayInput('2026-08-15')) }
      const cleared = { ...ui, date: fromField(undefined) }

      assert.equal(dateState(chosen.date), 'set')
      assert.equal(dateState(cleared.date), 'unset', 'and not "invalid": an empty form is not an unreadable date')
      assert.equal('date' in toWire(chosen), true)
      assert.equal('date' in toWire(cleared), false)
    })

    test('clearing a date the document had removes the line instead of dating it today', () => {
      const { detect, toWire, emit } = logic.frontmatter
      const ui = detect({ title: 'x', date: '2026-01-09T08:30:00.000Z' })
      assert.equal(toWire(ui).date, '2026-01-09T08:30:00.000Z', 'it was there to begin with')

      const cleared = { ...ui, date: fromField(undefined) }
      assert.equal('date' in toWire(cleared), false)
      assert.doesNotMatch(emit(cleared, 'Body'), /date:/)
    })

    test('a date nobody can read is neither set nor empty, and is not thrown away', () => {
      const { detect, toWire } = logic.frontmatter
      const { dateState, toDayInput } = logic.date
      const ui = detect({ title: 'x', date: 'yesterday' })

      assert.equal(dateState(toField(ui, 'date')), 'invalid', 'so the field can say so instead of blanking it')
      assert.equal(toDayInput(ui.date), '', 'the control cannot show it')
      assert.equal(toWire(ui).date, 'yesterday', 'and a save does not delete the author’s line')
    })

    test('the spelling the author used is the spelling that comes back', () => {
      const { detect, toWire } = logic.frontmatter
      const { fromDayInput, toDayInput } = logic.date
      const ui = detect({ title: 'x', publishedAt: '2026-01-09T08:30:00.000Z' })
      const edited = { ...ui, date: fromField(fromDayInput('2026-08-15', ui.date)) }
      const wire = toWire(edited)

      assert.equal('date' in wire, false, 'a document that said publishedAt keeps saying publishedAt')
      // Not merely truthy: the edited value has to be on that key, or "the key
      // survived" would be satisfied by the value that was already there.
      assert.equal(toDayInput(wire.publishedAt), '2026-08-15', 'and the edit landed on that key')
    })

    /**
     * The spelling the API produces, driven through the chain in the zones where the
     * difference shows.
     *
     * `parseIsoDate` (src/utils.mjs, called from src/markdown.mjs) normalises every
     * `date:` line with `new Date(value).toISOString()`, so a document written as
     * `date: 2026-07-30` comes back from the API as exactly
     * '2026-07-30T00:00:00.000Z'. Read as a local moment that is the 29th in Los
     * Angeles — and '2026-01-01T00:00:00.000Z' is the 31st of December 2025, a
     * document showing the year before the one it says. The instant round-trips
     * either way; what must not happen is the operator being shown, and the summary
     * line reading, a different calendar day than the document spells.
     */
    const API_DAYS = [
      { stored: '2026-07-30T00:00:00.000Z', day: '2026-07-30' },
      { stored: '2026-01-01T00:00:00.000Z', day: '2026-01-01' },
    ]
    const ZONES = ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']

    function inZone(zone, body) {
      const previous = process.env.TZ
      process.env.TZ = zone
      try {
        body()
      } finally {
        if (previous === undefined) delete process.env.TZ
        else process.env.TZ = previous
      }
    }

    test('a day the API spells as midnight UTC is shown, and saved, as that day in every zone', () => {
      const { detect, toWire, emit } = logic.frontmatter
      const { toDayInput, fromDayInput } = logic.date

      for (const zone of ZONES) {
        for (const { stored, day } of API_DAYS) {
          inZone(zone, () => {
            const where = `${zone}: ${stored}`
            const ui = detect({ title: 'x', date: stored })
            assert.equal(toDayInput(toField(ui, 'date')), day, `${where}: the control shows the day it spells`)

            // The operator opens the field and puts the same day back, which is what
            // any interaction with the control does.
            const saved = { ...ui, date: fromField(fromDayInput(toDayInput(ui.date), ui.date)) }
            assert.equal(toWire(saved).date, stored, `${where}: and the document is the document it was`)
            assert.match(emit(saved, 'Body'), new RegExp(`date: ${stored}`), `${where}: line for line`)
          })
        }
      }
    })

    test('scheduling and the update line carry the same absence', () => {
      const { detect, toWire } = logic.frontmatter
      const { dateState } = logic.date
      const ui = detect({ title: 'x' })

      for (const key of ['scheduledAt', 'updatedAt']) {
        assert.equal(dateState(toField(ui, key)), 'unset', `${key} starts unset`)
        assert.equal(key in toWire(ui), false, `${key} is not written just because a form has a control for it`)
      }
    })
  })

  describe('the quick sets: arithmetic on an instant that is passed in', behavioural, () => {
    test('30, 90 and 365 days are counted from the instant given, not from now', () => {
      const { presetInstant } = logic.date
      assert.equal(presetInstant(30, NOW), '2026-08-29T12:00:00.000Z')
      assert.equal(presetInstant(90, NOW), '2026-10-28T12:00:00.000Z')
      assert.equal(presetInstant(365, NOW), '2027-07-30T12:00:00.000Z')
    })

    test('the same arguments always give the same answer', () => {
      const { presetInstant } = logic.date
      assert.equal(presetInstant(90, NOW), presetInstant(90, NOW))
      // A different instant moves the answer by exactly the same distance, which
      // is what "no clock is read in here" means in practice.
      const later = NOW + 3_600_000
      assert.equal(
        Date.parse(presetInstant(90, later)) - Date.parse(presetInstant(90, NOW)),
        3_600_000,
        'the offset is applied to the argument',
      )
    })

    test('Never is the unset state and reaches the wire as no key at all', () => {
      const { presetInstant } = logic.date
      const { detect, toWire } = logic.frontmatter
      assert.equal(presetInstant(null, NOW), undefined, 'not a date in the year 9999')

      const ui = detect({ title: 'x', date: '2026-01-09T08:30:00.000Z' })
      const never = { ...ui, date: presetInstant(null, NOW) ?? '' }
      assert.equal('date' in toWire(never), false)
    })

    test('a quick-set value survives to the wire unchanged', () => {
      const { presetInstant } = logic.date
      const { detect, toWire } = logic.frontmatter
      const ui = detect({ title: 'x' })
      const chosen = presetInstant(30, NOW)
      assert.equal(toWire({ ...ui, date: chosen ?? '' }).date, '2026-08-29T12:00:00.000Z')
    })

    test('the four choices are still the four choices', () => {
      const { DATE_PRESETS } = logic.date
      assert.deepEqual(
        DATE_PRESETS.map((preset) => preset.days),
        [30, 90, 365, null],
      )
    })
  })
})

describe('Cockpit progress: a fraction only where one exists', () => {
  describe('the audio budget decides for itself whether it is measurable', behavioural, () => {
    const { audioBudget, AUDIO_BUDGET_WARNING } = { ...(logic?.budget ?? {}) }

    test('no summary, and no budget configured, are both "no fraction"', () => {
      assert.equal(audioBudget(undefined), null)
      assert.equal(audioBudget(null), null)
      assert.equal(audioBudget({ chars_this_month: 12_000 }), null, 'a missing budget is not a budget')
      assert.equal(
        audioBudget({ chars_this_month: 12_000, monthly_char_budget: null }),
        null,
        'which is what the API sends',
      )
      assert.equal(
        audioBudget({ chars_this_month: 12_000, monthly_char_budget: 0 }),
        null,
        'zero is the absence of one',
      )
      assert.equal(audioBudget({ chars_this_month: 12_000, monthly_char_budget: -5 }), null)
      assert.equal(audioBudget({ monthly_char_budget: 1000 }), null, 'a numerator nobody sent is not zero')
      // An explicit null, not just an omitted key. Number(null) is 0 rather than NaN, so a
      // Number.isFinite guard reads it as a measured zero and the bar draws "0 of 1,000 ·
      // 1,000 left" for a figure the server never sent. The declared interface allows null on
      // all three fields even though this server ties them to one flag, and the interface is
      // what a client has to defend against.
      assert.equal(
        audioBudget({ chars_this_month: null, monthly_char_budget: 1000 }),
        null,
        'an explicit null numerator is not a measured zero',
      )
      // And the other half: only the remainder missing must be derived, never read as zero,
      // or the readout contradicts itself — "500 of 1,000 · 0 left".
      const derived = audioBudget({ chars_this_month: 500, monthly_char_budget: 1000, budget_remaining: null })
      assert.equal(derived.remaining, 500, 'a remainder nobody sent is derived, not read as zero')
    })

    test('a configured budget is a real fraction, in the site’s own numbers', () => {
      const measured = audioBudget({
        chars_this_month: 400_000,
        monthly_char_budget: 1_000_000,
        budget_remaining: 600_000,
      })
      assert.deepEqual(measured, {
        used: 400_000,
        budget: 1_000_000,
        remaining: 600_000,
        ratio: 0.4,
        tone: 'accent',
        spent: false,
      })
    })

    test('the tone escalates where a budget stops being a number that is always fine', () => {
      const at = (used) => audioBudget({ chars_this_month: used, monthly_char_budget: 1000 })
      assert.equal(AUDIO_BUDGET_WARNING, 0.8)
      assert.equal(at(799).tone, 'accent')
      assert.equal(at(800).tone, 'warning', 'the threshold is inclusive')
      assert.equal(at(999).tone, 'warning')
      assert.equal(at(1000).tone, 'danger')
      assert.equal(at(1200).tone, 'danger')
    })

    test('spent is spent: the next post is skipped once the characters are gone', () => {
      assert.equal(audioBudget({ chars_this_month: 999, monthly_char_budget: 1000 }).spent, false)
      assert.equal(audioBudget({ chars_this_month: 1000, monthly_char_budget: 1000 }).spent, true)
      assert.equal(audioBudget({ chars_this_month: 1400, monthly_char_budget: 1000 }).ratio, 1.4, 'never clamped away')
    })

    test('the server’s own remaining wins, and is derived only when it sent none', () => {
      assert.equal(
        audioBudget({ chars_this_month: 400, monthly_char_budget: 1000, budget_remaining: 550 }).remaining,
        550,
        'two numbers disagreeing on one screen is worse than one number from the API',
      )
      assert.equal(audioBudget({ chars_this_month: 400, monthly_char_budget: 1000 }).remaining, 600)
      assert.equal(audioBudget({ chars_this_month: 1400, monthly_char_budget: 1000 }).remaining, 0, 'never negative')
      assert.equal(
        audioBudget({ chars_this_month: 400, monthly_char_budget: 1000, budget_remaining: -20 }).remaining,
        0,
      )
    })
  })

  describe('the bar itself decides whether it has anything to draw', behavioural, () => {
    const { progressPercent } = { ...(logic?.progress ?? {}) }

    test('a value nobody measured is not zero per cent', () => {
      assert.equal(progressPercent(undefined, 100), null)
      assert.equal(progressPercent(null, 100), null, 'which is what an API that reports no progress sends')
      assert.equal(progressPercent(Number.NaN, 100), null)
      assert.equal(progressPercent(Number.POSITIVE_INFINITY, 100), null)
      // And the other half of the same rule: a measured zero is a measurement, and
      // an empty bar is the honest picture of it.
      assert.equal(progressPercent(0, 100), 0, 'nothing done yet is a fraction; nothing known is not')
    })

    test('a denominator that is not one is not one', () => {
      assert.equal(progressPercent(12_000, undefined), 100, 'no denominator means the value is already a percentage')
      assert.equal(progressPercent(12_000, null), null, 'an explicit null is the site with no budget configured')
      assert.equal(progressPercent(12_000, 0), null, 'zero is the absence of one, not a division')
      assert.equal(progressPercent(12_000, -1000), null, 'nor is a bar that fills as the number goes down')
      assert.equal(progressPercent(12_000, Number.NaN), null)
    })

    test('a fraction that exists is the two numbers, and is clamped to a bar that can be drawn', () => {
      assert.equal(progressPercent(400_000, 1_000_000), 40)
      assert.equal(progressPercent(1400, 1000), 100, 'a spent budget overshoots; the picture cannot')
      assert.equal(progressPercent(-5, 1000), 0)
      // The shape `pages/authoring.tsx` passes — already a percentage against a
      // hundred — has to survive the same function unchanged, or the bar and the
      // numbers printed beside it would disagree.
      assert.equal(progressPercent(Math.min(100, Math.round(0.4 * 100)), 100), 40)
    })

    test('the answer is a function of its arguments', () => {
      assert.equal(progressPercent(400_000, 1_000_000), progressPercent(40, 100), 'one fraction, however it is spelled')
    })
  })

  test('an unknown fraction is a pulse with no numbers on it, and that branch is not Radix’s', () => {
    // Radix's Progress root emits `role="progressbar"`, `aria-valuemin` and
    // `aria-valuemax` unconditionally — it drops only `aria-valuenow` for a value
    // it cannot read as a number (@radix-ui/react-progress). So a bar handed no
    // value still reports a maximum for a quantity nobody measured, which is the
    // invention this contract exists to prevent. The indeterminate form therefore
    // cannot be that root, and the determinate form must be.
    // Comment-stripped: this component documents the ARIA it deliberately does
    // not draw, and a rule written in prose is not an attribute anybody reads.
    const bar = stripComments(source('components', 'ui', 'progress.tsx'))
    assert.match(bar, /from '\.\/progress-value'/, 'the decision is made in the module a test can call')
    // To the end of the line, and no coercion anywhere: `progressPercent(…) ?? 0`
    // would satisfy every other assertion here while drawing an empty determinate
    // bar — a measured zero — for a fraction nobody has, which is the exact
    // invention this whole file exists to prevent.
    assert.match(bar, /const percent = progressPercent\(value, max\)\n/, 'and it is made before anything is drawn')
    assert.doesNotMatch(
      bar,
      /progressPercent\([^)]*\)\s*(\?\?|\|\|)/,
      'an unknown fraction must stay unknown: coercing it to a number draws one the API never reported',
    )

    const split = bar.indexOf('percent === null ? (')
    assert.ok(split > 0, 'the two forms are one choice in one place')
    const indeterminate = bar.slice(split, bar.indexOf(') : (', split))
    const determinate = bar.slice(bar.indexOf(') : (', split))

    for (const attribute of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) {
      assert.doesNotMatch(
        bar,
        new RegExp(attribute),
        `${attribute} is drawn nowhere in this file: for a fraction it is Radix's to emit, and for work of ` +
          'unknown length there is no number to put in it',
      )
    }
    assert.match(indeterminate, /role="progressbar"/, 'it is still a progressbar, so a reader is told "busy"')
    assert.doesNotMatch(indeterminate, /ProgressPrimitive/, 'but not Radix’s, which would report a maximum')
    assert.doesNotMatch(indeterminate, /translateX|style=/, 'and it is at no position, because it has none')
    assert.match(indeterminate, /animate-pulse/, 'a pulse is how "still going" is drawn without claiming a place')
    assert.match(indeterminate, /motion-reduce:animate-none/, 'and it stands down where less motion was asked for')

    assert.match(determinate, /<ProgressPrimitive\.Root/, 'a fraction that exists is Radix’s bar')
    assert.match(determinate, /value=\{percent\}/, 'drawn from the percentage this module computed')
    assert.match(determinate, /translateX\(-\$\{100 - percent\}%\)/, 'which is also the geometry Radix expects')
  })

  test('the six things a caller can say about progress are all still sayable', () => {
    // value/max/label/valueLabel/tone/since. `tone` and `since` are the two that
    // shadcn's Progress has no home for, and both are load-bearing: the severity
    // is `lib/audio-budget.ts`'s decision, and `since` is the only fact
    // unknown-duration work has.
    const bar = source('components', 'ui', 'progress.tsx')
    for (const prop of ['value', 'max', 'label', 'valueLabel', 'tone', 'since']) {
      assert.match(bar, new RegExp(`\\n {2}${prop}\\b`), `${prop} is part of the contract`)
    }
    assert.match(bar, /<RelativeTime value=\{since \?\? null\} \/>/, 'and an ageless indeterminate bar reads as hung')
    // The tones are the palette's names, not colours. A literal here would be the
    // one place the console's two themes could disagree.
    assert.doesNotMatch(bar, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'severity is a token, never a colour literal')
    assert.doesNotMatch(bar, /\bdark:/, 'and never a second value for the other theme')
  })

  test('the module that draws the fraction reads no clock and no API', () => {
    assert.doesNotMatch(budgetModule, /Date\.now|new Date/, 'the month boundary is the server’s, not this module’s')
    assert.doesNotMatch(budgetModule, /\bfetch\b|\bck\./)
  })

  // ── Why the release build has no fraction to draw ───────────────────────────

  test('the releases list reports no progress, which is why there is no bar', () => {
    const release = spec.components.schemas.Release
    const properties = Object.keys(release.properties)
    for (const name of [
      'progress',
      'percent',
      'percent_complete',
      'fraction',
      'step',
      'steps',
      'steps_total',
      'total',
      'total_files',
      'files_total',
      'files_written',
      'eta',
    ]) {
      assert.equal(
        properties.includes(name),
        false,
        `GET /v1/sites/{site}/releases now reports "${name}" — a determinate bar may finally be honest, so revisit pages/releases.tsx instead of leaving this assertion`,
      )
    }
    assert.ok(release.required.includes('created_at'), 'the one fact a running build does have is when it started')
    assert.deepEqual(release.properties.completed_at.type, ['string', 'null'], 'and a running build has no completion')
  })

  test('the audio summary does report a fraction, and reports its absence too', () => {
    const summary = spec.components.schemas.AudioJobList.properties.summary
    for (const name of ['chars_this_month', 'monthly_char_budget', 'budget_remaining']) {
      assert.ok(summary.required.includes(name), `${name} is always sent`)
    }
    assert.deepEqual(
      summary.properties.monthly_char_budget.type,
      ['integer', 'null'],
      'null is the site with no budget, which is the case the bar must not invent',
    )
  })
})

describe('Cockpit progress and dates: how the pages use them', () => {
  // ── The three publication dates ────────────────────────────────────────────

  test('the publication date is a date field with its meaning of empty spelled out', () => {
    const date = element(fields, 'ck-fm-date', 'the publication date')
    assert.match(date, /^<DateField\b/, 'not a bare control showing tt.mm.jjjj')
    assert.match(date, /\bpresets\b/, 'the 30/90/365/Never quick sets it already had')
    assert.match(date, /fallback=\{t\('content\.publicationDateFallback'\)\}/)
    assert.match(date, /value=\{fm\.date \|\| undefined\}/, 'the empty string is handed over as absence')
    assert.match(date, /onChange=\{\(value\) => set\('date', value \?\? ''\)\}/, 'and comes back as absence')
  })

  test('the update line is a date field, and empty still means no line', () => {
    const updated = element(fields, 'ck-fm-updated-at', 'last updated')
    assert.match(updated, /^<DateField\b/)
    assert.match(updated, /\bpresets\b/)
    assert.match(updated, /fallback=\{t\('content\.lastUpdatedFallback'\)\}/)
    assert.match(updated, /onChange=\{\(value\) => set\('updatedAt', value \?\? ''\)\}/)
  })

  test('scheduling keeps its time of day, and says out loud whether it is set', () => {
    const scheduled = element(fields, 'ck-fm-scheduled-at', 'scheduled for')
    // /v1/publish-due publishes every scheduled revision whose scheduled_at has
    // passed. A day-only control would move every scheduled document to local
    // midnight, which is a different publication than the one that was chosen.
    assert.match(scheduled, /^<DateTimeField\b/, 'a calendar day is not a schedule')
    assert.match(scheduled, /hint=\{/, 'the set/unset state is on screen, as it is for the two date fields')
    assert.equal(
      (scheduled.match(/data-testid="ck-fm-scheduled-at-when"/g) ?? []).length,
      2,
      'both states are addressable — a script that can only find one of them cannot tell them apart',
    )
    assert.match(scheduled, /fallback=\{t\('content\.scheduledForFallback'\)\}/)
  })

  test('nothing in the frontmatter form reads the clock', () => {
    assert.doesNotMatch(fields, /Date\.now\(|new Date\(/, 'a field that could default to today would rewrite documents')
  })

  test('the date field is reachable through the field inventory, like every other field', () => {
    assert.match(fieldIndex, /export \{ DateField \} from '\.\/date'/)
    assert.match(fields, /\n {2}DateField,\n/, 'and fields.tsx imports it from there rather than reaching past it')
  })

  // ── A release build in flight ──────────────────────────────────────────────

  test('the build draws a bar with no fraction on it, because none is reported', () => {
    // This test asserted the opposite for one version — `<Spinner>` inside a
    // `role="status"` div, and zero `<Progress>` on the page — and the reasoning
    // was sound for the component that existed then: `ui/progress.tsx` was
    // Radix's, whose indicator is translated by `100 - value`, so `value={null}`
    // drew a static empty track under a root that announces `aria-valuemin` and
    // `aria-valuemax` regardless. A bar was the wrong control, so there was none.
    //
    // `ui/progress.tsx` is ContentKit's now and has a real indeterminate branch,
    // and the substitute is the weaker claim: `role="status"` is a live region.
    // It announces its text once and then describes nothing, so a reader who
    // arrives afterwards is told this card is a paragraph rather than that a
    // build is in flight. ARIA's spelling for the latter is a named
    // `progressbar` publishing no value at all, which is what the page renders
    // now — asserted for real, against the accessibility tree, in
    // apps/cockpit/src/pages/releases.test.tsx. What is left for source text is
    // that the page reaches for the component that keeps the claim, and hands it
    // only facts that exist.
    const indicator = element(releases, 'release-build-progress', 'the build indicator')
    assert.match(indicator, /^<Progress\b/, 'the bar with no fraction is a component, not markup of this page')
    assert.match(indicator, /since=\{startedAt\}/, 'and it ages from the server’s own instant')
    // `value` as a prop of this bar, not the word anywhere inside it: the readout
    // beside the bar is `<RelativeTime value={startedAt} />`, an instant, and a
    // regex that could not tell the two apart would be satisfied by deleting the
    // elapsed time. Props of this element start their own line.
    assert.doesNotMatch(
      indicator,
      /\n\s*value=\{/,
      'a guessed percentage would stall at ninety and get a good build cancelled',
    )
    // Comment-stripped: this page documents the role it deliberately stopped
    // rendering, and a role written in prose is not one any reader is given.
    const rendered = stripComments(releases)
    assert.doesNotMatch(rendered, /role="status"/, 'a live region is not a statement about progress')
    for (const attribute of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) {
      assert.doesNotMatch(rendered, new RegExp(attribute), `${attribute} is a number this page does not have`)
    }
    // The component's half of the same claim, so this file names the branch the
    // page depends on rather than assuming it: no value, no Radix root.
    assert.match(
      stripComments(progressSource),
      /percent === null \?[\s\S]{0,400}role="progressbar"/,
      'the branch with no fraction is the page’s own markup, because Radix’s root cannot stay silent',
    )
    const elapsed = element(releases, 'release-build-since', 'the elapsed time')
    assert.match(elapsed, /^<RelativeTime\b/)
    assert.match(elapsed, /value=\{startedAt\}/, 'elapsed time is the one thing that is known')
  })

  test('the bar appears only while something is building, and ages from a real instant', () => {
    assert.match(releases, /\{startedAt !== null \? \(/, 'no build, no bar')
    assert.match(releases, /release\.status === 'building'/, 'the server’s own status is what says so')
    assert.match(
      releases,
      /\? release\.created_at : oldest/,
      'and the server’s own instant is what it ages from, not this browser’s clock',
    )
    assert.match(
      releases,
      /build\.isPending \? build\.submittedAt : null/,
      'a POST that blocks for the whole build is still a build in flight before the row is visible',
    )
    assert.match(
      releases,
      /refetchInterval:[\s\S]{0,400}build\.isPending/,
      'and the list has to keep polling while that request is open, or the elapsed time stands still',
    )
  })

  // ── The audio budget ──────────────────────────────────────────────────────

  test('the budget bar is determinate, in the two numbers the API sends', () => {
    const bar = element(authoring, 'audio-budget-bar', 'the audio budget bar')
    assert.match(bar, /^<Progress\b/)
    // The call site used to pre-compute `Math.min(100, Math.round(ratio * 100))`
    // against `max={100}`, because Radix's indicator is `translateX(-(100 -
    // value)%)` and `max` never reached the geometry. `progressPercent` does that
    // arithmetic now, including the clamp a spent budget needs — so the page
    // hands over the API's two numbers unaltered and the rounding happens once,
    // in the module that has a unit test for it, instead of at every call site.
    assert.match(bar, /value=\{budget\.used\}/, 'the numerator the API sent, not a percentage of it')
    assert.match(bar, /max=\{budget\.budget\}/, 'and the denominator it sent with it')
    assert.doesNotMatch(bar, /Math\.min\(|Math\.round\(/, 'the clamp lives in progress-value.ts, tested by name')
    assert.doesNotMatch(bar, /since=/, 'a budget is a quantity, not work in progress')
    assert.match(bar, /aria-label=/, 'the bar is named, or a screen reader reads a number with no noun')
    assert.match(bar, /tone=\{budget\.tone\}/, 'and the escalation audio-budget.ts decides is on the bar')
    // The site's own numbers are what answers "can this backfill still run", so
    // they stay on screen next to the percentage rather than being replaced by it.
    assert.match(
      authoring,
      /data-testid="audio-budget-value"[\s\S]{0,320}t\('audio\.budgetValue',[\s\S]{0,200}used: number\(budget\.used\),[\s\S]{0,200}budget: number\(budget\.budget\),[\s\S]{0,200}remaining: number\(budget\.remaining\),/,
      'the characters used, the budget and what is left are all still written out',
    )
    // The escalation is the bar's colour AND a badge. `tone` is asserted above;
    // the badge is here because a tint is not a message — an operator who cannot
    // separate amber from accent still has to be told the budget is nearly gone.
    // Either way it is `audio-budget.ts` that decides when it escalates.
    assert.match(
      authoring,
      /data-testid="audio-budget-tone"[\s\S]{0,120}budget\.tone === 'danger'/,
      'and it escalates where audio-budget.ts says it does',
    )
  })

  test('a site with no budget gets a sentence, not a bar of any kind', () => {
    assert.match(authoring, /\{budget \? \(/, 'the bar is drawn only for a measurable budget')
    assert.match(
      authoring,
      /data-testid="audio-budget-unmeasured"[\s\S]{0,300}t\('audio\.noBudget'\)/,
      'and the count is still on screen when there is nothing to divide it by',
    )
    assert.equal(
      (authoring.match(/<Progress\b/g) ?? []).length,
      1,
      'exactly one bar on this page: an indeterminate second one would read as work in progress',
    )
    assert.match(authoring, /data-testid="audio-budget-spent"/, 'and a spent budget says what it means for a publish')
  })

  test('no library was added for a date or a bar', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'apps', 'cockpit', 'package.json'), 'utf8'))
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
    for (const banned of ['date-fns', 'dayjs', 'luxon', 'moment', 'timeago.js', 'react-datepicker', 'rc-progress']) {
      assert.equal(names.includes(banned), false, `${banned}: Intl and <input type="date"> are already in the browser`)
    }
    // `react-day-picker` is on the list now, and the two lines above and below are
    // one decision rather than two. `shadcn add calendar` installed it, `date-fns`
    // came with it, and the component it installed was imported by nothing while
    // the publication date stayed an `<input type="date">` — so the console was
    // carrying a date library, a calendar library and a dead file for a control it
    // did not use. The alternative was to compose Popover + Calendar into
    // `DateField`, and it was declined on the evidence in this very file: the day a
    // document spells has to survive three time zones (asserted above), which
    // `date-value.ts` does with string arithmetic and no `Date` in local time,
    // whereas react-day-picker selects and reports local `Date` objects and would
    // put a second, differently-reasoned conversion in front of the one that is
    // proven. The native control already opens the platform's own calendar, is
    // localised, is reachable by keyboard on every platform, and costs nothing —
    // and "tt.mm.jjjj", the defect that bought the calendar, is answered where it
    // actually lives: the field prints which of the three states it is in and the
    // caller's `fallback` sentence says what empty does.
    assert.equal(
      names.includes('react-day-picker'),
      false,
      'react-day-picker: the browser’s own date control is what DateField uses, so nothing imports this',
    )
    assert.equal(
      existsSync(join(cockpit, 'components', 'ui', 'calendar.tsx')),
      false,
      'a vendored component nobody imports is two dependencies and a file to keep in step, for no control',
    )
    // And the rule where it actually bites: what the console *imports*. A date
    // library hoisted in underneath something else is a case the manifest check
    // never covered at all.
    for (const [name, text] of sources()) {
      for (const [, imported] of text.matchAll(/from ['"]([^'"]+)['"]/g)) {
        assert.doesNotMatch(
          imported,
          /^(date-fns|@date-fns\/[^'"]+|dayjs|luxon|moment|timeago\.js|react-day-picker)(\/|$)/,
          `${name} imports "${imported}": Intl and <input type="date"> are already in the browser`,
        )
      }
    }
  })
})

/**
 * The statistics tile, called rather than read.
 *
 * Both rules below were previously asserted by slicing an expression out of
 * overview.tsx and matching its text, and that is how the defect survived: the
 * filter dropped a `missing` metric from the tile altogether while a test
 * matching the filter's source went green either way. `usageRatio`
 * (src/stats.mjs) emits `value_state: 'missing'` for every zero denominator, so
 * the input is ordinary. These tests call the functions.
 */
describe('Cockpit statistics tiles: not measured is not zero', behavioural, () => {
  const { visibleMetrics, tileEmptiness, TILE_ROWS } = { ...(logic?.tile ?? {}) }

  test('a metric the server could not measure keeps its row', () => {
    const rows = visibleMetrics([{ name: 'p95', total: null }])
    assert.equal(rows.length, 1, 'a null total is “asked, not measured” — dropping the row says “not asked”')
    assert.equal(rows[0].total, null, 'and it stays null, so the tile can print an em dash')
  })

  test('a real zero is hidden, because a tile of zeroes crowds out what moved', () => {
    assert.deepEqual(visibleMetrics([{ name: 'errors', total: 0 }]), [])
  })

  test('null and zero are not the same input', () => {
    const rows = visibleMetrics([
      { name: 'a', total: 0 },
      { name: 'b', total: null },
      { name: 'c', total: 7 },
    ])
    assert.deepEqual(
      rows.map((row) => row.name),
      ['b', 'c'],
    )
  })

  test('a tile stays a summary', () => {
    const many = Array.from({ length: TILE_ROWS + 3 }, (_, index) => ({ name: `m${index}`, total: index + 1 }))
    assert.equal(visibleMetrics(many).length, TILE_ROWS)
  })

  test('the two emptinesses are two different facts', () => {
    assert.equal(tileEmptiness([]), 'nothing-came-back', 'no metric came back at all')
    assert.equal(
      tileEmptiness([{ total: 0 }, { total: 0 }]),
      'measured-all-zero',
      'zeroes are a measurement; calling them “nothing recorded” claims an absence of evidence',
    )
  })
})
