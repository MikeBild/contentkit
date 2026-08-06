import { useSyncExternalStore } from 'react'

/**
 * The clock, as an external store.
 *
 * `Date.now()` called during render is impure — two renders of the same
 * component produce different output, which is exactly the thing React's rules
 * forbid and exactly the thing that makes a "last 24 hours" window shift under
 * a memo boundary in ways nobody can reproduce. The clock IS an external system,
 * so it is subscribed to like one: one tick per second, one shared snapshot,
 * every reader agreeing on what "now" is.
 *
 * That agreement is not academic. Both session clocks on the profile page and
 * every relative timestamp beside them are read against this value; sampled
 * independently they drift apart by a render, and a session can read as expiring
 * in two different numbers within one paint.
 *
 * The sibling console carries the same hook for the same reason. Two products,
 * one rule — a clock is an external system, not a value you may read during
 * render.
 */
const TICK_MS = 1000

let tick = Date.now()
const listeners = new Set<() => void>()

// One interval for the tab, not one per component. Started lazily on the first
// subscription and stopped when the last one leaves, so a console sitting on a
// static page is not waking the event loop every second for nothing.
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!timer) {
    timer = setInterval(() => {
      tick = Date.now()
      for (const each of listeners) each()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => tick,
    // Server snapshot: never used here (this console does not render on a
    // server) but required by the signature, and returning the same value keeps
    // it from being a second, disagreeing clock if that ever changes.
    () => tick,
  )
}
