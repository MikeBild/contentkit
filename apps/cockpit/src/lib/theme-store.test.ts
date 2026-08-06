// The theme store, tested with no DOM at all.
//
// This is the point of the factory: the singleton it replaced touched
// `localStorage` and `matchMedia` at import time, which made the store
// untestable without a browser — and contract/conformance.cockpit-ui.json
// recorded CUI-THEME-1..5 as unenforced for exactly that reason, naming this
// factoring as the fix. These tests are that entry being paid off.
//
// The shapes mirror the sibling console's suite on purpose: two products, one
// contract, and a store that behaves differently in one of them is a store the
// contract does not actually hold.
import { describe, expect, test } from 'vitest'
import {
  createThemeStore,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeEnvironment,
} from './theme-store'

function fakeEnvironment(initial: { stored?: string; prefersDark?: boolean; cookie?: string } = {}) {
  const store = new Map<string, string>()
  if (initial.stored) store.set(THEME_STORAGE_KEY, initial.stored)
  const applied: ResolvedTheme[] = []
  let prefersDark = initial.prefersDark ?? false
  let systemListener: (() => void) | null = null
  let cookie: string | null = initial.cookie ?? null
  const env: ThemeEnvironment = {
    read: (key) => store.get(key) ?? null,
    write: (key, value) => void store.set(key, value),
    remove: (key) => void store.delete(key),
    prefersDark: () => prefersDark,
    apply: (resolved) => void applied.push(resolved),
    watchSystem: (onChange) => {
      systemListener = onChange
      return () => {
        systemListener = null
      }
    },
    writeCookie: (value) => {
      cookie = value
    },
    clearCookie: () => {
      cookie = null
    },
  }
  return {
    env,
    applied,
    store,
    cookie: () => cookie,
    setSystem(dark: boolean) {
      prefersDark = dark
      systemListener?.()
    },
  }
}

describe('the theme store', () => {
  test('with nothing stored it follows the OS — CUI-THEME-2', () => {
    const dark = fakeEnvironment({ prefersDark: true })
    expect(createThemeStore(dark.env).snapshot()).toEqual({ theme: 'system', resolved: 'dark' })
    const light = fakeEnvironment({ prefersDark: false })
    expect(createThemeStore(light.env).snapshot()).toEqual({ theme: 'system', resolved: 'light' })
  })

  test('an explicit choice overrides the OS — CUI-THEME-1', () => {
    const fake = fakeEnvironment({ stored: 'light', prefersDark: true })
    expect(createThemeStore(fake.env).snapshot()).toEqual({ theme: 'light', resolved: 'light' })
  })

  test('garbage in localStorage falls back to system instead of passing through', () => {
    // The singleton this store replaced cast whatever it found straight to
    // `Theme`; a hand-edited value became a "resolved" scheme that was neither
    // light nor dark. The key lives somewhere the user can edit.
    const fake = fakeEnvironment({ stored: 'chartreuse', prefersDark: false })
    expect(createThemeStore(fake.env).snapshot()).toEqual({ theme: 'system', resolved: 'light' })
  })

  test('the snapshot is reference-stable across reads', () => {
    // useSyncExternalStore compares by identity; a snapshot rebuilt per read
    // re-renders every consumer on every unrelated event.
    const store = createThemeStore(fakeEnvironment().env)
    expect(store.snapshot()).toBe(store.snapshot())
  })

  test('every choice can be made — including the way back to system', () => {
    // The defect this suite exists to hold shut: the old 2-way toggle could
    // write light and dark but never delete, so `system` was unreachable after
    // the first click, forever.
    const fake = fakeEnvironment({ prefersDark: true })
    const store = createThemeStore(fake.env)
    store.set('light')
    expect(fake.store.get(THEME_STORAGE_KEY)).toBe('light')
    store.set('system')
    expect(fake.store.has(THEME_STORAGE_KEY)).toBe(false)
    expect(store.snapshot()).toEqual({ theme: 'system', resolved: 'dark' })
  })

  test('a `system` theme tracks the OS changing while the console is open — CUI-THEME-4', () => {
    const fake = fakeEnvironment({ prefersDark: false })
    const store = createThemeStore(fake.env)
    let notified = 0
    store.subscribe(() => (notified += 1))
    fake.setSystem(true)
    expect(store.snapshot().resolved).toBe('dark')
    expect(notified).toBe(1)
    // and the class was applied through the environment
    expect(fake.applied.at(-1)).toBe('dark')
  })

  test('an explicit theme ignores the OS changing', () => {
    const fake = fakeEnvironment({ stored: 'light', prefersDark: false })
    const store = createThemeStore(fake.env)
    fake.setSystem(true)
    expect(store.snapshot().resolved).toBe('light')
  })

  test('setting the theme it already has notifies nobody', () => {
    const store = createThemeStore(fakeEnvironment({ stored: 'dark' }).env)
    let notified = 0
    store.subscribe(() => (notified += 1))
    store.set('dark')
    expect(notified).toBe(0)
  })

  // --- the funnel cookie -----------------------------------------------------
  // The auth funnel is server-rendered under a CSP that allows no script, so it
  // cannot read localStorage. The cookie is the one channel an explicit choice
  // has to reach it.

  test('an explicit choice is mirrored into the funnel cookie', () => {
    const fake = fakeEnvironment()
    const store = createThemeStore(fake.env)
    store.set('dark')
    expect(fake.cookie()).toBe('dark')
    store.set('light')
    expect(fake.cookie()).toBe('light')
  })

  test('choosing `system` deletes the cookie rather than storing the word', () => {
    const fake = fakeEnvironment({ stored: 'dark' })
    const store = createThemeStore(fake.env)
    store.set('system')
    expect(fake.cookie()).toBeNull()
  })

  test('a pre-existing explicit theme with no cookie is reconciled at construction', () => {
    // The healing case: the operator chose dark before the cookie existed.
    const fake = fakeEnvironment({ stored: 'dark' })
    createThemeStore(fake.env)
    expect(fake.cookie()).toBe('dark')
  })

  test('a stale cookie left behind by a cleared localStorage is deleted at construction', () => {
    const fake = fakeEnvironment({ cookie: 'dark' })
    createThemeStore(fake.env)
    expect(fake.cookie()).toBeNull()
  })
})
