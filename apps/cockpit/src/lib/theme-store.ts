/**
 * The theme, as one store rather than one `useState` per caller.
 *
 * The theme is read in two very different places: the chrome, which only needs
 * a class on `<html>`, and every surface that asks the server to rasterise at a
 * colour scheme (src/content/scheme.ts — report charts and Mermaid are drawn
 * server-side, so the scheme is a request parameter, not a stylesheet). With
 * per-hook state the toggle updated only the component holding it: the console
 * turned dark while the rendered fragment kept its light rasterisation. A
 * shared snapshot makes one toggle reach both.
 *
 * No next-themes. The blocking script in index.html has already applied the
 * class before first paint, so this only has to keep it in step afterwards.
 *
 * WHY a factory and not a module-level singleton: the singleton this replaced
 * touched `localStorage` and `matchMedia` at import time, unguarded — a tab
 * with site data blocked threw during module evaluation and took the whole
 * console down, and nothing could test the store without a browser. The
 * sibling console proved the factoring first; this is the same shape, and it is
 * what lets `theme.test.ts` exercise every state transition in a process with
 * no `window` at all. It is also what finally makes the contract's CUI-THEME
 * clauses enforceable here — they were declared unenforced for exactly this
 * reason.
 */
export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'ck-cockpit-theme'

export interface ThemeSnapshot {
  theme: Theme
  resolved: ResolvedTheme
}

/** The browser facts the store needs, named so a test can supply them. */
export interface ThemeEnvironment {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
  /** True when the OS asks for dark. */
  prefersDark(): boolean
  /** Called with every resolved theme, including the first. Applies the class. */
  apply(resolved: ResolvedTheme): void
  /** Subscribe to OS-level changes; returns an unsubscribe. */
  watchSystem?(onChange: () => void): () => void
  /**
   * Subscribe to the SAME key changing in another tab.
   *
   * An operator with the console open twice — a document on one screen, the
   * overview on the other — changes the theme in one and the other stays as it
   * was, indefinitely, because nothing told it. Worse than cosmetic: the two
   * tabs then disagree about what is stored, and the stale one will happily
   * write its old value back the next time anything touches the store.
   */
  watchStorage?(onChange: () => void): () => void
  /**
   * Mirror an EXPLICIT choice where the server can read it.
   *
   * The auth funnel is server-rendered with a CSP that allows no script, so it
   * cannot read localStorage — but its stylesheet carries `.scheme-light` /
   * `.scheme-dark` override classes for exactly this. The cookie is how the
   * choice crosses the boundary: the server reads it and puts the class on
   * `<html>`, and an operator who chose dark stops meeting a white login page.
   *
   * Only `light` and `dark` are ever written. `system` is the absence of the
   * cookie, same as it is the absence of the localStorage key.
   */
  writeCookie?(value: ResolvedTheme): void
  clearCookie?(): void
}

export interface ThemeStore {
  subscribe(listener: () => void): () => void
  /** Identity-stable: `useSyncExternalStore` compares snapshots by reference. */
  snapshot(): ThemeSnapshot
  set(theme: Theme): void
}

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function createThemeStore(env: ThemeEnvironment): ThemeStore {
  function read(): ThemeSnapshot {
    const stored = env.read(THEME_STORAGE_KEY)
    // An unrecognised value falls back to `system` rather than passing through:
    // this key is in a place the user can edit, and the singleton this replaced
    // cast whatever it found straight to `Theme` — a hand-edited value became a
    // "resolved" scheme that was neither light nor dark, and every reader of it
    // misrendered quietly.
    const theme: Theme = isTheme(stored) ? stored : 'system'
    const resolved: ResolvedTheme = theme === 'system' ? (env.prefersDark() ? 'dark' : 'light') : theme
    return { theme, resolved }
  }

  let snapshot = read()
  const listeners = new Set<() => void>()

  function publish(): void {
    const next = read()
    // Reference equality is the contract useSyncExternalStore checks, so the
    // snapshot object is only replaced when something actually changed.
    if (next.theme === snapshot.theme && next.resolved === snapshot.resolved) return
    snapshot = next
    env.apply(snapshot.resolved)
    for (const listener of listeners) listener()
  }

  // `system` follows the OS for as long as the console is open, which outlives
  // every component, so the subscription belongs to the store and not to a hook.
  env.watchSystem?.(publish)

  // Another tab is an external system too, and the store already knows how to
  // reconcile with one: `publish` re-reads and replaces the snapshot only when
  // something actually changed, so a tab that was already in step does nothing.
  env.watchStorage?.(publish)

  // Reconcile the cookie with the stored choice ONCE, at construction. This is
  // what heals every operator who chose dark before the cookie existed: their
  // localStorage says so, no cookie does, and without this their login page
  // stays white until they touch the toggle again.
  if (snapshot.theme === 'system') env.clearCookie?.()
  else env.writeCookie?.(snapshot.theme)

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    snapshot: () => snapshot,
    set(theme) {
      // `system` is the absence of a choice, so it is stored as the absence of
      // a key — and of the cookie. Writing the literal string 'system' would
      // make "follow the OS" indistinguishable from "was once explicitly set to
      // whatever the OS said".
      if (theme === 'system') {
        env.remove(THEME_STORAGE_KEY)
        env.clearCookie?.()
      } else {
        env.write(THEME_STORAGE_KEY, theme)
        env.writeCookie?.(theme)
      }
      publish()
    },
  }
}
