import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Cockpit's newest primitives, and the logic underneath them.
 *
 * The console has no test runner of its own, so this file works in two halves.
 *
 * The behavioural half drives real code with real values. Every rule worth
 * checking — how a relative label picks its unit, what "unset" means to a date
 * field, where a cursor-paged list is, which palette entries a set of scopes may
 * see — lives in a dependency-free `.ts` module next to its component precisely so
 * that it can be imported and called here instead of asserted about as text.
 * Node reads TypeScript by stripping types, which arrived in 22.6; CI also runs
 * this suite on Node 20, which cannot, so those tests skip there with a reason
 * printed in the TAP output. A skip is visible. A test that silently passed would
 * not be.
 *
 * The structural half runs everywhere and guards the things a pure function
 * cannot: that the palette is the existing dialog holding the existing combobox
 * rather than a sixth hand-rolled overlay, that the exact timestamp is still on
 * screen next to the relative one, that an indeterminate bar reports no
 * percentage, that every control is addressable, and that none of it reached for
 * a new dependency.
 *
 * Only committed files are read. Nothing here touches a generated artefact —
 * apps/cockpit/src/content/site.scoped.css and assets/cockpit/* are absent on a
 * clean checkout, and a test that needed one would fail for the wrong reason.
 */

const here = fileURLToPath(import.meta.url)
const root = dirname(dirname(dirname(here)))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const source = (...parts) => readFileSync(join(cockpit, ...parts), 'utf8')

const ui = (name) => source('components', 'ui', `${name}.tsx`)
const shell = source('app', 'shell.tsx')

/**
 * The behavioural half's imports, attempted once.
 *
 * `process.features.typescript` is the runtime's own answer to "can I import a
 * .ts file"; it is undefined before 22.6. The import is still tried and its
 * failure kept, so a Node that claims the feature and then cannot load these
 * modules fails loudly instead of skipping quietly.
 */
const stripsTypes = typeof process.features.typescript === 'string'
let logic = null
let failure = null
try {
  logic = {
    time: await import('../../apps/cockpit/src/lib/relative-time.ts'),
    cursor: await import('../../apps/cockpit/src/lib/cursor.ts'),
    keyboard: await import('../../apps/cockpit/src/lib/keyboard.ts'),
    palette: await import('../../apps/cockpit/src/lib/palette.ts'),
    date: await import('../../apps/cockpit/src/forms/fields/date-value.ts'),
  }
} catch (error) {
  failure = error
}

const behavioural = {
  skip: logic ? false : `this Node cannot import TypeScript (type stripping landed in 22.6): ${failure?.message}`,
}

describe('Cockpit primitives: the logic behind them', () => {
  test('the modules these tests drive load wherever Node can read TypeScript', () => {
    if (!stripsTypes) {
      assert.equal(logic, null, 'a Node without type stripping cannot have imported them')
      return
    }
    assert.ok(logic, `the behavioural half could not load: ${failure?.stack}`)
  })

  // ── Relative time ──────────────────────────────────────────────────────────

  describe('relative time', behavioural, () => {
    const now = Date.UTC(2026, 6, 30, 12, 0, 0)
    const at = (offset) => new Date(now + offset).toISOString()
    const en = (offset) => logic.time.formatRelative(at(offset), now, 'en')

    test('the unit follows the distance, in both directions', () => {
      assert.equal(en(0), 'now')
      assert.equal(en(-1_000), '1 second ago')
      assert.equal(en(-59_000), '59 seconds ago')
      assert.equal(en(-60_000), '1 minute ago')
      assert.equal(en(-3_600_000), '1 hour ago')
      assert.equal(en(-2 * 3_600_000), '2 hours ago')
      assert.equal(en(-86_400_000), 'yesterday')
      assert.equal(en(-3 * 86_400_000), '3 days ago')
      assert.equal(en(-7 * 86_400_000), 'last week')
      assert.equal(en(-40 * 86_400_000), 'last month')
      assert.equal(en(-400 * 86_400_000), 'last year')
      // A future instant is an ordinary case here: `scheduled_at` is one.
      assert.equal(en(45 * 60_000), 'in 45 minutes')
      assert.equal(en(2 * 3_600_000), 'in 2 hours')
      assert.equal(en(30 * 86_400_000), 'in 4 weeks')
    })

    test('the unit is truncated, so no label claims more time than has passed', () => {
      // 90 seconds is a minute and a half, and "2 minutes ago" is a minute the
      // operator did not have. The same rule is what keeps a build that finished
      // 23 hours 59 minutes ago out of "yesterday", where it would be filed under
      // the wrong day by anyone reading the log.
      assert.deepEqual(logic.time.relativeParts(now - 90_000, now), { value: -1, unit: 'minute' })
      assert.deepEqual(logic.time.relativeParts(now - 86_399_000, now), { value: -23, unit: 'hour' })
      assert.deepEqual(logic.time.relativeParts(now - 59_600, now), { value: -59, unit: 'second' })
      assert.deepEqual(
        logic.time.relativeParts(now - 400, now),
        { value: 0, unit: 'second' },
        'and half a second ago is now',
      )
      assert.deepEqual(logic.time.relativeParts(now + 119_000, now), { value: 1, unit: 'minute' })
      assert.equal(en(-90_000), '1 minute ago')
      assert.equal(en(-86_399_000), '23 hours ago')
    })

    test('the locale is the caller’s, never this module’s', () => {
      const twoHours = at(-2 * 3_600_000)
      assert.equal(logic.time.formatRelative(twoHours, now, 'de'), 'vor 2 Stunden')
      assert.equal(logic.time.formatRelative(twoHours, now, 'en'), '2 hours ago')
      assert.equal(logic.time.formatRelative(twoHours, now, 'fr'), 'il y a 2 heures')
    })

    test('an absent or unreadable instant is null, and never a date', () => {
      for (const value of [null, undefined, '', 'yesterday', 'tt.mm.jjjj', Number.NaN, new Date('nope')]) {
        const shown = JSON.stringify(value) ?? String(value)
        assert.equal(logic.time.formatRelative(value, now, 'en'), null, `formatRelative(${shown})`)
        assert.equal(logic.time.isoInstant(value), null, `isoInstant(${shown})`)
        assert.equal(logic.time.formatExact(value, 'en'), null, `formatExact(${shown})`)
        assert.equal(logic.time.instantOf(value), null, `instantOf(${shown})`)
      }
    })

    test('the exact instant survives the sentence that summarises it', () => {
      const iso = '2026-07-30T09:15:30.000Z'
      assert.equal(logic.time.isoInstant(iso), iso)
      assert.equal(logic.time.isoInstant('2026-07-30T09:15:30Z'), iso, 'the datetime attribute is normalised')
      const exact = logic.time.formatExact(iso, 'en-GB')
      assert.match(exact, /2026/, 'the year is part of the precision')
      // Seconds are zone-invariant — every real offset is a whole number of
      // minutes — so this asserts the seconds are still there without asserting
      // the machine's time zone.
      assert.match(exact, /:30\b/, 'an audit reader needs the second, not the hour')
      assert.doesNotMatch(exact, /ago|in \d/, 'the exact form is not a second relative form')
    })

    test('a live label re-reads the clock at the granularity it prints', () => {
      const { refreshAfter } = logic.time
      assert.ok(refreshAfter('second') <= 1_000, 'a seconds label is wrong a second later')
      assert.ok(refreshAfter('second') < refreshAfter('minute'))
      assert.ok(refreshAfter('minute') < refreshAfter('day'))
      assert.ok(refreshAfter('year') <= 300_000, 'and no label may stop refreshing altogether')
    })
  })

  // ── The date field's unset state ───────────────────────────────────────────

  describe('the date field: unset is a decision, not a blank', behavioural, () => {
    test('empty is unset, unreadable is its own state, and a day is a day', () => {
      const { dateState } = logic.date
      assert.equal(dateState(undefined), 'unset')
      assert.equal(dateState(null), 'unset')
      assert.equal(dateState(''), 'unset')
      assert.equal(dateState('   '), 'unset')
      // Frontmatter can carry `date: yesterday`. Filing that under "empty" would
      // delete an author's line on the next save.
      assert.equal(dateState('yesterday'), 'invalid')
      assert.equal(dateState('tt.mm.jjjj'), 'invalid')
      assert.equal(dateState('2026-07-30T00:00:00.000Z'), 'set')
      assert.equal(dateState('2026-07-30'), 'set')
      // Day-shaped and impossible is unreadable, not a day: `new Date` answers the
      // 3rd of March for this one, so calling it "set" would show, and then save, a
      // day the author never wrote.
      assert.equal(dateState('2026-02-31'), 'invalid')
      assert.equal(dateState('2027-02-29'), 'invalid')
    })

    test('an unset date round-trips through the control as unset', () => {
      const { fromDayInput, toDayInput } = logic.date
      assert.equal(toDayInput(undefined), '')
      assert.equal(toDayInput(null), '')
      assert.equal(toDayInput(''), '')
      assert.equal(toDayInput('yesterday'), '', 'the control cannot show a value it cannot parse')
      assert.equal(fromDayInput(''), undefined)
      assert.equal(fromDayInput('   '), undefined)
      assert.equal(fromDayInput('2026-07'), undefined, 'a half-typed date is not a date')
    })

    test('a chosen day round-trips in the operator’s own zone', () => {
      const { dateState, fromDayInput, toDayInput } = logic.date
      const chosen = fromDayInput('2026-07-30')
      // The literal, not just "truthy": an instant spelling would satisfy `ok` and
      // would still be the day here, since toDayInput reads midnight UTC as a day.
      assert.equal(chosen, '2026-07-30', 'a real day produces the day itself')
      assert.equal(dateState(chosen), 'set')
      assert.equal(toDayInput(chosen), '2026-07-30', 'the day the operator picked is the day they see')
      assert.equal(toDayInput(fromDayInput('2028-02-29')), '2028-02-29', 'including a leap day')
    })

    test('a day and a moment are told apart, because they are not the same value', () => {
      const { isDayOnly } = logic.date
      // `date: 2026-07-30` names a day: no time of day, and no zone it was written
      // in. So does the instant the API writes in its place — parseIsoDate in
      // src/utils.mjs normalises that line to exactly '2026-07-30T00:00:00.000Z' —
      // and so does any other spelling of that same instant, because the rule
      // date-value.ts chose is about the instant rather than about the text. The one
      // thing the text has to do is name a complete calendar day; the bucket below
      // is where that matters.
      for (const day of [
        '2026-07-30',
        '2028-02-29',
        '2000-02-29',
        ' 2026-07-30 ',
        '2026-07-30T00:00:00.000Z',
        '2026-07-30T00:00:00Z',
        '2026-01-01T00:00:00.000Z',
        '2026-07-30T02:00:00+02:00',
        '2026-07-30 00:00:00Z',
      ]) {
        assert.equal(isDayOnly(day), true, `isDayOnly(${JSON.stringify(day)})`)
      }
      // A moment has a time of day of its own, and therefore a local day worth
      // computing. One millisecond past midnight UTC is one of them: that is the
      // discontinuity the rule costs, and it is pinned two tests below.
      for (const moment of [
        '2026-07-30T09:00:00+02:00',
        '2026-07-30T23:30:00.000Z',
        '2026-07-30T00:00:00.001Z',
        '2026-07-29T23:59:59.999Z',
      ]) {
        assert.equal(isDayOnly(moment), false, `isDayOnly(${moment})`)
      }
      // Neither a day nor a moment. `2026-07` and `2026` are the ones the rule has
      // to be careful about: `Date.parse` reads both as midnight UTC, and a value
      // that never named a day must not be answered with the 1st of the month.
      for (const neither of ['', '   ', 'yesterday', '2026-07', '2026', '2026-02-31', '2027-02-29', null, undefined]) {
        assert.equal(isDayOnly(neither), false, `isDayOnly(${JSON.stringify(neither) ?? String(neither)})`)
      }
    })

    /**
     * The zones are pinned rather than inherited: CI runs in UTC, where every one of
     * these is invisible. 23:30Z is already the next day in Kiritimati (+14) and
     * still the same day in Los Angeles (-7), and a negative offset is the case that
     * moved a date-only value a day backwards.
     */
    const ZONES = [
      { zone: 'Pacific/Kiritimati', lateEveningIsThe: '2026-07-31' },
      { zone: 'America/Los_Angeles', lateEveningIsThe: '2026-07-30' },
      { zone: 'UTC', lateEveningIsThe: '2026-07-30' },
    ]
    const LATE_EVENING = '2026-07-30T23:30:00.000Z'

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

    test('a moment is shown as the operator’s local day, in whatever zone they are in', () => {
      const { fromDayInput, toDayInput } = logic.date
      for (const { zone, lateEveningIsThe } of ZONES) {
        inZone(zone, () => {
          assert.equal(toDayInput(LATE_EVENING), lateEveningIsThe, zone)
          assert.equal(
            toDayInput(fromDayInput(lateEveningIsThe, LATE_EVENING)),
            lateEveningIsThe,
            `${zone}: and editing the day keeps the day`,
          )
        })
      }
    })

    /**
     * The spellings one calendar day arrives in, and what each must do.
     *
     * `date: 2026-07-30` is how an author writes a day, and UTC midnight by
     * specification — shifting it into local time showed the 29th to every operator
     * west of Greenwich, and any interaction then wrote the 29th back. The instants
     * are that same line after the API has had it: `parseIsoDate` (src/utils.mjs,
     * called from src/markdown.mjs) normalises `date`, `scheduledAt` and `updatedAt`
     * to `new Date(value).toISOString()`, so `…T00:00:00.000Z` is the spelling every
     * API round trip and every generating tool hands back, and reading it as a local
     * moment is the same bug — a day out, and on the January row a whole year out.
     *
     * `back` is what an edit must return: the day it spells, in the spelling it
     * arrived in, so that a save does not rewrite the document's shape and no zone
     * can move the day.
     */
    const DAY_SPELLINGS = [
      { value: '2026-07-30', day: '2026-07-30', back: '2026-07-30' },
      { value: '2026-07-30T00:00:00.000Z', day: '2026-07-30', back: '2026-07-30T00:00:00.000Z' },
      { value: '2026-01-01T00:00:00.000Z', day: '2026-01-01', back: '2026-01-01T00:00:00.000Z' },
    ]

    test('every spelling of a day is the day it spells, in every zone', () => {
      const { dateState, fromDayInput, isDayOnly, toDayInput } = logic.date
      for (const { zone } of ZONES) {
        inZone(zone, () => {
          for (const { value, day, back } of DAY_SPELLINGS) {
            const where = `${zone}: ${value}`
            assert.equal(dateState(value), 'set', `${where}: it is a date`)
            assert.equal(isDayOnly(value), true, `${where}: and it names a day, not a moment`)
            assert.equal(toDayInput(value), day, `${where}: the control shows the day the document spells`)
            assert.equal(fromDayInput(day, value), back, `${where}: and an edit keeps day and spelling both`)
            // What the control shows, handed straight back, is what was already
            // there: touching the field must not move the document.
            const round = fromDayInput(toDayInput(value), value)
            assert.equal(round, back, `${where}: a round trip through the control is an identity`)
            assert.equal(Date.parse(round), Date.parse(value), `${where}: down to the instant`)
          }
        })
      }
    })

    /**
     * What the UTC-midnight rule costs, in numbers rather than in prose: one
     * millisecond later the value is an ordinary moment again and is shown as its
     * own local day, which in Los Angeles is the 29th. `isDayOnly` says this out
     * loud; if the rule is ever widened or narrowed, this is where it is noticed.
     */
    test('one millisecond after midnight UTC is a moment again, with the local day that implies', () => {
      const { fromDayInput, isDayOnly, toDayInput } = logic.date
      const value = '2026-07-30T00:00:00.001Z'
      const localDays = { 'Pacific/Kiritimati': '2026-07-30', 'America/Los_Angeles': '2026-07-29', UTC: '2026-07-30' }
      assert.equal(isDayOnly(value), false, 'a real instant at 00:00:00.001Z is a moment')
      for (const { zone } of ZONES) {
        inZone(zone, () => {
          assert.equal(toDayInput(value), localDays[zone], `${zone}: the moment's own local day`)
          // And it keeps its time of day across an edit, which is the moment rule.
          assert.equal(new Date(fromDayInput('2026-08-01', value)).getMilliseconds(), 1, `${zone}: to the millisecond`)
        })
      }
    })

    test('today is the operator’s day, counted from an instant that is passed in', () => {
      const { isDayOnly, todayInput } = logic.date
      const lateEvening = Date.parse(LATE_EVENING)
      for (const { zone, lateEveningIsThe } of ZONES) {
        inZone(zone, () => {
          assert.equal(todayInput(lateEvening), lateEveningIsThe, `${zone}: at 23:30Z the operator’s day is their own`)
          assert.equal(isDayOnly(todayInput(lateEvening)), true, `${zone}: and it is a day, not a local midnight`)
        })
      }
    })

    /**
     * Midnight UTC is the one instant where "the operator's day" and "the day this
     * value spells" disagree, and "Today" has to answer the first: at 00:00Z it is
     * still the 29th in Los Angeles, so a quick set that answered the UTC day would
     * date the document tomorrow. `todayInput` therefore computes the local day
     * itself instead of borrowing `toDayInput`, which reads that instant as a day.
     */
    test('today is still the operator’s day when the clock reads exactly midnight UTC', () => {
      const { todayInput } = logic.date
      const utcMidnight = Date.parse('2026-07-30T00:00:00.000Z')
      const localDays = { 'Pacific/Kiritimati': '2026-07-30', 'America/Los_Angeles': '2026-07-29', UTC: '2026-07-30' }
      for (const { zone } of ZONES) {
        inZone(zone, () => assert.equal(todayInput(utcMidnight), localDays[zone], zone))
      }
    })

    test('a day comes back as a day; a moment keeps its time of day', () => {
      const { fromDayInput, isDayOnly } = logic.date
      assert.equal(fromDayInput('2026-08-01'), '2026-08-01', 'nothing was there, so no time of day is invented')
      assert.equal(fromDayInput('2026-08-01', '2026-07-30'), '2026-08-01', 'a day has no time of day to carry')
      assert.equal(fromDayInput('2026-08-01', 'yesterday'), '2026-08-01', 'and an unreadable value has none either')
      assert.equal(isDayOnly(fromDayInput('2026-08-01', '2026-07-30')), true)
      assert.equal(
        isDayOnly(fromDayInput('2026-08-01', '2026-07-30T09:15:00.000Z')),
        false,
        'a moment edited on the day control stays a moment — the next test is the time it keeps',
      )
    })

    test('the time of day is carried across an edit rather than reset', () => {
      const { fromDayInput, toDayInput } = logic.date
      const nineFifteen = new Date(2026, 6, 30, 9, 15, 0).toISOString()
      const moved = fromDayInput('2026-08-01', nineFifteen)
      assert.equal(toDayInput(moved), '2026-08-01')
      const carried = new Date(moved)
      assert.equal(carried.getHours(), 9, 'correcting the day must not move a 09:00 publication to midnight')
      assert.equal(carried.getMinutes(), 15)
    })

    test('an impossible day is refused instead of rolled over', () => {
      const { fromDayInput, toDayInput } = logic.date
      assert.equal(fromDayInput('2026-02-31'), undefined, 'a Date would have answered the 3rd of March')
      assert.equal(fromDayInput('2026-04-31'), undefined, 'April has thirty days')
      assert.equal(fromDayInput('2026-01-32'), undefined)
      assert.equal(fromDayInput('2026-01-00'), undefined)
      assert.equal(fromDayInput('2026-13-01'), undefined)
      assert.equal(fromDayInput('2026-00-10'), undefined)
      // The leap rule in full, because every wrong version of it is wrong on one of
      // these four years and right on the other three.
      assert.equal(fromDayInput('2028-02-29'), '2028-02-29', 'divisible by four')
      assert.equal(fromDayInput('2027-02-29'), undefined, 'not divisible by four')
      assert.equal(fromDayInput('2100-02-29'), undefined, 'a century that is not divisible by 400')
      assert.equal(fromDayInput('2000-02-29'), '2000-02-29', 'and one that is')
      // The same day arriving from the document rather than from the control: the
      // author's line is kept, and the control shows nothing rather than March.
      assert.equal(toDayInput('2026-02-31'), '', 'the control cannot show a day that does not exist')
    })

    test('the counted-forward sets are an expiry’s, and Never is the unset state', () => {
      // These are `DateTimeField`'s, where "Never" is true because the sentence under
      // that control is "Unset means no expiry." `DateField` offers none of them: a
      // publication date thirty days out sorts above everything that was published.
      const { DATE_PRESETS, presetInstant } = logic.date
      assert.deepEqual(
        DATE_PRESETS.map((preset) => [preset.label, preset.days]),
        [
          ['30 days', 30],
          ['90 days', 90],
          ['365 days', 365],
          ['Never', null],
        ],
      )
      const now = Date.UTC(2026, 6, 30, 12, 0, 0)
      assert.equal(presetInstant(null, now), undefined, 'Never is the unset state, not a date in 9999')
      assert.equal(presetInstant(30, now), '2026-08-29T12:00:00.000Z')
      assert.equal(presetInstant(365, now), '2027-07-30T12:00:00.000Z')
    })
  })

  // ── Cursor pagination ──────────────────────────────────────────────────────

  describe('cursor pagination: forward is answered, back is remembered', behavioural, () => {
    test('the first page has nowhere back, and only a response says forward', () => {
      const { firstPage, hasNext, hasPrevious, pageNumber } = logic.cursor
      assert.equal(pageNumber(firstPage), 1)
      assert.equal(hasPrevious(firstPage), false)
      assert.equal(firstPage.cursor, null)
      assert.equal(hasNext(null), false)
      assert.equal(hasNext(undefined), false)
      assert.equal(hasNext(''), false, 'an empty cursor is not a cursor')
      assert.equal(hasNext('c2'), true)
    })

    test('walking forward and back returns the cursors that were spent', () => {
      const { firstPage, nextPage, pageNumber, previousPage } = logic.cursor
      const second = nextPage(firstPage, 'c2')
      const third = nextPage(second, 'c3')
      assert.equal(third.cursor, 'c3')
      assert.equal(pageNumber(third), 3)
      const backToSecond = previousPage(third)
      assert.equal(backToSecond.cursor, 'c2', 'keyset pages have no cursor for "previous" — it is remembered')
      assert.equal(pageNumber(backToSecond), 2)
      const backToFirst = previousPage(backToSecond)
      assert.equal(backToFirst.cursor, null)
      assert.deepEqual(backToFirst, firstPage)
    })

    test('the end of the list and a double click both leave the page alone', () => {
      const { firstPage, nextPage, previousPage } = logic.cursor
      const second = nextPage(firstPage, 'c2')
      assert.equal(nextPage(second, null), second, 'no next cursor is not a next page')
      assert.equal(nextPage(second, undefined), second)
      // `next_cursor` still names this page until the new response lands, so a
      // second click would otherwise push the same cursor twice and make Previous
      // walk back through a page nobody saw.
      assert.equal(nextPage(second, 'c2'), second, 'the cursor already open must not be pushed twice')
      assert.equal(previousPage(firstPage), firstPage)
    })

    test('a filter change starts over instead of reusing a foreign cursor', () => {
      const { firstPage, nextPage, resetPage } = logic.cursor
      const deep = nextPage(nextPage(firstPage, 'c2'), 'c3')
      assert.deepEqual(resetPage(), firstPage)
      assert.notDeepEqual(resetPage(), deep)
    })

    test('nothing here can answer how many pages there are', () => {
      // The endpoints report `next_cursor` and no total, so this state must never
      // grow one: a page count on screen that was counted client-side is a number
      // the server never said.
      assert.deepEqual(Object.keys(logic.cursor.firstPage).sort(), ['cursor', 'seen'])
      assert.deepEqual(
        Object.keys(logic.cursor).filter((name) => /total|count|pages$/i.test(name)),
        [],
      )
    })
  })

  // ── The palette's scope filter ─────────────────────────────────────────────

  describe('the command palette offers only what the session may reach', behavioural, () => {
    const PAGES = [
      { to: '/', label: 'Overview', scope: 'stats:read' },
      { to: '/content', label: 'Content', scope: 'content:read' },
      { to: '/credentials', label: 'Credentials', scope: 'api-key:admin' },
      { to: '/system', label: 'System', scope: null },
    ]
    const SITES = [
      { slug: 'blog', name: 'Blog' },
      { slug: 'docs', name: 'Docs' },
    ]
    const ITEMS = [
      { id: 'i1', title: 'Hello', slug: 'hello', translation_key: 'hello', kind: 'post', locale: 'en' },
      { id: 'i2', title: null, slug: null, translation_key: 'no-revision-yet', kind: 'page', locale: 'de' },
    ]

    function build(scopes, over = {}) {
      const ran = []
      const targets = logic.palette.paletteTargets({
        pages: PAGES,
        sites: SITES,
        items: ITEMS,
        scopes,
        site: 'blog',
        goTo: (to) => ran.push(`go:${to}`),
        pickSite: (slug) => ran.push(`site:${slug}`),
        ...over,
      })
      return { targets, ran, labels: targets.map((target) => target.label) }
    }

    test('an entry appears only when the session holds its one exact scope', () => {
      const { labels } = build(['content:read'])
      assert.deepEqual(labels, ['Content', 'System', 'Blog', 'Docs', 'Hello', 'no-revision-yet'])
      assert.ok(!labels.includes('Overview'), 'stats:read is not held')
      assert.ok(!labels.includes('Credentials'), 'api-key:admin is not held')
    })

    test('a session with no scopes at all is offered only what needs none', () => {
      const { labels } = build([])
      assert.deepEqual(labels, ['System', 'Blog', 'Docs'])
    })

    test('no scope is implied by another — authorize() has no hierarchy', () => {
      // content:write is what the editor needs; it does not carry content:read,
      // and site:admin carries nothing at all.
      const write = build(['content:write']).labels
      assert.ok(!write.includes('Content'), 'content:write must not open a content:read page')
      assert.ok(!write.includes('Hello'), 'nor offer the items behind it')
      const admin = build(['site:admin']).labels
      assert.deepEqual(admin, ['System', 'Blog', 'Docs'])
    })

    test('the items carry the content page’s scope, read off the table', () => {
      const withScope = build(['content:read']).targets.filter((target) => target.group === 'Content')
      assert.deepEqual(
        withScope.map((target) => target.scope),
        ['content:read', 'content:read'],
      )
      // With no content page in the table there is no scope to check against, and
      // the answer to that is to offer nothing rather than to guess one.
      const withoutPage = build(['content:read'], { pages: PAGES.filter((page) => page.to !== '/content') })
      assert.deepEqual(withoutPage.labels, ['System', 'Blog', 'Docs'])
    })

    test('the switcher entries need no scope, because the list already answered that', () => {
      const sites = build(['content:read']).targets.filter((target) => target.group === 'Site')
      assert.deepEqual(
        sites.map((target) => target.scope),
        [null, null],
      )
      assert.match(sites[0].hint, /current/, 'the site already selected says so')
      assert.doesNotMatch(sites[1].hint, /current/)
      // A site the credential cannot read is not in the list it was given, so it
      // cannot be in the palette either.
      assert.deepEqual(build(['content:read'], { sites: [] }).labels, ['Content', 'System', 'Hello', 'no-revision-yet'])
    })

    test('choosing an entry does the one thing it named', () => {
      const page = build(['content:read'])
      page.targets.find((target) => target.label === 'Content').run()
      assert.deepEqual(page.ran, ['go:/content'])

      const site = build(['content:read'])
      site.targets.find((target) => target.label === 'Docs').run()
      assert.deepEqual(site.ran, ['site:docs'])

      const item = build(['content:read'])
      item.targets.find((target) => target.label === 'Hello').run()
      assert.deepEqual(item.ran, ['go:/content'], 'an item is reachable through the list that holds it')
    })

    test('every id is unique, so one keystroke cannot mean two things', () => {
      const { targets } = build(['content:read', 'stats:read', 'api-key:admin'])
      assert.equal(new Set(targets.map((target) => target.id)).size, targets.length)
    })

    test('the offer is bounded — the content endpoint has no limit parameter', () => {
      const many = Array.from({ length: logic.palette.MAX_CONTENT_TARGETS + 50 }, (_unused, index) => ({
        id: `i${index}`,
        title: `Item ${index}`,
        slug: `item-${index}`,
        translation_key: `item-${index}`,
        kind: 'post',
        locale: 'en',
      }))
      const { targets } = build(['content:read'], { items: many })
      const items = targets.filter((target) => target.group === 'Content')
      assert.equal(items.length, logic.palette.MAX_CONTENT_TARGETS)
    })

    test('the gate itself passes a scopeless target and nothing else unheld', () => {
      const { reachable } = logic.palette
      const targets = [
        { id: 'a', label: 'a', group: 'Page', scope: null, run: () => {} },
        { id: 'b', label: 'b', group: 'Page', scope: 'audit:read', run: () => {} },
      ]
      assert.deepEqual(
        reachable(targets, []).map((target) => target.id),
        ['a'],
      )
      assert.deepEqual(
        reachable(targets, ['audit:read']).map((target) => target.id),
        ['a', 'b'],
      )
    })
  })

  // ── The shortcut ───────────────────────────────────────────────────────────

  describe('the shortcut matches the platform it is printed on', behavioural, () => {
    test('Apple hardware is recognised from either half of navigator', () => {
      const { isApplePlatform, modifierLabel } = logic.keyboard
      assert.equal(isApplePlatform({ platform: 'MacIntel' }), true)
      assert.equal(isApplePlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), true)
      assert.equal(isApplePlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64)' }), false)
      assert.equal(isApplePlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), false)
      assert.equal(isApplePlatform({}), false)
      assert.equal(modifierLabel(true), '⌘')
      assert.equal(modifierLabel(false), 'Ctrl')
    })

    test('only the platform’s own chord opens the palette', () => {
      const { isShortcut } = logic.keyboard
      assert.equal(isShortcut({ key: 'k', metaKey: true }, 'k', true), true)
      assert.equal(isShortcut({ key: 'K', metaKey: true }, 'k', true), true, 'the key case is not the chord')
      assert.equal(isShortcut({ key: 'k', ctrlKey: true }, 'k', false), true)
      // Ctrl+K on a Mac is "delete to end of line" in every text field, and ⌘ does
      // not exist on the other platforms. Claiming the wrong one takes a shortcut
      // away from the operator.
      assert.equal(isShortcut({ key: 'k', ctrlKey: true }, 'k', true), false)
      assert.equal(isShortcut({ key: 'k', metaKey: true }, 'k', false), false)
      assert.equal(isShortcut({ key: 'k' }, 'k', false), false, 'a bare letter is what is being typed')
      assert.equal(isShortcut({ key: 'k', ctrlKey: true, shiftKey: true }, 'k', false), false)
      assert.equal(isShortcut({ key: 'k', ctrlKey: true, altKey: true }, 'k', false), false)
      assert.equal(isShortcut({ key: 'k', metaKey: true, ctrlKey: true }, 'k', true), false)
      assert.equal(isShortcut({ key: 'j', metaKey: true }, 'k', true), false)
    })
  })
})

// ── What only the sources can be asked ───────────────────────────────────────

const OWNED = [
  ['components/ui/skeleton.tsx', ui('skeleton')],
  ['components/ui/spinner.tsx', ui('spinner')],
  ['components/ui/progress.tsx', ui('progress')],
  ['components/ui/pagination.tsx', ui('pagination')],
  ['components/ui/command-palette.tsx', ui('command-palette')],
  ['components/ui/kbd.tsx', ui('kbd')],
  ['components/ui/dropzone.tsx', ui('dropzone')],
  ['components/ui/relative-time.tsx', ui('relative-time')],
  ['forms/fields/date.tsx', source('forms', 'fields', 'date.tsx')],
]

/**
 * Comments go first. The components document how they are meant to be called, and
 * a `<Button>` in an example is not a control anybody can click.
 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** An opening tag, stopping at the tag's own `>` and not at an arrow function's. */
const openingTags = (text, tag) =>
  [...stripComments(text).matchAll(new RegExp(`<${tag}\\b(?:[^>]|=>)*>`, 'g'))].map((hit) => hit[0])

/**
 * Every place the console renders `<Tag …>`, with the file it is in.
 *
 * Two of the rules below are now enforced by the component itself — shadcn's
 * `Spinner` carries its own `role="status"`, Radix's `Progress` its own ARIA —
 * which moves what can still go wrong out to the call sites. Reading the
 * component's source would no longer see it, so this walks the console instead
 * of naming files: a component used correctly in eight places and wrongly in a
 * ninth is exactly the defect a fixed list misses.
 *
 * Only `.tsx` under apps/cockpit/src, all of it committed source. The generated
 * artefacts are a stylesheet and a bundle, neither of which is a component.
 */
const callSites = (tag) => {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx'))
        for (const opening of openingTags(readFileSync(full, 'utf8'), tag))
          found.push([full.slice(cockpit.length + 1), opening])
    }
  }
  walk(cockpit)
  return found
}

describe('Cockpit primitives: what the sources have to say', () => {
  test('every control is addressable in the browser', () => {
    // The standing rule for this console. A spread of `control` or `props` counts:
    // FieldShell hands the testid down that way, and a regex cannot see through it.
    for (const [name, text] of OWNED) {
      for (const tag of ['button', 'Button', 'input', 'Input', 'label']) {
        for (const opening of openingTags(text, tag)) {
          assert.ok(
            /data-testid|\{\.\.\.(?:control|props)\}/.test(opening),
            `${name} renders a <${tag}> with no data-testid: ${opening.slice(0, 80)}…`,
          )
        }
      }
    }
  })

  test('nothing new reached for a dependency the console does not already have', () => {
    const dependencies = new Set(
      Object.keys(JSON.parse(readFileSync(join(root, 'apps', 'cockpit', 'package.json'), 'utf8')).dependencies ?? {}),
    )
    // Both quote styles: the shadcn files are formatted with double quotes, so a
    // check that only read single ones would have gone quiet over exactly the
    // files that introduced the new dependencies.
    for (const [name, text] of OWNED) {
      for (const [, imported] of text.matchAll(/from ['"]([^'"]+)['"]/g)) {
        if (imported.startsWith('@/') || imported.startsWith('.')) continue
        const owner = imported.startsWith('@') ? imported.split('/').slice(0, 2).join('/') : imported.split('/')[0]
        assert.ok(dependencies.has(owner), `${name} imports "${imported}", which is not a Cockpit dependency`)
      }
    }
  })

  test('the palette is cmdk’s CommandDialog, and the two hacks it replaced stay gone', () => {
    // Comment-stripped: this component documents the two hacks it replaced, and
    // a `requestAnimationFrame` written in prose to say it is gone would read as
    // one that is still there.
    const palette = stripComments(ui('command-palette'))
    // It used to be a Combobox inside a Dialog, and it paid for the mismatch
    // twice. The combobox's listbox is an absolutely positioned sibling and the
    // dialog panel clips its overflow, so the panel reserved a fixed height it
    // could not need; and the dialog focuses its own close button first, so the
    // caret had to be moved onto the input a frame later with
    // requestAnimationFrame. cmdk's Command owns the input, the list and the
    // selection together — the list is inside the panel and the input is the
    // panel's first focusable — so both hacks are gone rather than rewritten,
    // and this is where they stay gone.
    assert.match(palette, /from '\.\/command'/, 'Escape, the focus trap, typing, the arrows and Enter are all there')
    assert.doesNotMatch(
      palette,
      /from '\.\/combobox'/,
      'a listbox that cannot leave the panel is the arrangement both hacks existed for',
    )
    assert.doesNotMatch(
      palette,
      /requestAnimationFrame/,
      'cmdk’s input is the panel’s first focusable, so nothing has to place the caret a frame later',
    )
    assert.doesNotMatch(
      palette,
      /className="h-\[/,
      'the list no longer escapes the panel, so the panel must not reserve a height for it',
    )
    assert.doesNotMatch(palette, /fixed inset-0/, 'a second overlay would be a second set of the same two bugs')
    assert.doesNotMatch(palette, /addEventListener\('keydown'[\s\S]*Escape/, 'Escape is the dialog’s to handle')

    // A cmdk item may only live inside a group, and a palette that matches
    // nothing has to say so rather than showing an empty box.
    assert.match(palette, /<CommandEmpty\b/, 'a palette that matches nothing must say nothing matches')
    const groupStart = palette.indexOf('<CommandGroup')
    const groupEnd = palette.lastIndexOf('</CommandGroup>')
    assert.ok(groupStart !== -1 && groupEnd !== -1, 'the three kinds of destination are three CommandGroups')
    const itemStart = palette.indexOf('<CommandItem')
    assert.ok(
      itemStart > groupStart && itemStart < groupEnd,
      'every CommandItem sits inside its CommandGroup — three kinds of destination in one ungrouped list read ' +
        'as one kind',
    )
  })

  test('the palette is mounted with a hint an operator can see', () => {
    assert.match(shell, /from '@\/components\/ui\/command-palette'/, 'the palette is mounted in the shell')
    assert.match(shell, /<CommandPalette\b[^>]*pages=\{NAV\}/, 'and is passed the whole table, not the filtered list')
    assert.match(ui('command-palette'), /<Shortcut\b/, 'an invisible shortcut is not a feature')
    assert.match(ui('kbd'), /<kbd\b/, 'the hint is a real <kbd>, so it reads as a key')
    assert.match(ui('command-palette'), /-open`/, 'the trigger is addressable')
  })

  test('the palette applies the scope filter itself', () => {
    // The one place an entry can be offered is the one place it is checked. A
    // palette handed a pre-filtered list would be a second rule to keep in step.
    assert.match(ui('command-palette'), /paletteTargets\(/)
    assert.doesNotMatch(ui('command-palette'), /\.role\b/, 'a role is not a scope')
  })

  test('the relative label never replaces the instant it summarises', () => {
    const relative = ui('relative-time')
    assert.match(relative, /<time\b/, 'a relative label belongs in a <time> element')
    assert.match(relative, /dateTime=\{iso\}/, 'with the machine-readable instant on it')
    // "Within reach of the pointer" was the old wording, and a native
    // `title={formatExact(…)}` was the old mechanism. It is within reach of a
    // pointer and of nothing else, which is what the console-wide rule in
    // cockpit-forms-density.test.mjs forbids; the instant now lives in a Tooltip
    // whose trigger is a tab stop, so hover, focus and tap all reach it.
    assert.match(relative, /formatExact\(value\)/, 'and the exact instant is still computed')
    assert.match(relative, /<TooltipTrigger asChild>/, 'hung on a real trigger')
    assert.match(relative, /<TooltipContent[^>]*>\{exact\}<\/TooltipContent>/, 'that opens onto it')
    assert.doesNotMatch(relative, /\btitle=/, 'and never on a native title')
    assert.doesNotMatch(relative, /'de'|'en'|'de-DE'|'en-US'/, 'the locale is the browser’s')
  })

  test('an indeterminate bar reports no percentage to anyone', () => {
    // The claim is unchanged; where it is kept moved twice. It was a hand-rolled
    // bar that tied all three ARIA numbers to its own `fraction`; then it was
    // Radix's primitive, which cannot keep the claim on its own, because its root
    // emits `role="progressbar"`, `aria-valuemin` and `aria-valuemax`
    // unconditionally and drops only `aria-valuenow` — a bar with no value still
    // reports a maximum for a quantity nobody measured. So `ui/progress.tsx` picks
    // the form first (`progress-value.ts`, called for real in
    // cockpit-dates-progress.test.mjs) and Radix draws only the determinate one.
    const progress = stripComments(ui('progress'))
    assert.match(progress, /from ['"]radix-ui['"]/, 'a fraction that exists is Radix’s bar, not markup of ours')
    assert.match(progress, /<ProgressPrimitive\.Root/, 'and the root that carries its ARIA is Radix’s')
    for (const attribute of ['aria-valuenow', 'aria-valuemin', 'aria-valuemax']) {
      assert.doesNotMatch(progress, new RegExp(attribute), `${attribute} is never written here: see the test above`)
    }
    // `role="progressbar"` is the one piece of that vocabulary this file does
    // write, and only on the branch Radix cannot serve: a progressbar with no
    // `aria-valuenow` is ARIA's own spelling of "busy, no idea how far", which is
    // the whole point. It appears once, so there is one place it can be wrong.
    assert.equal(
      (progress.match(/role="progressbar"/g) ?? []).length,
      1,
      'the determinate bar must not restate the role Radix already emits',
    )
    const bars = callSites('Progress')
    assert.ok(bars.length > 0, 'no <Progress> found anywhere, so this test proves nothing')
    for (const [name, opening] of bars) {
      // A bar has to be about something. With a fraction it draws it; without one
      // it may still say how long the work has been running, which is the one fact
      // unknown-duration work has — but a bar that says neither is decoration
      // pulsing where a status should be.
      assert.ok(
        /\bvalue=\{/.test(opening) || /\bsince=\{/.test(opening),
        `${name} draws a bar that reports neither a fraction nor an elapsed time: ${opening.slice(0, 80)}…`,
      )
    }
  })

  test('the skeleton announces once and the spinner is never a second voice', () => {
    assert.match(ui('skeleton'), /role="status"/, 'a placeholder nobody is told about is a silent one')
    assert.match(ui('skeleton'), /aria-hidden="true"/, 'and the shapes themselves are not read out one by one')
    // The spinner has two forms, and the component is what chooses between them:
    // a standalone one that announces, and an in-button one that stays quiet.
    // Stock shadcn's is one icon carrying `role="status"` and a hardcoded
    // `aria-label="Loading"` (`npx shadcn@latest docs spinner`), which announces
    // "Loading" beside a button that already says `Revoke key` — the second voice
    // this test is named after. So the icon is always `aria-hidden`, and the
    // announcement is a sentence the caller supplies.
    const spinner = stripComments(ui('spinner'))
    assert.match(spinner, /role="status"/, 'the spinner still announces itself where it stands alone')
    assert.match(spinner, /<span className="sr-only">\{announcement\}<\/span>/, 'with the caller’s noun, not "Loading"')
    assert.match(spinner, /const announcement = label \?\? ariaLabel/, 'named by either spelling of the same claim')
    assert.match(spinner, /if \(!announcement\) return icon/, 'and unnamed, it is a picture and nothing else')
    assert.doesNotMatch(
      spinner,
      /aria-label="Loading"/,
      'a label the component invents cannot say what is loading, and says it in the wrong language',
    )
    assert.match(
      spinner,
      /aria-hidden="true"/,
      'the icon is never read out: either the sr-only text is, or words beside it',
    )
    assert.equal(openingTags(spinner, 'Loader2Icon').length, 1, 'and there is one icon, so one place to change it')
    assert.match(spinner, /SIZES\[size\]/, 'the second form is a size, because pagination.tsx asks for the small one')
    const spinners = callSites('Spinner')
    assert.ok(spinners.length > 0, 'no <Spinner> found anywhere, so this test proves nothing')
    for (const [name, opening] of spinners) {
      // The rule used to be that every call site must carry `aria-hidden` or a
      // name, because stock shadcn's spinner announced "Loading" by itself and a
      // caller who forgot got a second voice beside their button. The component
      // above makes silence the default, so a bare `<Spinner data-icon="…" />` in
      // a button is now the correct shape — which leaves exactly one thing a call
      // site can still get wrong, and this is it: naming a spinner and hiding it
      // in the same breath, which is a sentence written for a reader who is then
      // told not to read it.
      assert.ok(
        !(/\baria-label=|\blabel=/.test(opening) && /aria-hidden="true"/.test(opening)),
        `${name} names a Spinner it also hides, so the name is announced to nobody: ${opening}`,
      )
    }
  })

  test('the dropzone is a real file input, not a div with a click handler', () => {
    // Comment-stripped: this component documents the markup it replaces, and a
    // `<input type="file">` written in prose is not one anybody can drop onto.
    const dropzone = stripComments(ui('dropzone'))
    assert.match(dropzone, /type="file"/, 'drag and drop is unreachable by keyboard on its own')
    assert.match(dropzone, /<label\b/, 'the drop surface is the input’s label, so Tab and Space reach it')
    assert.match(dropzone, /onDrop=/)
    assert.match(dropzone, /preventDefault\(\)/, 'or the browser navigates away to the dropped file')
    // There is no asset upload endpoint in docs/openapi.json; inventing a call
    // would be a control that fails after the file was already dropped.
    assert.doesNotMatch(dropzone, /\bck\./, 'the dropzone must not invent an upload endpoint')
  })

  test('no asset upload endpoint exists to point the dropzone at', () => {
    // The finding this component was built around, asserted rather than
    // remembered: if one ever lands, this test is where it is noticed.
    const spec = JSON.parse(readFileSync(join(root, 'docs', 'openapi.json'), 'utf8'))
    const multipart = []
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const content = operation?.requestBody?.content ?? {}
        if (Object.keys(content).some((type) => type.startsWith('multipart/'))) {
          multipart.push(`${method.toUpperCase()} ${path}`)
          const parts = Object.keys(content['multipart/form-data']?.schema?.properties ?? {})
          assert.deepEqual(parts, ['document'], `${method.toUpperCase()} ${path} takes parts this test has not seen`)
        }
      }
    }
    assert.deepEqual(
      multipart.sort(),
      ['POST /v1/sites/{site}/content', 'PUT /v1/content/{item}/revisions'],
      'the only file the API accepts is a Markdown document; there is nowhere to upload an image',
    )
  })

  test('the pagination is built for cursors, not for page numbers', () => {
    const pagination = ui('pagination')
    assert.match(pagination, /nextCursor/, 'forward comes from the response')
    assert.doesNotMatch(pagination, /of \$\{total\}|totalPages|Math\.ceil/, 'there is no total to divide')
    assert.match(pagination, /if \(!back && !forward\) return null/, 'a pager for one page is decoration')
  })

  test('the date field keeps the empty state reachable', () => {
    const date = source('forms', 'fields', 'date.tsx')
    assert.match(date, /-clear`/, 'a date input’s own clear affordance is a browser detail')
    assert.match(date, /onChange\(undefined\)/, 'and clearing means unset, not today')
    assert.match(date, /-preset-today`/, 'the one quick set a day field offers is addressable')
    assert.match(date, /FieldShell/, 'it is a field like every other one, not a bare control')
    assert.doesNotMatch(date, /new Date\(\)/, 'nothing here fills the field in on the operator’s behalf')
  })

  test('the day field offers today, and nothing counted forward', () => {
    // A publication date is picked, not offset. `now + 30 days` is what a
    // credential's expiry wants; on the field a document is sorted and dated by it
    // is a post dated a month ahead of everything that was actually published.
    const date = stripComments(source('forms', 'fields', 'date.tsx'))
    assert.match(date, /todayInput\(\)/, 'today is read at the click, which is the operator asking for it')
    assert.doesNotMatch(date, /DATE_PRESETS|presetInstant/, 'the expiry sets are not offered on a publication date')
    assert.doesNotMatch(date, /86_400_000|\bdays\b/, 'nor is any offset of its own')
  })

  test('the date field says which of the three states it is in', () => {
    const date = stripComments(source('forms', 'fields', 'date.tsx'))
    assert.match(date, /-state`/, 'the state is on screen and addressable')
    const pill = /state === 'set' \? ('[^']*') : state === 'invalid' \? ('[^']*') : ('[^']*')/.exec(date)
    assert.ok(pill, 'the label branches on all three states')
    assert.equal(
      new Set(pill.slice(1, 4)).size,
      3,
      'and says something different for each: "Not set" for a value the control cannot render is the exact ' +
        'conflation the third state exists to prevent — unset stays unset on save, unreadable is kept verbatim',
    )
  })

  test('one list of quick sets, imported rather than copied', () => {
    const number = source('forms', 'fields', 'number.tsx')
    const dateValue = source('forms', 'fields', 'date-value.ts')
    assert.match(number, /from '\.\/date-value'/, 'the datetime field takes the list from the module that owns it')
    assert.equal(
      (stripComments(number).match(/label: '30 days'/g) ?? []).length,
      0,
      'a second copy of the same four choices beside the component is a copy that drifts out of step',
    )
    assert.equal((stripComments(dateValue).match(/label: '30 days'/g) ?? []).length, 1, 'and there is exactly one')
    assert.doesNotMatch(stripComments(number), /Date\.now\(\) \+/, 'the arithmetic travels with the list')
  })

  test('the way back to empty says what empty does in the field it is in', () => {
    const number = source('forms', 'fields', 'number.tsx')
    const fields = source('forms', 'content', 'fields.tsx')
    assert.match(number, /unsetLabel = 'Never'/, 'a credential that never expires keeps the word that is true for it')
    assert.match(number, /preset\.days === null \? unsetLabel : preset\.label/, 'and a caller may say it differently')
    assert.match(
      number,
      /-preset-\$\{preset\.days \?\? 'never'\}/,
      'the testid does not move with the label, so one script still drives both callers',
    )
    // "Never", printed beside "Unset means it publishes with the next release.",
    // reads as "never publish" — which is not what that button does.
    assert.match(fields, /fallback="Unset means it publishes with the next release\."/)
    assert.match(fields, /unsetLabel="No schedule"/, 'the scheduler’s empty is a schedule nobody set, not a never')
  })
})
