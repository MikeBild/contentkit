import { openDB, type IDBPDatabase } from 'idb'

// Conversation history stays on the operator's own machine. The alternative —
// a second Postgres alongside ContentKit's — would add a database, migrations
// and a retention policy for something no other part of the product reads.
const DB_NAME = 'contentkit-cockpit'
const STORE = 'conversations'
const CURRENT = 'current'

let database: Promise<IDBPDatabase> | null = null

function db() {
  database ??= openDB(DB_NAME, 1, {
    upgrade(instance) {
      if (!instance.objectStoreNames.contains(STORE)) instance.createObjectStore(STORE)
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
