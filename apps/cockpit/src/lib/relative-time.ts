/**
 * "vor 2 Stunden" — and the instant it was derived from, never instead of it.
 *
 * An audit row that reads `29.7.2026, 21:43:19` makes the operator do the
 * arithmetic to answer "was that before or after the release?". A row that reads
 * only "vor 2 Stunden" takes the instant away from them, which is the one thing
 * an append-only trail is for. So every relative sentence here comes with the
 * exact timestamp it stands for, and the component that renders it puts both on
 * screen: the sentence as text, the instant in `title` and in `<time datetime>`.
 *
 * `Intl.RelativeTimeFormat` is in every browser the console supports, so there is
 * no library. The locale is the browser's: `locales` defaults to `undefined`,
 * which is what makes Intl read the runtime's own preference. It is a parameter
 * only so a test can pin one — hardcoding 'de' or 'en' here would be a decision
 * about the operator's language that this module has no standing to make.
 */

export type TimeInput = string | number | Date | null | undefined
export type Locales = string | readonly string[] | undefined

export interface RelativeParts {
  /** Negative in the past, positive in the future — the sign `format()` wants. */
  value: number
  unit: Intl.RelativeTimeFormatUnit
}

/**
 * Each unit with how many of it the next one holds. Weeks are in the list
 * because "vor 10 Tagen" is a number the reader has to convert and "vor 1 Woche"
 * is not; months are approximated from weeks, which is why nothing here claims
 * calendar accuracy past a week.
 */
const DIVISIONS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.348_125],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
]

/**
 * An absent or unparseable value is `null`, not a zero and not the epoch: a
 * `published_at` the server has not set yet must never render as 1970.
 */
export function instantOf(value: TimeInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.valueOf()) ? null : date
}

/**
 * The coarsest unit that still counts at least one, truncated towards zero.
 *
 * Truncation rather than rounding, and that is the whole honesty of this
 * function: a build that finished 59.6 seconds ago has not been finished for a
 * minute, and 23 hours 50 minutes ago was not "yesterday" — it was today, which
 * is exactly the distinction an operator reading a log is making. Rounding also
 * produces "in 60 seconds", a sentence no unit boundary should ever emit.
 */
export function relativeParts(fromMs: number, nowMs: number): RelativeParts {
  let amount = (fromMs - nowMs) / 1000
  for (const [unit, size] of DIVISIONS) {
    // `|| 0` only ever fires for -0, which is what truncating a fraction of a
    // second in the past produces. It is a value no caller should have to know
    // about: "0 seconds" and "-0 seconds" are the same moment.
    if (Math.abs(amount) < size) return { value: Math.trunc(amount) || 0, unit }
    amount /= size
  }
  // Unreachable — the last division is unbounded — but TypeScript cannot see it.
  return { value: Math.trunc(amount) || 0, unit: 'year' }
}

/** `null` when there is no instant to describe; the caller decides what to show. */
export function formatRelative(value: TimeInput, nowMs: number = Date.now(), locales?: Locales): string | null {
  const date = instantOf(value)
  if (!date) return null
  const { value: amount, unit } = relativeParts(date.valueOf(), nowMs)
  // numeric: 'auto' is what turns 0 into "now" and -1 day into "yesterday"
  // rather than "0 seconds ago" and "1 day ago".
  return new Intl.RelativeTimeFormat(locales as string | string[] | undefined, { numeric: 'auto' }).format(amount, unit)
}

/** The precision the relative sentence hides, in the reader's own locale. */
export function formatExact(value: TimeInput, locales?: Locales): string | null {
  const date = instantOf(value)
  if (!date) return null
  return date.toLocaleString(locales as string | string[] | undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  })
}

/** The machine-readable instant for `<time datetime>`; UTC, so no reader's zone is implied. */
export function isoInstant(value: TimeInput): string | null {
  return instantOf(value)?.toISOString() ?? null
}

/**
 * How long the sentence stays true, in milliseconds.
 *
 * A label reading "vor 3 Sekunden" is wrong a second later, so it re-renders
 * every second; one reading "vor 3 Stunden" is wrong at most once an hour and a
 * timer per row is not free. The middle case is deliberately tighter than its
 * unit: checking a minutes label four times a minute costs nothing and keeps
 * "gerade jetzt" from lingering for a full minute after it stopped being true.
 */
export function refreshAfter(unit: Intl.RelativeTimeFormatUnit): number {
  if (unit === 'second' || unit === 'seconds') return 1_000
  if (unit === 'minute' || unit === 'minutes') return 15_000
  return 60_000
}
