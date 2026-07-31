import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * An exact instant, spelled out.
 *
 * Deliberately not relative: this is what the audit log and the revision history
 * print, where the ordering of two entries seconds apart is the whole point.
 * `lib/relative-time.ts` is the other half — it prints "vor 2 Stunden" where
 * recency is what matters and keeps the exact instant reachable in a `title` and
 * a `<time datetime>`. A second, coarser `relativeTime()` used to sit below this
 * one with no callers at all; it is deliberately gone.
 */
export function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString()
}
