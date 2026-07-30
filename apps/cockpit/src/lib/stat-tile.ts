/**
 * What a statistics tile shows, and what it says when it shows nothing.
 *
 * This lives here rather than inline in overview.tsx for one reason: a `.tsx`
 * module cannot be imported by the test runner, so every guarantee about it had
 * to be asserted by slicing an expression out of the file and matching its text.
 * That is how the defect this module fixes survived — the filter dropped a
 * `missing` metric from the tile entirely, and a test asserting the filter's
 * *source text* went green either way. A rule is only as safe as the binding the
 * test happened to choose; a rule that can be called is safe as written.
 */
export interface TileMetric {
  total: number | null
}

/** How many rows a tile has room for before it stops being a summary. */
export const TILE_ROWS = 4

/**
 * The rows worth printing.
 *
 * A null total is the server saying `value_state: 'missing'` — `usageRatio` in
 * src/stats.mjs emits it for every zero denominator, so it is ordinary rather
 * than hypothetical. It stays: "we asked and it is not measured" is information,
 * and dropping the row silently downgrades it to "we did not ask". A real zero is
 * the only value uninteresting enough to hide, because a tile of zeroes is what a
 * quiet window looks like and four of them crowd out the metric that moved.
 */
export function visibleMetrics<T extends TileMetric>(metrics: readonly T[]): T[] {
  return metrics.filter((metric) => metric.total !== 0).slice(0, TILE_ROWS)
}

export type TileEmptiness = 'nothing-came-back' | 'measured-all-zero'

/**
 * Why a tile is empty — two different facts that must not share a sentence.
 *
 * No metric came back at all: there is nothing to report, and for a usage tile
 * that usually means the site has not opted in. Metrics came back and every one
 * is a real zero: the window *was* measured and the answer is zero, which is a
 * result. Printing "nothing recorded" over the second states an absence of
 * evidence where there is evidence of absence.
 */
export function tileEmptiness(metrics: readonly TileMetric[]): TileEmptiness {
  return metrics.length > 0 ? 'measured-all-zero' : 'nothing-came-back'
}
