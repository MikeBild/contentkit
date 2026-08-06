import { useSyncExternalStore } from 'react'
import {
  createThemeStore,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type Theme,
  type ThemeEnvironment,
  type ThemeStore,
} from './theme-store'

/**
 * The browser half of the theme store: the DOM facts, and the React binding.
 *
 * Kept apart from theme-store.ts so the store itself stays a pure module the
 * test runner can exercise with no DOM at all.
 *
 * Every localStorage access is guarded — it throws outright in a tab where the
 * user has blocked site data, and a colour preference is not worth a blank
 * screen. The singleton this replaced was unguarded at module scope, which made
 * that failure a crash during import rather than a fallback.
 */
function browserThemeEnvironment(): ThemeEnvironment {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  return {
    read: (key) => {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },
    write: (key, value) => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        /* private mode: the class still applies for this tab's lifetime */
      }
    },
    remove: (key) => {
      try {
        window.localStorage.removeItem(key)
      } catch {
        /* as above */
      }
    },
    prefersDark: () => media.matches,
    apply: (resolved) => document.documentElement.classList.toggle('dark', resolved === 'dark'),
    watchSystem: (onChange) => {
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    // The cookie shares the localStorage key's NAME on purpose: one string for
    // one concept, greppable across both storages.
    //
    // Deliberately NOT HttpOnly — this code is what writes it. Deliberately not
    // `__Host-` — that prefix requires Secure, which breaks the http dev origin,
    // and this cookie carries no authority: the worst an attacker who can set
    // cookies for this origin achieves with it is a dark login page. Say that
    // here so nobody later "hardens" it and silently kills the feature.
    writeCookie: (value) => {
      try {
        const secure = window.location.protocol === 'https:' ? '; Secure' : ''
        document.cookie = `${THEME_STORAGE_KEY}=${value}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`
      } catch {
        /* a blocked cookie jar costs the funnel the preference, nothing else */
      }
    },
    clearCookie: () => {
      try {
        document.cookie = `${THEME_STORAGE_KEY}=; Path=/; SameSite=Lax; Max-Age=0`
      } catch {
        /* as above */
      }
    },
  }
}

// ONE store for the whole tab. The theme is read by the chrome (which needs a
// class) and by every surface that asks the server to rasterise at a scheme
// (src/content/scheme.ts), and per-component state would leave the second group
// on the old theme forever.
const store: ThemeStore = createThemeStore(browserThemeEnvironment())

export { THEME_STORAGE_KEY }
export type { Theme, ResolvedTheme }

export function useTheme(): { theme: Theme; resolved: ResolvedTheme; setTheme: (theme: Theme) => void } {
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  return { theme: snapshot.theme, resolved: snapshot.resolved, setTheme: store.set }
}
