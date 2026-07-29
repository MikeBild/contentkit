/**
 * Putting a whole-object write back together.
 *
 * `PATCH /v1/sites/{site}` replaces `settings` in full and lets unknown keys
 * through untouched. Both halves of that sentence matter: a form that sends only
 * what it renders deletes everything else, and a form that refuses to send
 * anything it does not understand can never save at all. So the form takes the
 * whole received object apart into "mine" and "carried", edits the first, and
 * puts them back together here.
 *
 * Only the reassembly lives here. Splitting the object is `omitPaths` in
 * forms/site/contract.ts, which works on exact leaf paths rather than top-level
 * keys — a second, top-level-only splitter used to sit alongside `mergeDeep`
 * with no caller, which is one description of the split too many.
 */

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
    result[key] = isPlainObject(existing) && isPlainObject(value) ? mergeDeep(existing, value) : value
  }
  return result as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
