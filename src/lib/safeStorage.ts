import { createJSONStorage, type StateStorage } from 'zustand/middleware'

/**
 * localStorage writes throw `QuotaExceededError` once storage is full. An
 * unguarded throw out of a Zustand `set()` or a raw `setItem` aborts whatever
 * flow triggered it — e.g. a full quota was killing `useChat.send` mid-flight
 * (the persisted auto-classify store threw on `setPending`), leaving the
 * composer stuck on "Stop" with no request ever sent. These helpers degrade to
 * a no-op write instead, so a full quota costs persistence but never breaks a
 * live flow. Reads/removes still go straight through.
 */

/** setItem that swallows quota/disabled-storage errors. Returns success. */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** Storage adapter for Zustand's `persist` whose writes never throw. */
export const safeJSONStorage = createJSONStorage<unknown>(() => {
  const adapter: StateStorage = {
    getItem: (name) => localStorage.getItem(name),
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, value)
      } catch {
        // Quota exceeded / storage disabled — drop the write.
      }
    },
    removeItem: (name) => {
      try {
        localStorage.removeItem(name)
      } catch {
        // ignore
      }
    },
  }
  return adapter
})
