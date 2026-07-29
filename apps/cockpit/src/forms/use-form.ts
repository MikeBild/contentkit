import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getIn, sameValue, setIn } from './path'
import { useBaseline, useDirty } from './use-dirty'
import type { FieldErrors, ValidationContext } from './contracts/contract'
import { errorsFromResponse, mergeErrors } from './contracts/validators'

export type SectionTone = 'neutral' | 'ok' | 'warning' | 'error'

export interface SectionSpec<UI> {
  id: string
  label: string
  /** Dotted path prefixes this section owns. Also what routes a server error to it. */
  paths: readonly string[]
  /**
   * What the section says when it is fine — "3 series", "no endpoint yet".
   * A status dot with no words tells the operator a section is wrong but not
   * which section to open, which is the entire question.
   */
  summary?: (values: UI) => string | undefined
  /** Accepted, but worth saying out loud. Never blocks the save. */
  warning?: (values: UI) => string | undefined
}

export interface SectionStatus {
  tone: SectionTone
  text: string
  errors: number
}

export interface UseFormOptions<UI> {
  initial: UI
  /** Runs on every change. The same verdicts the server would reach. */
  validate?: (values: UI, context: ValidationContext) => FieldErrors
  /** The projection the dirty check compares. Defaults to the values themselves. */
  canonical?: (values: UI) => unknown
  context?: ValidationContext
  sections?: readonly SectionSpec<UI>[]
  /** Persists and resolves with what was stored, which becomes the new baseline. */
  onSave: (values: UI) => Promise<UI | void>
}

/**
 * The form state every editor in the console shares.
 *
 * It is small on purpose. What it does own is the three things that were being
 * re-invented per page and got re-invented differently each time: an immutable
 * path-based `set`, a dirty comparison against a baseline rather than a touched
 * flag, and the routing of server errors onto fields — including the ones that
 * belong to no field, which are handed back rather than swallowed. A 422 naming
 * a key the form does not render must still reach the operator; that is the
 * whole reason `unassigned` exists.
 */
export function useForm<UI>({
  initial,
  validate,
  canonical,
  context,
  sections,
  onSave,
}: UseFormOptions<UI>) {
  const [values, setValues] = useState(initial)
  const { baseline, commit } = useBaseline(initial)
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [unassigned, setUnassigned] = useState<string | null>(null)
  const [isSaving, setSaving] = useState(false)
  const latest = useRef(values)
  latest.current = values

  // A record that arrived or changed underneath replaces an untouched form.
  // Silently overwriting an edited one would be worse than a stale view, so a
  // dirty form keeps what the operator typed.
  //
  // The comparison is by value, not by identity: callers build `initial` from a
  // query result and hand over a fresh object on every render, so an
  // identity check would re-seed the form forever.
  const project = useMemo(() => canonical ?? ((value: UI) => value), [canonical])
  const dirty = useDirty(values, baseline, project)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const baselineRef = useRef(baseline)
  baselineRef.current = baseline
  useEffect(() => {
    if (dirtyRef.current || sameValue(project(initial), project(baselineRef.current))) return
    setValues(initial)
    commit(initial)
  }, [initial, commit, project])

  const localErrors = useMemo(() => validate?.(values, context ?? {}) ?? {}, [validate, values, context])
  const errors = useMemo(() => mergeErrors(localErrors, serverErrors), [localErrors, serverErrors])

  const set = useCallback((path: string, value: unknown) => {
    setValues((current) => setIn(current, path, value))
    // A field the operator has just corrected must stop showing the server's
    // old complaint about it — the message is about a value that no longer
    // exists, and leaving it there makes the form look permanently broken.
    setServerErrors((current) => {
      if (!(path in current)) return current
      const { [path]: _cleared, ...rest } = current
      return rest
    })
  }, [])

  const reset = useCallback(() => {
    setValues(baseline)
    setServerErrors({})
    setUnassigned(null)
  }, [baseline])

  const knownPaths = useMemo(() => sections?.flatMap((section) => section.paths) ?? [], [sections])

  const save = useCallback(async () => {
    if (Object.keys(localErrors).length > 0) return false
    setSaving(true)
    setUnassigned(null)
    try {
      const stored = await onSave(latest.current)
      const next = (stored ?? latest.current) as UI
      setValues(next)
      commit(next)
      setServerErrors({})
      return true
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'The save failed'
      const routed = errorsFromResponse(message, knownPaths)
      setServerErrors(routed)
      // Nothing claimed it, so it becomes the caller's toast. An error with no
      // home is the one that must not disappear.
      if (Object.keys(routed).length === 0) setUnassigned(message)
      return false
    } finally {
      setSaving(false)
    }
  }, [localErrors, onSave, commit, knownPaths])

  const sectionStatus = useCallback(
    (id: string): SectionStatus => {
      const section = sections?.find((entry) => entry.id === id)
      if (!section) return { tone: 'neutral', text: '', errors: 0 }
      const owned = Object.keys(errors).filter((path) =>
        section.paths.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)),
      )
      if (owned.length) {
        return {
          tone: 'error',
          // The count and the first message: enough to decide whether to open
          // this section now without opening it to find out.
          text: owned.length === 1 ? errors[owned[0]!]! : `${owned.length} problems`,
          errors: owned.length,
        }
      }
      const warning = section.warning?.(values)
      if (warning) return { tone: 'warning', text: warning, errors: 0 }
      const summary = section.summary?.(values)
      return { tone: summary ? 'ok' : 'neutral', text: summary ?? '', errors: 0 }
    },
    [sections, errors, values],
  )

  return {
    values,
    set,
    /** For a whole-subtree replacement — an optional section switched on or off. */
    setAll: setValues,
    errors,
    fieldError: useCallback((path: string) => errors[path], [errors]),
    valueAt: useCallback((path: string) => getIn(values, path), [values]),
    dirty,
    isSaving,
    /** Blocks the save. Everything else is reported without stopping it. */
    canSave: dirty && !isSaving && Object.keys(localErrors).length === 0,
    unassignedError: unassigned,
    clearUnassigned: useCallback(() => setUnassigned(null), []),
    save,
    reset,
    sectionStatus,
  }
}
