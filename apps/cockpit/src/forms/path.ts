/**
 * Dotted-path get/set over plain objects and arrays.
 *
 * `FieldErrors` from the server already speak this language
 * (`presentation.docs.versions.2.label`), so the form speaks it too rather than
 * translating twice. Twenty lines instead of a form library: the console needs
 * exactly this and none of the rest.
 */
export function getIn(target: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((node, key) => (node == null ? undefined : (node as Record<string, unknown>)[key]), target)
}

/** Immutable: every container on the path is copied, everything else is shared. */
export function setIn<T>(target: T, path: string, value: unknown): T {
  const keys = path.split('.').filter(Boolean)
  if (keys.length === 0) return value as T

  const [key, ...rest] = keys as [string, ...string[]]
  const index = Number(key)
  // A numeric segment means an array — but only if there is an array here.
  // Guessing the container from the key alone turns `{ '0': … }` into a list.
  if (Array.isArray(target) && Number.isInteger(index)) {
    const copy = [...target] as unknown[]
    copy[index] = rest.length ? setIn(copy[index], rest.join('.'), value) : value
    return copy as T
  }
  const source = (target ?? {}) as Record<string, unknown>
  const child = rest.length ? setIn(source[key], rest.join('.'), value) : value
  // `undefined` removes the key rather than storing it: a settings object with
  // an explicit `undefined` serialises to a key the server then validates.
  if (child === undefined) {
    const { [key]: _removed, ...remaining } = source
    return remaining as T
  }
  return { ...source, [key]: child } as T
}

/**
 * A stable serialisation for comparison. `JSON.stringify` on two objects that
 * differ only in key order reports a change nobody made — which, for a dirty
 * flag, means an unsaved-changes prompt on a form nobody touched.
 */
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonicalise(entry)]),
    )
  }
  return value
}

export function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(canonicalise(a)) === JSON.stringify(canonicalise(b))
}
