/**
 * The one place that decides whether the audio budget is a fraction at all.
 *
 * `GET /v1/sites/{site}/audio/jobs` answers a summary with `chars_this_month`,
 * `monthly_char_budget` and `budget_remaining`, and the budget is `null` whenever
 * the site has not configured one — which is most sites. A denominator that does
 * not exist cannot be drawn: a bar at "0 of nothing" is meaningless, and the
 * indeterminate form would be a lie of a different kind, because it reads as work
 * in progress and nothing is in progress. So this returns `null` and the caller
 * prints the count in words instead.
 *
 * `budget_remaining` is the server's own arithmetic (`max(0, budget - used)`), so
 * it is preferred over recomputing it here: two numbers that disagree on the same
 * screen are worse than one number from the wrong side of the API. It is only
 * derived when the server sent none.
 *
 * The tone thresholds are here rather than in the page because "80 %" is a product
 * decision about when a budget becomes an exception worth pixels, and a test can
 * hold this module to it.
 *
 * Pure, dependency-free and in a `.ts` module on purpose: `test/unit` imports it
 * and calls it. Nothing here reads a clock — the month boundary is the server's.
 */

/** The fields of the jobs-list summary this module reads. */
export interface AudioBudgetSummary {
  chars_this_month?: number | null
  monthly_char_budget?: number | null
  budget_remaining?: number | null
}

export interface AudioBudget {
  used: number
  budget: number
  /** Characters still available, never below zero. */
  remaining: number
  /** `used / budget`, deliberately NOT clamped: 1.4 is a fact worth reading. */
  ratio: number
  /** What the bar is drawn in — the same names `Progress` takes. */
  tone: 'accent' | 'warning' | 'danger'
  /** More characters have been spent this month than the budget allows. */
  spent: boolean
}

/** The share of the budget at which it stops being a number that is always fine. */
export const AUDIO_BUDGET_WARNING = 0.8

/**
 * `null` means "no fraction exists" — no summary, no budget configured, or a
 * numerator the server did not send. Every other answer is a real measurement.
 */
export function audioBudget(summary: AudioBudgetSummary | null | undefined): AudioBudget | null {
  if (!summary) return null
  const budget = Number(summary.monthly_char_budget)
  // Zero is not a budget, it is the absence of one, and dividing by it is how a
  // progress bar ends up claiming Infinity per cent.
  if (!Number.isFinite(budget) || budget <= 0) return null
  // Number(null) is 0, not NaN, so `Number.isFinite` alone lets a numerator nobody sent
  // through as a measured zero — this module's own header says null means the server did not
  // send it. Two readouts came out of that: "0 of 1,000 · 1,000 left" for an unknown
  // numerator, and "500 of 1,000 · 0 left" when only the remainder was missing. The declared
  // interface permits both (`number | null`) even though this server ties all three fields to
  // one flag, and an interface is what a client must defend against.
  const used = typeof summary.chars_this_month === 'number' ? summary.chars_this_month : Number.NaN
  if (!Number.isFinite(used) || used < 0) return null
  const reported = typeof summary.budget_remaining === 'number' ? summary.budget_remaining : Number.NaN
  const remaining = Number.isFinite(reported) ? Math.max(0, reported) : Math.max(0, budget - used)
  const ratio = used / budget
  return {
    used,
    budget,
    remaining,
    ratio,
    tone: ratio >= 1 ? 'danger' : ratio >= AUDIO_BUDGET_WARNING ? 'warning' : 'accent',
    spent: used >= budget,
  }
}
