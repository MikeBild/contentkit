/**
 * Whether there is a fraction to draw at all, and what it is.
 *
 * The rule this module exists for is a claim about honesty rather than about
 * pixels: a bar may only draw a fraction that exists. The audio budget reports
 * one — `chars_this_month` over `settings.audio.monthly_char_budget`, both from
 * `GET /v1/sites/{site}/audio/jobs` — and a release build reports none at all
 * (`docs/openapi.json`, schema `Release`: no percentage, no step count, no ETA).
 * A build has been measured at over a hundred seconds, so a bar filling at a
 * guessed rate reaches ninety per cent, stops there, and gets a good build
 * cancelled.
 *
 * So absence is preserved rather than coerced. `value` missing is not zero —
 * zero is a measurement — and a denominator that is missing, null or zero is not
 * a denominator, which is exactly what a site with no budget configured reports.
 * Either one means indeterminate, and `Progress` then draws no fraction and
 * publishes no `aria-valuenow`.
 *
 * It lives in its own dependency-free module for one reason: `progress.tsx` is
 * JSX, and Node cannot import JSX. This is the half a unit test can call, so
 * "a fraction is never invented" is asserted by running it rather than by
 * matching the source that implements it.
 */

/** The clamped percentage to draw, or `null` when no fraction exists. */
export function progressPercent(
  value: number | null | undefined,
  max: number | null | undefined = 100,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  // Zero, null and absent are all "not a denominator". A negative one is not a
  // denominator either: `used / -1000` would draw a bar that fills as the number
  // it reports goes down.
  if (max === null || max === undefined || !Number.isFinite(max) || !(max > 0)) return null
  // Clamped, because a spent budget reports a ratio above one and a bar cannot
  // draw 140% — the overshoot is said in the numbers beside it, where it stays a
  // number instead of becoming a wrong picture.
  return Math.min(100, Math.max(0, Math.round((value / max) * 100)))
}
