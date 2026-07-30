import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `<RelativeTime>` keeps its one promise: the label re-reads the clock.
 *
 * Both the module doc and the component doc say it — "a row that says 'vor 3
 * Sekunden' for the next ten minutes is worse than one that never claimed to be
 * live" — and nothing checked it. Replacing the whole effect body with `void
 * unit; return` left the suite green: the only test that looked like a guard
 * called `refreshAfter`, a pure function the component is free to ignore, and
 * every other assertion about this component reads its markup, which a frozen
 * label still renders perfectly.
 *
 * The component is JSX, so Node cannot import it — which is exactly how that hole
 * stayed open. The effect is therefore sliced out of the committed source and RUN
 * here, with the clock, the timer and the state setter supplied by this file: a
 * mutation that arms no timer has nothing to fire, and one that adds the interval
 * to a captured `now` instead of re-reading the clock writes the wrong number.
 *
 * The unit-to-interval rule itself lives in lib/relative-time.ts and is driven
 * with real values in test/unit/cockpit-primitives.test.mjs. Here the stubs
 * return distinctive numbers, so what is pinned is the wiring: the instant and
 * the clock go into `relativeParts`, its unit goes into `refreshAfter`, and that
 * answer is the interval. The last describe re-runs the same effect against the
 * real module wherever this Node can read TypeScript.
 */

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const cockpit = join(root, 'apps', 'cockpit', 'src')
const component = readFileSync(join(cockpit, 'components', 'ui', 'relative-time.tsx'), 'utf8')

/**
 * The `useEffect(() => { … }, [deps])` in a component source.
 *
 * Brace-matched, which is sound for this component because nothing in the effect
 * carries a brace inside a string or a template. If the slice ever came back
 * empty every test below would fail on it rather than pass vacuously.
 */
function effectOf(text) {
  const header = 'useEffect(() => {'
  const open = text.indexOf(header)
  if (open === -1) return null
  const from = open + header.length
  let depth = 1
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    else if (text[index] === '}') {
      depth -= 1
      if (depth > 0) continue
      const deps = text.slice(index + 1).match(/^\s*,\s*\[([^\]]*)\]/)
      return {
        body: text.slice(from, index),
        deps: deps
          ? deps[1]
              .split(',')
              .map((name) => name.trim())
              .filter(Boolean)
          : null,
      }
    }
  }
  return null
}

const effect = effectOf(component)
const state = component.match(/const \[(\w+), (\w+)\] = useState\(/)

/** Deliberately not the real intervals: what is pinned here is that this answer is the one used. */
const DELAY = { second: 111, minute: 222, hour: 333, day: 444, week: 555, month: 666, year: 777 }

/**
 * The effect, run with a clock, a timer and a state setter this test owns.
 *
 * Everything the body can plausibly reach is bound, so a mutation fails on the
 * value it produces rather than on a ReferenceError that reads like a broken
 * test.
 */
function runEffect({ iso, clock, unit = 'second', parts, delay }) {
  const at = { clock }
  const calls = []
  const armed = []
  const cleared = []
  const pushed = []
  let handle = 0

  // `Date.now()` is the clock the component is supposed to re-read; `new
  // Date(iso)` still has to work, so this is a real Date with a moving now.
  class Clock extends Date {
    static now() {
      return at.clock
    }
  }

  const scope = {
    iso,
    value: iso,
    Date: Clock,
    relativeParts:
      parts ??
      ((fromMs, nowMs) => {
        calls.push({ fn: 'relativeParts', fromMs, nowMs })
        return { value: -3, unit }
      }),
    refreshAfter:
      delay ??
      ((asked) => {
        calls.push({ fn: 'refreshAfter', unit: asked })
        return DELAY[asked] ?? -1
      }),
    formatRelative: () => 'vor 3 Sekunden',
    formatExact: () => '30.7.2026, 11:15:30',
    isoInstant: () => iso,
    setInterval: (fn, ms) => {
      armed.push({ fn, ms, id: (handle += 1) })
      return handle
    },
    clearInterval: (id) => cleared.push(id),
    setTimeout: (fn, ms) => {
      armed.push({ fn, ms, id: (handle += 1) })
      return handle
    },
    clearTimeout: (id) => cleared.push(id),
    // The state the label is rendered from, and its setter, under the names the
    // component itself gave them.
    [state?.[1] ?? 'now']: clock,
    [state?.[2] ?? 'setNow']: (next) => pushed.push(typeof next === 'function' ? next(clock) : next),
  }
  const run = new Function(...Object.keys(scope), effect?.body ?? '')
  const cleanup = run(...Object.values(scope))
  return { armed, cleared, pushed, calls, cleanup, advance: (ms) => (at.clock += ms) }
}

const INSTANT = '2026-07-30T09:15:30.000Z'
const NOW = Date.parse('2026-07-30T09:15:33.000Z')

describe('RelativeTime is live, or it is lying', () => {
  test('the effect and the state this test drives are the ones on disk', () => {
    // Everything below runs a slice of the committed source. If the slice were
    // empty, every assertion would be made against nothing at all.
    assert.ok(effect, 'relative-time.tsx must still run an effect — the live label is what it is for')
    assert.ok(effect.body.trim().length > 0, 'the effect body is empty, so the label can only be frozen at mount')
    assert.ok(state, 'the component must hold the clock it printed in state, or nothing can re-render it')
  })

  test('a value that can be described arms exactly one timer', () => {
    const run = runEffect({ iso: INSTANT, clock: NOW })
    assert.equal(
      run.armed.length,
      1,
      'no timer was armed: the label is frozen at mount, and both docs promise it re-renders on its own',
    )
    assert.equal(typeof run.armed[0].fn, 'function', 'a timer with nothing to run is not a timer')
  })

  test('the interval is the one the label’s own unit asks for', () => {
    // The instant and the current clock decide the unit; the unit decides the
    // interval. A hardcoded delay would be right for one row and wrong for
    // every other one on the page.
    const run = runEffect({ iso: INSTANT, clock: NOW, unit: 'second' })
    assert.deepEqual(
      run.calls.filter((call) => call.fn === 'relativeParts'),
      [{ fn: 'relativeParts', fromMs: Date.parse(INSTANT), nowMs: NOW }],
      'the unit must be derived from the instant and the clock as it is now, not from a captured render time',
    )
    assert.deepEqual(
      run.calls.filter((call) => call.fn === 'refreshAfter'),
      [{ fn: 'refreshAfter', unit: 'second' }],
      'refreshAfter must be asked about the unit relativeParts just answered',
    )
    assert.equal(run.armed[0].ms, DELAY.second, 'and its answer must be the interval')
    // The coarse end of the same rule: a list of year-old rows must not run a
    // timer per second.
    const yearly = runEffect({ iso: INSTANT, clock: NOW, unit: 'year' })
    assert.equal(yearly.armed[0].ms, DELAY.year)
    assert.notEqual(DELAY.year, DELAY.second, 'this test would prove nothing if the two intervals were equal')
  })

  test('the timer re-reads the clock instead of adding its interval to the old one', () => {
    const run = runEffect({ iso: INSTANT, clock: NOW })
    // The case the comment in the component names: a laptop asleep for an hour.
    // Adding the interval to the captured `now` would wake it with a label an
    // hour behind, and the row would read "vor 3 Sekunden" for the next hour.
    run.advance(3_600_000)
    run.armed[0].fn()
    assert.deepEqual(
      run.pushed,
      [NOW + 3_600_000],
      'firing the timer must write the clock as it is now into the state the label is rendered from',
    )
  })

  test('the timer is cleared when the row goes', () => {
    const run = runEffect({ iso: INSTANT, clock: NOW })
    assert.equal(typeof run.cleanup, 'function', 'an effect that arms a timer has to return its cleanup')
    run.cleanup()
    assert.deepEqual(
      run.cleared,
      [run.armed[0].id],
      'a table of fifty rows unmounted without clearing leaves fifty timers behind, each setting state on nothing',
    )
  })

  test('a value that is not an instant arms nothing at all', () => {
    const run = runEffect({ iso: null, clock: NOW })
    assert.deepEqual(run.armed, [], 'there is no sentence to keep true, so there is nothing to refresh')
    assert.deepEqual(run.pushed, [])
    assert.equal(run.cleanup, undefined, 'and nothing to clean up')
  })

  test('the clock the timer writes is the clock the label is rendered from', () => {
    // The loop has to close: re-reading the clock into state changes nothing on
    // screen unless the label is formatted from that state.
    const [, name, setter] = state
    assert.match(
      component,
      new RegExp(`formatRelative\\(value,\\s*${name}\\)`),
      `the label must be formatted from ${name}, the state ${setter} writes — otherwise the timer only re-renders ` +
        'the same sentence',
    )
    assert.ok(
      new RegExp(`\\b${setter}\\(`).test(effect.body),
      `the effect must call ${setter}, or the clock it reads never reaches the label`,
    )
    assert.deepEqual(
      effect.deps,
      ['iso', name],
      `the effect re-runs on ${name} on purpose: crossing a unit boundary re-arms the timer at the coarser ` +
        'interval, and dropping it leaves a row that has aged past seconds ticking once a second for a year',
    )
  })
})

/**
 * The same effect, against the real rule.
 *
 * lib/relative-time.ts is dependency-free so it can be imported and called;
 * type stripping landed in Node 22.6 and CI also runs this suite on Node 20, so
 * the import is attempted and its failure kept. The skip is printed with a
 * reason — a test that silently passed would not be.
 */
let time = null
let failure = null
try {
  time = await import('../../apps/cockpit/src/lib/relative-time.ts')
} catch (error) {
  failure = error
}
const behavioural = {
  skip: time ? false : `this Node cannot import TypeScript (type stripping landed in 22.6): ${failure?.message}`,
}

describe('RelativeTime against the real unit rule', behavioural, () => {
  const real = (iso, clock) => runEffect({ iso, clock, parts: time.relativeParts, delay: time.refreshAfter }).armed[0]

  test('a seconds-old row refreshes every second and a year-old row does not', () => {
    const secondsOld = real(INSTANT, NOW)
    assert.ok(secondsOld, 'the effect must arm a timer for a three-second-old instant')
    assert.ok(secondsOld.ms <= 1_000, `a seconds label is wrong a second later, not in ${secondsOld.ms}ms`)
    const yearOld = real(INSTANT, NOW + 400 * 86_400_000)
    assert.ok(yearOld.ms > 1_000, 'a year-old row must not run a timer per second')
    assert.ok(yearOld.ms <= 300_000, 'and no label may stop refreshing altogether')
  })

  test('the label that timer produces is the one that changed', () => {
    // End to end, without a renderer: the clock the effect writes, put through
    // the same formatter the component uses, is a different sentence.
    const run = runEffect({ iso: INSTANT, clock: NOW, parts: time.relativeParts, delay: time.refreshAfter })
    assert.equal(time.formatRelative(INSTANT, NOW, 'en'), '3 seconds ago')
    run.advance(3_600_000)
    run.armed[0].fn()
    assert.equal(
      time.formatRelative(INSTANT, run.pushed[0], 'en'),
      '1 hour ago',
      'the row must not still read "3 seconds ago" an hour later — that is the whole reason for the timer',
    )
  })
})
