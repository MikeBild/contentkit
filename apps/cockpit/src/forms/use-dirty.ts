import { useCallback, useMemo, useRef, useState } from 'react'
import { sameValue } from './path'

/**
 * Dirty state against a baseline, not against a boolean.
 *
 * A `touched` flag says a field was focused, which is not the same as changed —
 * typing a character and deleting it again leaves a form that will warn about
 * losing work that does not exist. Comparing the canonical projection means
 * editing a value back to what it was makes the form clean again, which is what
 * an operator expects and what stops them learning to ignore the warning.
 *
 * `canonical` exists for the values the wire and the UI disagree about: a
 * missing key and an empty string can be the same fact, and only the contract
 * knows which.
 */
export function useDirty<T>(current: T, baseline: T, canonical: (value: T) => unknown = (value) => value) {
  return useMemo(() => !sameValue(canonical(current), canonical(baseline)), [current, baseline, canonical])
}

/**
 * The baseline itself: seeded from the loaded record, replaced on a successful
 * save, restored on reset. Kept beside `useDirty` because every form needs both
 * and getting the second one wrong makes the first one lie.
 */
export function useBaseline<T>(initial: T) {
  const [baseline, setBaseline] = useState(initial)
  // A ref as well: `save()` runs in a callback that must not close over a stale
  // baseline from the render that started it.
  const latest = useRef(baseline)
  latest.current = baseline

  const commit = useCallback((value: T) => {
    latest.current = value
    setBaseline(value)
  }, [])

  return { baseline, commit, read: useCallback(() => latest.current, []) }
}
