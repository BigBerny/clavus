/**
 * Where should a freshly-opened surface (app window or assistant overlay)
 * land? The shared rule, in priority order:
 *
 *   1. An explicitly preferred thread (the overlay syncs to the window's
 *      currently visible conversation).
 *   2. The most recent conversation with an UNSEEN assistant answer —
 *      `lastSeenAt` syncs across devices through the regular thread sync,
 *      so an answer read on the phone doesn't reopen here.
 *   3. The last conversation used within the past 15 minutes (either
 *      surface writes it).
 *   4. Home.
 */

import { useThreadsStore, loadThreadMessages } from '../state/threads'

const LAST_CHAT_KEY = 'clavus-overlay-last-chat'
const RESUME_MS = 15 * 60 * 1000
/** Ignore sub-1.5s updatedAt/lastSeenAt skew from the seen-marking itself. */
const UNSEEN_SLACK_MS = 1500

export function recordLastChat(threadId: string | null) {
  try {
    if (threadId) localStorage.setItem(LAST_CHAT_KEY, JSON.stringify({ threadId, ts: Date.now() }))
    else localStorage.removeItem(LAST_CHAT_KEY)
  } catch { /* ignore */ }
}

function recentChatId(): string | null {
  try {
    const raw = localStorage.getItem(LAST_CHAT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as { threadId?: string; ts?: number }
    if (d.threadId && typeof d.ts === 'number' && Date.now() - d.ts < RESUME_MS) return d.threadId
  } catch { /* ignore */ }
  return null
}

function unseenAnswerThreadId(): string | null {
  const threads = useThreadsStore.getState().threads
    .filter((t) => !t.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  for (const t of threads.slice(0, 10)) {
    // Threads never marked seen anywhere are skipped — flagging the entire
    // backlog as "unseen" on rollout would be wrong.
    if (t.lastSeenAt == null) continue
    if (t.updatedAt <= t.lastSeenAt + UNSEEN_SLACK_MS) continue
    const msgs = loadThreadMessages(t.id)
    const last = [...msgs].reverse().find((m) => m.role !== 'system')
    if (last?.role === 'assistant') return t.id
  }
  return null
}

export function decideOpenTarget(opts?: { preferThreadId?: string | null }): string {
  const threads = useThreadsStore.getState().threads
  const exists = (id: string | null | undefined): id is string =>
    !!id && threads.some((t) => t.id === id)

  if (exists(opts?.preferThreadId)) return opts!.preferThreadId!
  const unseen = unseenAnswerThreadId()
  if (unseen) return unseen
  const recent = recentChatId()
  if (exists(recent)) return recent
  return 'home'
}

/* ---- cross-surface "which panel is visible" handshake ---- */

const VISIBLE_PANEL_KEY = 'clavus-visible-panel'

export type VisiblePanelRecord = { panel: string; by: 'window' | 'overlay'; ts: number }

export function recordVisiblePanel(panel: string, by: 'window' | 'overlay') {
  try {
    localStorage.setItem(VISIBLE_PANEL_KEY, JSON.stringify({ panel, by, ts: Date.now() }))
  } catch { /* ignore */ }
}

export function readVisiblePanel(): VisiblePanelRecord | null {
  try {
    const raw = localStorage.getItem(VISIBLE_PANEL_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as VisiblePanelRecord
    if (typeof d.panel === 'string' && (d.by === 'window' || d.by === 'overlay')) return d
  } catch { /* ignore */ }
  return null
}
