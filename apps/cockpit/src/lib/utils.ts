import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : date.toLocaleString()
}

export function relativeTime(value?: string | null) {
  if (!value) return '—'
  const then = new Date(value).valueOf()
  if (Number.isNaN(then)) return '—'
  const seconds = Math.round((then - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ]
  let value_ = seconds
  for (const [unit, size] of units) {
    if (Math.abs(value_) < size) return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(value_), unit)
    value_ /= size
  }
  return '—'
}
