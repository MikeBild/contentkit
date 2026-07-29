import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'ck-cockpit-theme'
export type Theme = 'light' | 'dark' | 'system'

function resolve(theme: Theme) {
  if (theme !== 'system') return theme
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * No next-themes: the blocking script in index.html has already applied the
 * class before first paint, so this hook only has to keep it in step.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem(STORAGE_KEY) as Theme) || 'system')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolve(theme) === 'dark')
    if (theme !== 'system') return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const sync = () => document.documentElement.classList.toggle('dark', media.matches)
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    if (next === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  return { theme, setTheme, resolved: resolve(theme) }
}
