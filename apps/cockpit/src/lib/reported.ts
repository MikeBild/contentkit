/**
 * A count the response actually carried, or `null` — never zero for silence.
 *
 * lib/audio-budget.ts refuses to build a fraction out of a numerator nobody sent,
 * and the numbers printed beside its bar hold to the same rule. `?? 0` draws an
 * unmeasured month as a quiet one, and those are the two readings an operator most
 * needs to tell apart. The per-status counters make it a live case rather than a
 * hypothetical: only `chars_this_month`, `monthly_char_budget` and
 * `budget_remaining` are required in AudioJobList.summary, so a status this console
 * knows and a response omits would otherwise read as a status with no jobs.
 *
 * The readiness tiles on the System page have the same problem — `/ready` answers
 * 503 while draining and both deck counters are optional even when it answers — so
 * the rule is shared rather than copied into the second page that needs it.
 *
 * `—` is how the pages that call this already say "not reported".
 */
export function reportedCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
