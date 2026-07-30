import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
// Registers the DOM matchers AND their types. It has to be a real import rather
// than a `types` entry in tsconfig.json: `tsconfig.json` pins
// `types: ["vite/client"]` for the app build, and this module's augmentation of
// vitest's `Assertion` travels with the import instead — so `tsc --noEmit`, the
// cockpit's only safety net, type-checks `toHaveFocus` and `toHaveAccessibleName`
// along with the app.
import '@testing-library/jest-dom/vitest'

/**
 * What jsdom does not ship, and the console assumes.
 *
 * Only the gaps that a real browser fills and jsdom leaves as `undefined` are
 * filled here, and nothing that the assertions depend on. In particular focus is
 * NOT stubbed in any form: `document.activeElement`, `focus()` and the
 * focus/blur event order are jsdom's own, because they are the subject.
 */

// `next-themes` and `use-mobile` both read a media query on mount, and jsdom has
// no matchMedia at all — an unhandled TypeError before a single assertion runs.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// Radix's popper and scroll-area measure their content. jsdom has no layout, so
// the observer never fires meaningful boxes — but it has to exist to be called.
if (!('ResizeObserver' in window)) {
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom implements neither, and Radix calls both while managing focus inside a
// listbox or a scrolled dialog.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false
  }
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = function releasePointerCapture() {}
}

// Each test starts on an empty document, so a dialog left open by one test can
// never be the dialog a later test finds by role.
afterEach(() => {
  cleanup()
})
