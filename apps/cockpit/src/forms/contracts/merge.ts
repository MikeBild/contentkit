/**
 * Carrying unknown keys through a whole-object write.
 *
 * `PATCH /v1/sites/{site}` replaces `settings` in full and lets unknown keys
 * through untouched. Both halves of that sentence matter: a form that sends only
 * what it renders deletes everything else, and a form that refuses to send
 * anything it does not understand can never save at all. So the form takes the
 * whole received object apart into "mine" and "carried", edits the first, and
 * puts them back together.
 */

/** Keys of `source` that no path in `owned` claims. */
export function carriedKeys(source: Record<string, unknown>, owned: readonly string[]): Record<string, unknown> {
  const top = new Set(owned.map((path) => path.split('.')[0]!))
  return Object.fromEntries(Object.entries(source).filter(([key]) => !top.has(key)))
}

/**
 * A deep merge that treats arrays as values.
 *
 * Merging arrays element-wise would make removing the last item impossible: a
 * three-item carried array under a two-item edited one leaves three. An array
 * the form owns replaces the carried one whole.
 */
export function mergeDeep<T extends Record<string, unknown>>(carried: T, owned: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...carried }
  for (const [key, value] of Object.entries(owned)) {
    // An explicit `undefined` is the form saying "remove this key", which is
    // the only way an optional subtree can be turned off.
    if (value === undefined) {
      delete result[key]
      continue
    }
    const existing = result[key]
    result[key] =
      isPlainObject(existing) && isPlainObject(value) ? mergeDeep(existing, value) : value
  }
  return result as T
}

/** Drops `undefined` values recursively — they are keys the wire must not carry. */
export function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(pruneUndefined) as T
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, pruneUndefined(entry)]),
    ) as T
  }
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
