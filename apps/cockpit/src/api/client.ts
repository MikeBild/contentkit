import createClient, { type BodySerializer, type Middleware } from 'openapi-fetch'
import type { paths } from './schema'

// Same origin, always: the Cockpit is served by ContentKit itself, so there is
// no base URL to configure, no CORS to negotiate and no credential to hold in
// the browser. The operator session cookie travels automatically.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** A 401 means the session is gone, not that the request was malformed. */
  get isUnauthenticated() {
    return this.status === 401
  }

  get isForbidden() {
    return this.status === 403
  }
}

let csrfToken = ''

/** Set from GET /v1/identity/session; every mutation echoes it back. */
export function setCsrfToken(token: string) {
  csrfToken = token
}

/**
 * For the requests that cannot go through this client — the assistant's chat
 * stream is driven by the AI SDK's own transport — the token has to be readable
 * so those callers can attach the header themselves. It cannot be recovered
 * from `document.cookie`: the CSRF cookie is HttpOnly by design.
 */
export function getCsrfToken() {
  return csrfToken
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const csrf: Middleware = {
  async onRequest({ request }) {
    if (MUTATING.has(request.method)) request.headers.set('x-contentkit-csrf', csrfToken)
    return request
  },
}

// openapi-fetch returns `{data, error}`; the Cockpit prefers exceptions so that
// TanStack Query's error states and retry logic do the work uniformly.
const raise: Middleware = {
  async onResponse({ response }) {
    if (response.ok) return response
    let body: unknown
    let code = 'request_failed'
    let message = `${response.status} ${response.statusText}`
    try {
      body = await response.clone().json()
      const record = body as Record<string, unknown>
      if (typeof record.error === 'string') {
        code = record.error
        message = typeof record.message === 'string' ? record.message : record.error
      }
    } catch {
      // A non-JSON error body (an HTML error page, an empty 502) still has to
      // surface as a typed failure rather than a parse crash.
    }
    throw new ApiError(response.status, code, message, body)
  },
}

/**
 * Markdown goes on the wire as Markdown.
 *
 * openapi-fetch's default serializer JSON-stringifies every body that is not
 * FormData or form-urlencoded — it never looks at a declared `text/*` type. The
 * two operations that send a raw document (`POST /v1/sites/{site}/content` and
 * `PUT /v1/content/{item}/revisions`) would therefore arrive quoted, with their
 * newlines escaped, and the server would read a single line with no frontmatter
 * fence: `422 frontmatter title is required` on every save the console makes.
 *
 * A string is already a valid `BodyInit`, so it is sent verbatim. Nothing else
 * changes: no request body in the spec is a bare JSON string, so passing objects
 * on to `JSON.stringify` keeps every other call identical.
 */
const serializeBody: BodySerializer<unknown> = (payload) =>
  typeof payload === 'string' ? payload : JSON.stringify(payload)

export const api = createClient<paths>({ credentials: 'same-origin', bodySerializer: serializeBody })
api.use(csrf)
api.use(raise)

/** Unwraps openapi-fetch's `{data}` envelope; errors already threw in middleware. */
export async function unwrap<T>(promise: Promise<{ data?: T }>): Promise<T> {
  const { data } = await promise
  return data as T
}

/**
 * Same unwrap, but for the operations whose response the spec describes in
 * prose only — the generated type is `undefined` there, so the shape has to be
 * asserted from src/repository.mjs instead. Every call site is therefore a
 * precise inventory of what is still missing a schema in src/openapi.mjs.
 */
export async function unwrapAs<T>(promise: Promise<{ data?: unknown }>): Promise<T> {
  const { data } = await promise
  return data as T
}

/**
 * Bodies the spec types as an empty object (`{type: object, required: []}`)
 * cannot be expressed in TypeScript without discarding the value, so the cast
 * is isolated here rather than repeated at two dozen call sites.
 */
export function body<T>(value: T) {
  return value as never
}
