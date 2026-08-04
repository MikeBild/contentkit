import { useQuery, type QueryKey } from '@tanstack/react-query'

/**
 * What a tab strip's badge says, and the one rule it obeys.
 *
 * Stacked, a list is below the fold; behind a tab it is behind a door with no
 * number on it. This is the number on the door — and because a door is a small
 * surface, it carries exactly one claim: **how many are waiting**, not how many
 * the panel is currently showing. A moderator filtering Comments to `approved`
 * has not stopped having twelve contact submissions to answer, and a badge that
 * followed the filter would say so.
 *
 * ─── The three states, and how a reader tells them apart ─────────────────────
 *
 *  1. **Known and non-zero** — the badge, with the number in it.
 *  2. **Known and zero** — no badge. A `0` on a door is noise: it is the same
 *     ink as a real number for a fact nobody needs.
 *  3. **Unknown, or the request failed** — no badge. A badge on a failed query
 *     is a lie, and there is no number to print anyway.
 *
 * Two and three render identically, and that is deliberate rather than
 * overlooked: the strip has room for one bit — *is there something here worth
 * opening* — and the answer is no in both cases. The reader who needs the
 * difference gets it from the panel, which is the surface that has room for
 * UI-UX.md §5's four states: an empty state ("Nothing waiting for moderation")
 * means zero, and an error alert with a Retry means unknown. So *absent never
 * reads as zero on its own* — absent means "nothing to open for", and opening is
 * what separates the two. This is the §4 rule that a value nobody sent is not
 * zero, applied to a surface too small to print `—`.
 *
 * ─── What it costs ───────────────────────────────────────────────────────────
 *
 * A count for the tab the reader is already on is a request for a number that is
 * already on screen, so `open` suppresses it. A count that has been fetched
 * stays on its tab once that tab is opened — react-query keeps the row and this
 * hook keeps reading it — because a badge that vanished under the pointer would
 * read as "it just went to zero".
 */

/**
 * A count that may not be known. `undefined` is the third state and it is never
 * coerced to `0`; `tabCountLabel` is the only thing allowed to decide what it
 * renders as, which is nothing.
 */
export type TabCount = number | undefined

/**
 * Stale for the length of a visit.
 *
 * The badge answers "is it worth opening this", which does not change between
 * two clicks of a tab strip, and a refetch per tab switch would spend a request
 * to move a number by one. An invalidation still refetches it: `invalidateQueries`
 * marks the row stale regardless of `staleTime`, so a moderated comment or a
 * deleted submission updates the badge with the list.
 */
const TAB_COUNT_STALE_TIME = Number.POSITIVE_INFINITY

/**
 * The badge's text, or `null` for the two states that render nothing.
 *
 * Pure, so the rule above is one function rather than four `count > 0 &&` in
 * four pages, where the third one would eventually be written `count ?? 0`.
 *
 * `noun` is what keeps a narrowed count honest: "3 pending" and "2 failed" say
 * which question the number answers, and a bare `3` beside a list of forty would
 * claim to be its size. It is also §8 — the destructive badge and the outline
 * one differ by a word, not only by a colour.
 *
 * `atLeast` is for a count read off a capped list: "200+" is what a query that
 * saturated its own limit actually measured, and printing `200` would be the
 * kind of exact-looking wrong number this file exists to avoid.
 */
export function tabCountLabel(
  count: TabCount,
  { noun, atLeast = false }: { noun?: string; atLeast?: boolean } = {},
): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null
  return `${count}${atLeast ? '+' : ''}${noun ? ` ${noun}` : ''}`
}

export interface TabCountSource<T> {
  /** The list's key. Where it is a key the page's panels already use, this is a free read. */
  queryKey: QueryKey
  queryFn: () => Promise<T>
  /** How many of the fetched rows the badge is about. Required: a default would be a guess. */
  count: (data: T) => number
  /** False while the page cannot ask at all — no site selected, or no scope for it. */
  enabled?: boolean
  /** True while this tab is the open one: its own panel is the answer, so nothing is fetched. */
  open?: boolean
}

/**
 * One tab's count.
 *
 * Called once per tab, at the top of the page, so the number of hooks is fixed —
 * a strip's tabs are known at compile time and a loop over them would not be.
 */
export function useTabCount<T>({ queryKey, queryFn, count, enabled = true, open = false }: TabCountSource<T>): TabCount {
  const query = useQuery({
    queryKey,
    queryFn,
    // Disabled is not the same as discarded: a disabled query still reads the
    // cache, so a count already fetched survives its tab being opened.
    enabled: enabled && !open,
    staleTime: TAB_COUNT_STALE_TIME,
  })
  // `data` is undefined while pending and while failed, which is exactly the
  // third state; there is no branch on `isError` because there is nothing
  // different to do with it.
  return query.data === undefined ? undefined : count(query.data)
}
