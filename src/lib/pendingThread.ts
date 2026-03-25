/**
 * IndexedDB-based pending thread for iOS PWA push notification deep links.
 * The service worker writes { threadId, ts } on notification click.
 * The app reads + clears it on startup / visibilitychange.
 */

const DB_NAME = 'clavus-push'
const STORE = 'kv'
const KEY = 'pendingThread'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Read and clear the pending thread from IndexedDB.
 * Returns threadId if one was pending (and less than 60s old), null otherwise.
 */
export async function consumePendingThread(): Promise<string | null> {
  try {
    const db = await openDB()

    // Read
    const value = await new Promise<{ threadId: string; ts: number } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(req.result as { threadId: string; ts: number } | undefined)
      req.onerror = () => reject(req.error)
    })

    if (!value?.threadId) {
      db.close()
      return null
    }

    // Expire after 60s (stale clicks)
    if (Date.now() - value.ts > 60_000) {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      await new Promise<void>((resolve) => { tx.oncomplete = () => resolve() })
      db.close()
      return null
    }

    // Clear it
    const delTx = db.transaction(STORE, 'readwrite')
    delTx.objectStore(STORE).delete(KEY)
    await new Promise<void>((resolve) => { delTx.oncomplete = () => resolve() })

    db.close()
    return value.threadId
  } catch {
    return null
  }
}
