import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'ck-cockpit-theme'
export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

function resolve(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function read(): { theme: Theme; resolved: ResolvedTheme } {
  const theme = (localStorage.getItem(STORAGE_KEY) as Theme) || 'system'
  return { theme, resolved: resolve(theme) }
}

/**
 * One store, not one `useState` per caller.
 *
 * The theme is read in two very different places: the chrome, which only needs a
 * class on `<html>`, and every surface that asks the server to rasterise at a
 * colour scheme (src/content/scheme.ts — report charts and Mermaid are drawn
 * server-side, so the scheme is a request parameter, not a stylesheet). With
 * per-hook state the toggle updated only the component holding it: the console
 * turned dark while the rendered fragment kept its light rasterisation, and no
 * re-render was ever requested because the reader's copy of the theme never
 * changed. A shared snapshot makes one toggle reach both.
 *
 * No next-themes: the blocking script in index.html has already applied the
 * class before first paint, so this only has to keep it in step afterwards.
 *
 * `useSyncExternalStore` compares snapshots by identity, so the snapshot is a
 * stored object rather than one rebuilt on every read.
 */
let snapshot = read()
const listeners = new Set<() => void>()

function publish() {
  const next = read()
  if (next.theme === snapshot.theme && next.resolved === snapshot.resolved) return
  snapshot = next
  document.documentElement.classList.toggle('dark', snapshot.resolved === 'dark')
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// A `system` theme follows the OS for as long as the console is open, and that
// outlives every component, so the listener is registered once here.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', publish)

function setTheme(next: Theme) {
  if (next === 'system') localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, next)
  publish()
}

export function useTheme() {
  const current = useSyncExternalStore(subscribe, () => snapshot)
  return { theme: current.theme, resolved: current.resolved, setTheme }
}
