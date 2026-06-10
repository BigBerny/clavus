import { useThreadsStore } from './threads'

/**
 * Per-thread activity tracking that powers the "smart open" behavior:
 * when the app opens (page load / Tauri window re-shown), we land on Home
 * UNLESS a conversation either
 *   (a) has an answer the user hasn't seen yet, or
 *   (b) the user wrote in it within the last 15 minutes,
 * in which case we land directly in that conversation (mirrors the design
 * mockup's `loadLastChat` resume).
 *
 * Tracking is device-local (localStorage) — "read" is about what was on THIS
 * screen.
 */

const READ_KEY = 'clavus:lastReadAt'
const WROTE_KEY = 'clavus:lastWroteAt'
export const RECENT_WRITE_MS = 15 * 60 * 1000

type StampMap = Record<string, number>

function load(key: string): StampMap {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function save(key: string, map: StampMap) {
  try {
    // Prune entries older than 30 days so the maps don't grow forever.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const pruned: StampMap = {}
    for (const [id, ts] of Object.entries(map)) if (ts > cutoff) pruned[id] = ts
    localStorage.setItem(key, JSON.stringify(pruned))
  } catch {
    /* quota/private mode — tracking is best-effort */
  }
}

export function markThreadRead(threadId: string) {
  const map = load(READ_KEY)
  map[threadId] = Date.now()
  save(READ_KEY, map)
}

export function markUserWrote(threadId: string) {
  const map = load(WROTE_KEY)
  map[threadId] = Date.now()
  save(WROTE_KEY, map)
}

/**
 * Decide which conversation (if any) the app should open directly into.
 *
 * Returns the thread id, or null for Home. When several threads qualify, the
 * most recently updated one wins.
 */
export function getSmartOpenThreadId(): string | null {
  const reads = load(READ_KEY)
  const writes = load(WROTE_KEY)
  const now = Date.now()

  const candidates = useThreadsStore.getState().threads.filter((t) => {
    if (t.archived) return false
    // (b) user wrote in this conversation within the last 15 minutes
    const wroteAt = writes[t.id] ?? 0
    if (now - wroteAt < RECENT_WRITE_MS) return true
    // (a) unread answer: the thread changed after the user last had it on
    // screen. (If the change was the user's own message, the wrote-recently
    // branch above already covers the fresh case; stale own-message-only
    // threads fall through to Home, which is the right default.)
    const readAt = reads[t.id] ?? 0
    if (readAt > 0 && t.updatedAt > readAt + 1000 && now - wroteAt >= RECENT_WRITE_MS) {
      // Only treat as unread if something happened since the user last wrote —
      // i.e. the update is plausibly an answer, not their own parting message.
      return t.updatedAt > wroteAt + 1000
    }
    return false
  })

  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.updatedAt - a.updatedAt)
  return candidates[0].id
}
