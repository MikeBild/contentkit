/** `{ 'presentation.docs.versions.2.label': 'Required' }` — dotted, flat, one message each. */
export type FieldErrors = Record<string, string>

export interface ValidationContext {
  /** The site's base URL, for fields that resolve a relative value against it. */
  baseUrl?: string
  /** Locales configured on the site, for anything that has to name one. */
  locales?: readonly string[]
  /** The granting operator's own scopes — nothing above this may be offered. */
  ceiling?: readonly string[]
}

/**
 * The only place that knows the wire format of one resource.
 *
 * Every one of the four members exists because of a specific failure:
 *
 * - `detect` is total. Settings are one jsonb blob written by three versions of
 *   this product and by scripts; a shape the form has never seen must become a
 *   safe default, never a crash and never a silent overwrite.
 * - `serialize` is lossless for keys the UI does not own. `PATCH /v1/sites/{site}`
 *   replaces `settings` wholesale, so anything the form did not render but
 *   received has to be carried back out or it is deleted by saving an unrelated
 *   field.
 * - `validate` mirrors the server. One invalid key fails the whole request with
 *   a 422, so the form has to reach the same verdict before sending — otherwise
 *   an operator loses every edit on the page to one bad value.
 * - `canonical` is the projection the dirty check compares. Key order, absent
 *   versus empty, `undefined` versus missing: without a normalised view the form
 *   claims unsaved changes nobody made.
 */
export interface Contract<UI, Wire> {
  detect(wire: Wire | undefined): UI
  serialize(ui: UI, carried: Wire): Wire
  validate(ui: UI, context: ValidationContext): FieldErrors
  canonical(ui: UI): unknown
}
