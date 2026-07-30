/**
 * The one shortcut the console has, and the platform it has to match.
 *
 * ⌘K on Apple hardware and Ctrl+K everywhere else is not a preference: on a Mac
 * Ctrl+K is "delete to end of line" in every text field, and on Windows and Linux
 * there is no ⌘ to press. Printing the wrong one in the hint is worse than
 * printing none, because the operator then learns that the hints lie.
 *
 * Both functions take their platform as an argument so the rule is testable
 * without a browser; the component supplies `navigator`.
 */

export interface PlatformLike {
  platform?: string
  userAgent?: string
}

/**
 * `navigator.platform` is deprecated and still the only thing that answers on
 * every engine, so the user agent string is read as well — an iPad reports
 * 'MacIntel' in one and 'iPad' in the other depending on the browser.
 */
export function isApplePlatform(navigatorLike: PlatformLike): boolean {
  return /mac|iphone|ipad|ipod/i.test(`${navigatorLike.platform ?? ''} ${navigatorLike.userAgent ?? ''}`)
}

export function modifierLabel(apple: boolean): string {
  return apple ? '⌘' : 'Ctrl'
}

export interface KeyChord {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/**
 * Whether an event is *this* chord — the platform's modifier and nothing else.
 *
 * Every other combination is somebody else's: ⌥⌘K and ⇧⌘K belong to the browser
 * or the OS, ⌃⌘K is a third chord again, and a bare "k" is the letter the
 * operator is typing into a field. Claiming any of them with `preventDefault()`
 * breaks a shortcut the operator already has.
 */
export function isShortcut(event: KeyChord, letter: string, apple: boolean): boolean {
  if (event.key.toLowerCase() !== letter.toLowerCase()) return false
  if (event.altKey || event.shiftKey) return false
  return apple ? Boolean(event.metaKey) && !event.ctrlKey : Boolean(event.ctrlKey) && !event.metaKey
}
