import { checkUrl } from '../fields/url'
import type { FieldErrors } from './contract'

// The server's own rules, restated once. Every one of these has a counterpart in
// src/repository.mjs or src/routes.mjs, and the console is only allowed to be
// stricter where it is about to be told "no" anyway — never more permissive,
// which would turn a form error into a 422 the operator cannot act on.

const encoder = new TextEncoder()

export function byteLength(value: string) {
  return encoder.encode(value).length
}

export const rules = {
  required(value: unknown, message = 'Required') {
    const empty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0)
    return empty ? message : undefined
  },
  maxBytes(value: string, limit: number) {
    const size = byteLength(value)
    return size > limit ? `${size - limit} bytes over the ${limit}-byte limit` : undefined
  },
  /** Anything inlined into a `<style>` element; `<` is what could terminate it. */
  styleSafe(value: string) {
    return value.includes('<') ? '“<” is not allowed here' : undefined
  },
  customCss(value: string) {
    return value.toLowerCase().includes('</style') ? '“</style” would break out of the style element' : undefined
  },
  slug(value: string) {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? undefined : 'Lower-case letters, digits and single hyphens'
  },
  locale(value: string) {
    return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(value) ? undefined : 'A language tag like “de” or “de-at”'
  },
  url(value: string, protocols?: string[]) {
    return checkUrl(value, { protocols }).error
  },
  extraKey(value: string) {
    return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? undefined : 'Lower-case letters, digits and underscores'
  },
  oneOf<T extends string>(value: string, allowed: readonly T[]) {
    return (allowed as readonly string[]).includes(value) ? undefined : `Must be one of ${allowed.join(', ')}`
  },
}

/** Collects rule results under their paths, dropping the ones that passed. */
export function collect(entries: [string, string | undefined][]): FieldErrors {
  const errors: FieldErrors = {}
  for (const [path, message] of entries) if (message && !errors[path]) errors[path] = message
  return errors
}

/** Merges validator output, keeping the first message per path. */
export function mergeErrors(...groups: FieldErrors[]): FieldErrors {
  const errors: FieldErrors = {}
  for (const group of groups) for (const [path, message] of Object.entries(group)) if (!errors[path]) errors[path] = message
  return errors
}

/**
 * Turns one 422 into field errors.
 *
 * The server answers `{ error: 'settings.theme.tokens: unknown token "radiuz"' }`
 * — a sentence, with the path at the front. Recovering the path is what puts the
 * message under the control that caused it; the ones that do not parse are
 * returned unattached so the caller can surface them instead of dropping them.
 */
export function errorsFromResponse(message: string, knownPaths: readonly string[]): FieldErrors {
  const [, path, rest] = /^([a-z0-9_]+(?:\.[a-z0-9_]+)+)\s*[:—-]\s*(.+)$/i.exec(message) ?? []
  if (!path || !rest) return {}
  // Only claim a path the form actually renders. Anything else has to reach the
  // operator as a message rather than sit invisibly against a field nobody sees.
  const owner = knownPaths.find((candidate) => path === candidate || path.startsWith(`${candidate}.`))
  return owner ? { [owner]: rest } : {}
}
