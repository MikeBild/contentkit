// Shared retry policy for the two background workers.
//
// WHY this exists: both workers had the same backoff written out twice and
// neither looked at the status code, so a 400 was retried exactly like a 503.
// Measured cost of that: four narrations answered `400 … sentences that are too
// long`, each sent to the provider five times, ~195 000 characters billed for
// an outcome that could never change. The webhook worker had the same bug — it
// already carried `responseStatus` on the error and never read it.

// 4xx says the request is wrong; sending the same one again cannot make it
// right. The two exceptions are the ones that describe a moment rather than a
// mistake: 408 is a timeout and 429 is "not now".
const RETRYABLE_CLIENT_STATUSES = new Set([408, 429])

/**
 * Should another attempt be made at all?
 *
 * Anything without a status — a socket reset, DNS, a timeout, a bug in our own
 * code — stays retryable. Refusing to retry what we cannot classify would turn
 * every transient network fault into a permanent failure, which is the more
 * expensive mistake of the two.
 */
export function isRetryable(error) {
  const status = Number(error?.responseStatus ?? error?.statusCode ?? NaN)
  if (!Number.isFinite(status)) return true
  if (status >= 400 && status < 500) return RETRYABLE_CLIENT_STATUSES.has(status)
  return true
}

/**
 * Exponential backoff with ±15% jitter, so a fleet of due items does not retry
 * in lockstep against a recovering upstream.
 */
export function backoffSeconds(attempts, { baseSeconds, capSeconds, doublings }) {
  const base = Math.min(baseSeconds * 2 ** Math.min(attempts - 1, doublings), capSeconds)
  return base * (0.85 + Math.random() * 0.3)
}
