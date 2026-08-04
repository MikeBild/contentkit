// Structured clone drops an Error's own properties, and `statusCode`/`code` are
// what decide the HTTP status a publish caller sees. Without this codec a 422
// ("unknown docs version v3") crosses the thread boundary as a 500, and a deck
// TIMEOUT stops being recognisable to the release manager's failure accounting.
// Kept in its own module so the parent can revive without importing — and thus
// executing — the worker entry point.
export function serializeBuildError(error) {
  return {
    message: String(error?.message ?? error),
    name: error?.name || 'Error',
    stack: error?.stack || null,
    statusCode: error?.statusCode ?? null,
    code: error?.code ?? null,
    stalePublish: error?.stalePublish ?? null,
  }
}

export function reviveBuildError(shape) {
  const error = new Error(shape?.message || 'site build failed')
  error.name = shape?.name || 'Error'
  if (shape?.stack) error.stack = shape.stack
  if (shape?.statusCode != null) error.statusCode = shape.statusCode
  if (shape?.code != null) error.code = shape.code
  if (shape?.stalePublish) error.stalePublish = shape.stalePublish
  return error
}
