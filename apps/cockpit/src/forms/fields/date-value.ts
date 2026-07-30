/**
 * The three states of a date in this product: unset, unreadable, and a day.
 *
 * "Unset" is documented behaviour, not a missing value. A publication date left
 * empty is "the moment the release is built"; a `scheduled_at` left empty means
 * "it publishes with the next release". Both sentences are printed under the
 * control, and both stop being true the instant something helpfully fills in
 * today's date — so nothing in this module invents a value, `''` and `undefined`
 * normalise to the same absence, and an empty control round-trips to empty.
 *
 * `invalid` is separate from `unset` for the same reason: frontmatter can arrive
 * carrying `date: yesterday`, and a field that silently swallowed it as "empty"
 * would delete an author's line on the next save.
 *
 * Three spellings of value reach this module, and telling a day from a moment is
 * the whole point of `isDayOnly`: `date: 2026-07-30` names a calendar day,
 * `2026-07-30T09:00:00Z` names a moment in time, and `2026-07-30T00:00:00.000Z` is
 * what the first one comes back as once it has been through the API —
 * `parseIsoDate` runs `date`/`publishedAt`, `scheduledAt` and `updatedAt` through
 * `new Date(value).toISOString()` (src/utils.mjs, called from src/markdown.mjs), and
 * a day-only line parses as UTC midnight. A day has no time of day and no zone; a
 * moment has both. Treating the first as the second is how a document dated the
 * 30th showed the 29th to every operator west of Greenwich, and the third has to be
 * read as a day for the same reason — see `isDayOnly` for the rule and its cost.
 */

export type DateState = 'unset' | 'invalid' | 'set'

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

/**
 * The day a day-only string names, or `null` if no such day exists.
 *
 * Deliberately not `new Date(value)`: V8 accepts `2026-02-31` and answers the 3rd
 * of March, so a document carrying an impossible day would be shown, and then
 * saved, as a different day than the one it says. The month lengths are counted
 * here instead — arithmetic, so the answer to "is there a 29th of February in
 * 2026" depends neither on the operator's time zone nor on a `Date` that rolls
 * over, and a four-digit year below 100 is not quietly moved into the 1900s.
 */
function parseDay(value: string): { year: number; month: number; date: number } | null {
  const match = DAY.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const date = Number(match[3])
  if (month < 1 || month > 12 || date < 1 || date > daysInMonth(year, month)) return null
  return { year, month, date }
}

/** Called only for a month between 1 and 12, which `parseDay` has already checked. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

export function dateState(value: string | null | undefined): DateState {
  if (value === null || value === undefined || value.trim() === '') return 'unset'
  // A day-shaped value is judged as a day, not handed to `new Date`, which would
  // file the 31st of February under "set" and then show the 3rd of March.
  if (DAY.test(value.trim())) return parseDay(value) ? 'set' : 'invalid'
  return Number.isNaN(new Date(value).valueOf()) ? 'invalid' : 'set'
}

/** The calendar day an instant falls on where the operator is sitting. */
function localDay(instant: number): string {
  const date = new Date(instant)
  return new Date(instant - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

/**
 * Whether the value spells a complete calendar date with a time of day, and that
 * time of day is exactly midnight UTC.
 *
 * The complete date is required, not decoration: `Date.parse('2026-07')` and
 * `Date.parse('2026')` are midnight UTC as well, and answering "the 1st of July" for
 * a value that never named a day would invent the very thing this module refuses to.
 * A lowercase `t` and a space are accepted because `Date.parse` accepts them and
 * they name the same instant.
 */
const DATED_INSTANT = /^\d{4}-\d{2}-\d{2}[Tt ]/

function isUtcMidnight(trimmed: string): boolean {
  if (!DATED_INSTANT.test(trimmed)) return false
  const instant = Date.parse(trimmed)
  return Number.isFinite(instant) && instant % MS_PER_DAY === 0
}

/**
 * The calendar day a value names, or `null` if it names a moment (or nothing).
 *
 * Day-shaped strings are answered from `parseDay` alone and never reach
 * `Date.parse`, so `2026-02-31` is not a day here either — `Date.parse` would have
 * called it the 3rd of March, at UTC midnight, and handed the caller a day nobody
 * wrote.
 */
function dayNamed(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (DAY.test(trimmed)) return parseDay(trimmed) ? trimmed : null
  return isUtcMidnight(trimmed) ? new Date(Date.parse(trimmed)).toISOString().slice(0, 10) : null
}

/**
 * Whether the value names a calendar day rather than a moment in time.
 *
 * Two spellings say "a day", and both must be kept out of local time:
 *
 *  - `2026-07-30`, the ordinary one in a Markdown post. ECMAScript parses it as UTC
 *    midnight, so shifting it into local time moves it to the 29th for everybody
 *    west of Greenwich — first in the control, then in the file.
 *  - An instant exactly on midnight UTC, `2026-07-30T00:00:00.000Z`. That is not a
 *    spelling an author writes by hand; it is what `parseIsoDate` makes of the line
 *    above, so it is the spelling every API round trip and every generating tool
 *    writes back. Read as a moment it shows Los Angeles the 29th, and
 *    `2026-01-01T00:00:00.000Z` shows the 31st of December 2025 — a document whose
 *    own text says 2026 dated in the year before.
 *
 * THE RULE, since a real instant at midnight UTC does exist and this is therefore a
 * choice: an instant exactly on midnight UTC is a day, and it is the day it spells in
 * UTC. THE COST: an operator who means that instant literally — 00:00Z, which is the
 * late afternoon of the day before in Los Angeles — is shown the UTC day and not
 * their own, and one millisecond either side of it the ordinary local rule
 * applies again, so the rule has a discontinuity at exactly that instant. The trade
 * is deliberate: the only callers of these two functions are `DateField`'s two —
 * the publication date and the update line in forms/content/fields.tsx — and on
 * both the value is a calendar day whose 00:00Z spelling is the API's own, read
 * locally as the wrong day by every operator west of Greenwich. The one value where
 * an exact instant is the point, `scheduled_at`, is a `DateTimeField`, which reads
 * and writes its value with `toLocalInput` in number.tsx and never calls these.
 *
 * Anything else that parses (`…T09:00Z`, an offset, a non-ISO spelling) is a moment,
 * and a moment does have a local day worth computing.
 */
export function isDayOnly(value: string | null | undefined): boolean {
  return dayNamed(value) !== null
}

/**
 * The value for `<input type="date">`.
 *
 * A day is shown as the day it names; a moment is shown as its LOCAL calendar day.
 * Local for the moment, because `2026-07-30T23:30:00Z` is the 31st in Berlin and
 * an operator in Berlin editing "the 31st" must not see the control jump to the
 * 30th. Unshifted for the day, because there is nothing to convert — that shift is
 * what showed Los Angeles the 29th for `2026-07-30` and for the `…T00:00:00.000Z`
 * the API writes in its place. `''` for anything that is not a day: the control
 * cannot render an unreadable value, and blanking it here is not the same as
 * clearing the value.
 */
export function toDayInput(value: string | null | undefined): string {
  if (value === null || value === undefined || dateState(value) !== 'set') return ''
  return dayNamed(value) ?? localDay(new Date(value).valueOf())
}

/**
 * A day from the control back to the value the document stores.
 *
 * What comes back depends on what was there, because a day and a moment are not
 * the same value:
 *
 *  - Nothing, a day, or something unreadable: the day itself, `2026-07-30`. There
 *    is no time of day to keep and no zone the operator implied, and inventing
 *    local midnight is precisely what made the value come back as the day before
 *    in Los Angeles. The API reads that spelling as that day.
 *  - The API's spelling of a day, an instant exactly on midnight UTC: midnight UTC
 *    on the new day. Keeping the spelling keeps the round trip an identity — the
 *    control shows the day it spells and hands back the same shape — and carrying
 *    00:00 in UTC rather than in local time is what keeps the day still: carried as
 *    a local time of day, `2026-07-30T00:00:00.000Z` edited in Los Angeles (where it
 *    reads 17:00 the day before) would land the document a day off.
 *  - Any other moment: the same LOCAL time of day on the new day. The control edits
 *    a calendar day, and a document scheduled for 09:00 must not silently become one
 *    scheduled for midnight because someone corrected the year.
 *
 * An impossible day is `undefined` — the 31st of February is not a date, and a
 * `Date` that rolled it over to March would be a value nobody typed.
 */
export function fromDayInput(day: string, previous?: string | null): string | undefined {
  const picked = parseDay(day)
  if (!picked) return undefined
  // Already canonical: the pattern accepts exactly four, two and two digits.
  const chosen = day.trim()
  if (previous === null || previous === undefined || dateState(previous) !== 'set') return chosen
  const before = previous.trim()
  // A day-shaped value has no time of day to carry at all.
  if (DAY.test(before)) return chosen
  if (isUtcMidnight(before)) return `${chosen}T00:00:00.000Z`
  const carried = new Date(before)
  const instant = new Date(
    picked.year,
    picked.month - 1,
    picked.date,
    carried.getHours(),
    carried.getMinutes(),
    carried.getSeconds(),
    carried.getMilliseconds(),
  )
  // `new Date(26, …)` is 1926 by specification. The year is set again so that a
  // four-digit year stays the year the operator typed.
  instant.setFullYear(picked.year)
  return instant.toISOString()
}

/**
 * Today, as the control spells it: the operator's own calendar day.
 *
 * The instant is an argument with a default rather than a `Date.now()` in the
 * body, so a test can ask for a day without the answer depending on the day it
 * runs. Local, because "today" is the operator's day and not UTC's: at 23:30 in
 * Berlin the UTC day is still yesterday, and a quick set that filled in yesterday
 * would be a mistake the operator has to catch.
 *
 * The local day is computed here rather than borrowed from `toDayInput`, because
 * `toDayInput` reads an instant on midnight UTC as the day it spells in UTC: called
 * at exactly 00:00:00.000Z it would hand an operator in Los Angeles tomorrow.
 */
export function todayInput(now: number = Date.now()): string {
  return localDay(now)
}

/**
 * The expiry quick sets, and the offset arithmetic behind them.
 *
 * These belong to `DateTimeField`, and to expiry: "90 days" is the answer almost
 * every credential wants, and `days: null` is "Never", which is the unset state
 * rather than a date far away because the product's own fallback sentence —
 * "Unset means no expiry.", printed under that control — is what makes it
 * meaningful. A year 9999 would defeat it.
 *
 * `DateField` deliberately does not offer them. `now + 30 days` on a publication
 * date is a post dated a month into the future, sorted above everything that was
 * actually published; a publication date is a day somebody picks, so the day
 * field offers "Today" and nothing that counts forward.
 *
 * They live in this module rather than beside `DateTimeField` in `number.tsx`
 * because this file is the dependency-free half a unit test can import and call,
 * and because one copy is the point: `number.tsx` imports these two rather than
 * keeping a second list that drifts.
 */
export const DATE_PRESETS: readonly { label: string; days: number | null }[] = [
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '365 days', days: 365 },
  { label: 'Never', days: null },
]

/** `undefined` for the Never choice — the same absence the empty control means. */
export function presetInstant(days: number | null, now: number = Date.now()): string | undefined {
  if (days === null) return undefined
  return new Date(now + days * 86_400_000).toISOString()
}
