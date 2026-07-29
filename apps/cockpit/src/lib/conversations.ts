import { openDB, type IDBPDatabase } from 'idb'

// Conversation history stays on the operator's own machine. The alternative —
// a second Postgres alongside ContentKit's — would add a database, migrations
// and a retention policy for something no other part of the product reads.
const DB_NAME = 'contentkit-cockpit'
const STORE = 'conversations'
const RENDERS = 'renders'
const CURRENT = 'current'

let database: Promise<IDBPDatabase> | null = null

function db() {
  database ??= openDB(DB_NAME, 2, {
    upgrade(instance) {
      if (!instance.objectStoreNames.contains(STORE)) instance.createObjectStore(STORE)
      if (!instance.objectStoreNames.contains(RENDERS)) instance.createObjectStore(RENDERS)
    },
  })
  return database
}

export async function loadConversation<T = unknown>(): Promise<T[]> {
  try {
    return ((await (await db()).get(STORE, CURRENT)) as T[] | undefined) ?? []
  } catch {
    // A blocked or unavailable IndexedDB must not take the console down with
    // it; the conversation simply does not survive the reload.
    return []
  }
}

export async function saveConversation(messages: unknown[]): Promise<void> {
  try {
    await (await db()).put(STORE, messages, CURRENT)
  } catch {
    /* see above */
  }
}

/**
 * The server-rendered HTML of one finished message, stored beside the message
 * it belongs to. Without it a reload re-renders the whole conversation on the
 * server for a result that cannot have changed.
 */
export async function loadRender(key: string): Promise<string | null> {
  try {
    return ((await (await db()).get(RENDERS, key)) as string | undefined) ?? null
  } catch {
    return null
  }
}

export async function saveRender(key: string, html: string): Promise<void> {
  try {
    await (await db()).put(RENDERS, html, key)
  } catch {
    /* see above */
  }
}

/** Starting a new conversation drops its renderings with it. */
export async function clearRenders(): Promise<void> {
  try {
    await (await db()).clear(RENDERS)
  } catch {
    /* see above */
  }
}
