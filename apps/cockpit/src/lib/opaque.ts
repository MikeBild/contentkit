const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isOpaqueIdentifier(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value.trim())
}

export function visibleLabel(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const label = value.trim()
    if (label && !isOpaqueIdentifier(label)) return label
  }
  return undefined
}

export function visibleMetadata(value: unknown): string | undefined {
  if (typeof value === 'string') return visibleLabel(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}
