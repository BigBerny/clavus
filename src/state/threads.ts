import { create } from 'zustand'
import type { Message } from './chat'
import { useTabsStore } from './tabs'
import { useModelStore } from './preset'
import { useChatSettingsStore, type ReasoningLevel } from './chatSettings'
import { normalizeToolCalls } from '../lib/toolCalls'
import { MODEL_OPTIONS } from '../gateway/presets'

export interface LinkedDoc {
  path: string
  title?: string
}

export interface Thread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  lastMessagePreview: string
  /** Whether this thread is archived (hidden from the main Open list). */
  archived?: boolean
  /** Marksense docs referenced from this thread (via @-mention or message scan). */
  linkedDocs?: LinkedDoc[]
  /** Per-thread model preference (restored when switching to this thread). */
  modelId?: string
  /** Per-thread reasoning level (restored when switching to this thread). */
  reasoningLevel?: ReasoningLevel
  /** Whether this thread is pinned as a favorite (shown at top, never auto-archived). */
  favorite?: boolean
  /** Last time the user actually looked at this thread (any device — synced).
   *  updatedAt > lastSeenAt with an assistant last-message ⇒ unseen answer. */
  lastSeenAt?: number
  /** Rolling topic summary, maintained server-side, used by Jane's router to
   *  decide where new input belongs. Server is authoritative for this field. */
  summary?: string
  /** For branches: the thread this conversation was spun off from (Main).
   *  Lets Jane trace lineage and read sibling branches on demand. */
  parentThreadId?: string
  /** Conversation role. 'main' = the persistent Jane conversation (never
   *  auto-archived); 'branch' = a topic spun off from Main; undefined/'normal'
   *  = an ordinary thread. Server is authoritative for this field. */
  kind?: 'main' | 'branch' | 'normal'
}

/** Stable id of the persistent "Jane" conversation. Everything Jane-directed
 *  defaults here; branches are spun off from it. Bootstrapped on first run both
 *  client- and server-side. */
export const MAIN_THREAD_ID = 'main'

interface ThreadsState {
  threads: Thread[]
  activeThreadId: string

  createThread: () => string
  /** Create a branch thread with a server-minted id (idempotent: no-op if it
   *  already exists). Used when Jane reroutes a typed Main turn into a new branch. */
  ensureBranchThread: (id: string, title: string, parentThreadId?: string) => void
  deleteThread: (id: string) => void
  switchThread: (id: string) => void
  updateThreadTitle: (id: string, title: string) => void
  updateThreadPreview: (id: string, preview: string, updatedAt?: number) => void
  archiveThread: (id: string) => void
  unarchiveThread: (id: string) => void
  markThreadSeen: (id: string) => void
  updateThreadModel: (id: string, modelId: string) => void
  updateThreadReasoning: (id: string, level: ReasoningLevel | null) => void
  toggleFavorite: (id: string) => void
  addLinkedDoc: (threadId: string, doc: LinkedDoc) => void
  getActiveThread: () => Thread | undefined
}

const THREADS_KEY = 'clavus-threads'
const ACTIVE_THREAD_KEY = 'clavus-active-thread'
const CLIENT_ID_KEY = 'clavus-client-id'

/** Threads with no activity in this window are auto-archived on app load / refocus. */
const ARCHIVE_IDLE_MS = 24 * 60 * 60 * 1000

/** Stable per-device id, sent as X-Client-Id so the server can skip broadcasting
 *  a change event back to its originator. */
export function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY)
    if (!id) {
      id = `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(CLIENT_ID_KEY, id)
    }
    return id
  } catch {
    return 'client-anon'
  }
}

function generateThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Map a message's model marker (shortLabel like "Opus", or a raw API id
 *  like "anthropic/claude-opus-4-8") back to a MODEL_OPTIONS id. */
function matchModelOption(label: string): string | null {
  const norm = label.trim().toLowerCase()
  if (!norm) return null
  const exact = MODEL_OPTIONS.find((o) =>
    o.shortLabel.toLowerCase() === norm
    || o.label.toLowerCase() === norm
    || o.id === norm
    || o.model.toLowerCase() === norm,
  )
  if (exact) return exact.id
  const fuzzy = MODEL_OPTIONS.find((o) => {
    const tail = (o.model.split('/').pop() || '').toLowerCase()
    return tail.length > 2 && (norm.includes(tail) || tail.includes(norm))
  })
  return fuzzy?.id ?? null
}

/** The model that actually produced the thread's last assistant answer. */
function inferModelIdFromMessages(threadId: string): string | null {
  const msgs = loadThreadMessages(threadId)
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role === 'assistant' && m.model) {
      return matchModelOption(m.model)
    }
  }
  return null
}

function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(THREADS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Thread[]
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

function saveThreads(threads: Thread[]) {
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads))
  } catch {
    // localStorage full or unavailable
  }
  // Async server sync
  syncThreadsToServer(threads)
}

function getActiveThreadId(): string {
  return localStorage.getItem(ACTIVE_THREAD_KEY) || ''
}

function saveActiveThreadId(id: string) {
  try {
    localStorage.setItem(ACTIVE_THREAD_KEY, id)
  } catch {
    // localStorage full or unavailable. We can't persist the active thread
    // pointer, but a thrown QuotaExceededError out of `set(...)` cascades up
    // through createThread()/switchThread() into the home-submit handler and
    // silently kills the send. Swallow here — the active thread is re-derived
    // from in-memory state on next load anyway.
  }
}

function shouldDiscoverHermesConversations(): boolean {
  const backend = (localStorage.getItem('clavus-chat-backend') || import.meta.env.VITE_CHAT_BACKEND || '').toLowerCase()
  const storedHermesUrl = localStorage.getItem('clavus-hermes-url')
  const storedBackendUrl = localStorage.getItem('clavus-backend-url') || localStorage.getItem('clavus-gateway-url')
  return backend === 'hermes' || (!backend && (!!import.meta.env.VITE_HERMES_URL || (!!storedHermesUrl && !storedBackendUrl)))
}

// Get messages storage key for a thread
export function getMessagesKey(threadId: string): string {
  return `clavus-messages-${threadId}`
}

// Queue mirror in localStorage so lazy thread load doesn't block on the network;
// clavus-data/queues/ on the server is authoritative across devices.
export function getQueueKey(threadId: string): string {
  return `clavus-queue-${threadId}`
}

export function loadQueuedMessageLocal<T>(threadId: string): T | null {
  try {
    const raw = localStorage.getItem(getQueueKey(threadId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as T | null
    return parsed ?? null
  } catch {
    return null
  }
}

export function persistQueuedMessageLocal(threadId: string, queue: unknown | null): void {
  try {
    if (queue === null || queue === undefined) {
      localStorage.removeItem(getQueueKey(threadId))
    } else {
      localStorage.setItem(getQueueKey(threadId), JSON.stringify(queue))
    }
  } catch { /* ignore */ }
}

const syncQueueTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

export function syncQueuedMessageToServer(threadId: string, queue: unknown | null): void {
  const existing = syncQueueTimers.get(threadId)
  if (existing) clearTimeout(existing)
  syncQueueTimers.set(threadId, setTimeout(async () => {
    syncQueueTimers.delete(threadId)
    try {
      if (queue === null || queue === undefined) {
        await fetch(`/api/threads/queue/${encodeURIComponent(threadId)}`, {
          method: 'DELETE',
          headers: { 'X-Client-Id': getClientId() },
        })
      } else {
        await fetch(`/api/threads/queue/${encodeURIComponent(threadId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
          body: JSON.stringify(queue),
        })
      }
    } catch {
      // Server unavailable — localStorage cache is the fallback until next reconnect.
    }
  }, 250))
}

// Load messages for a specific thread
export function loadThreadMessages(threadId: string): Message[] {
  try {
    const raw = localStorage.getItem(getMessagesKey(threadId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as Message[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((m) => ({
      ...m,
      backendResponseId: m.backendResponseId ?? m.hermesResponseId,
      streaming: false,
      ...(m.toolCalls ? { toolCalls: normalizeToolCalls(m.toolCalls) } : {}),
    }))
  } catch {
    return []
  }
}

// Save messages for a specific thread
export function saveThreadMessages(threadId: string, messages: Message[]) {
  const toSave = messages.slice(-100).map((m) => (
    m.toolCalls ? { ...m, toolCalls: normalizeToolCalls(m.toolCalls) } : m
  ))
  try {
    localStorage.setItem(getMessagesKey(threadId), JSON.stringify(toSave))
  } catch {
    // localStorage full or unavailable
  }
  // Async server sync
  syncMessagesToServer(threadId, toSave)
}

// === Server Sync ===

let syncThreadsTimer: ReturnType<typeof setTimeout> | null = null
const syncMessagesTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

function syncThreadsToServer(threads: Thread[]) {
  // Debounce to avoid flooding
  if (syncThreadsTimer) clearTimeout(syncThreadsTimer)
  syncThreadsTimer = setTimeout(async () => {
    try {
      await fetch('/api/threads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
        body: JSON.stringify(threads),
      })
    } catch {
      // Server unavailable — localStorage is the fallback
    }
  }, 500)
}

function syncMessagesToServer(threadId: string, messages: Message[]) {
  const existing = syncMessagesTimers.get(threadId)
  if (existing) clearTimeout(existing)
  syncMessagesTimers.set(threadId, setTimeout(async () => {
    syncMessagesTimers.delete(threadId)
    try {
      await fetch(`/api/threads/messages/${encodeURIComponent(threadId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() },
        body: JSON.stringify(messages),
      })
    } catch {
      // Server unavailable — localStorage is the fallback
    }
  }, 500))
}

/**
 * Archive any non-archived thread whose last activity is older than ARCHIVE_IDLE_MS.
 * Safe to call repeatedly (e.g. on page load and on tab refocus).
 * Returns the number of threads newly archived.
 */
export function archiveStaleThreads(): number {
  const cutoff = Date.now() - ARCHIVE_IDLE_MS
  const current = useThreadsStore.getState().threads
  let count = 0
  const next = current.map((t) => {
    if (!t.archived && !t.favorite && t.kind !== 'main' && t.updatedAt < cutoff) {
      count++
      return { ...t, archived: true }
    }
    return t
  })
  if (count > 0) {
    try { localStorage.setItem(THREADS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    useThreadsStore.setState({ threads: next })
    syncThreadsToServer(next)
  }
  return count
}

// Pull from server on startup (merge with localStorage)
export async function syncFromServer(): Promise<boolean> {
  try {
    const res = await fetch('/api/threads/sync')
    if (!res.ok) return false
    const data = await res.json() as { threads: Thread[], messages: Record<string, Message[]>, queues?: Record<string, unknown>, deleted?: Record<string, number> }
    
    const localThreads = loadThreads()
    const serverThreads: Thread[] = data.threads || []
    
    // Merge: for each thread, keep the one with newer updatedAt. lastSeenAt
    // merges as max independently — seen-markers don't bump updatedAt.
    const merged = new Map<string, Thread>()
    for (const t of localThreads) merged.set(t.id, t)
    for (const t of serverThreads) {
      const existing = merged.get(t.id)
      if (!existing || t.updatedAt > existing.updatedAt) {
        const lastSeenAt = Math.max(existing?.lastSeenAt ?? 0, t.lastSeenAt ?? 0) || undefined
        merged.set(t.id, { ...t, lastSeenAt })
      } else if ((t.lastSeenAt ?? 0) > (existing.lastSeenAt ?? 0)) {
        merged.set(t.id, { ...existing, lastSeenAt: t.lastSeenAt })
      }
    }
    
    // Drop threads tombstoned on any device, so a delete elsewhere can't be
    // resurrected by our still-present local copy.
    const deletedIds = data.deleted || {}
    const mergedThreads = Array.from(merged.values()).filter((t) => !deletedIds[t.id])

    // Save merged threads to localStorage
    try {
      localStorage.setItem(THREADS_KEY, JSON.stringify(mergedThreads))
    } catch { /* ignore */ }
    
    // Merge messages: for each thread, use server if it has more messages or is newer
    for (const [threadId, serverMsgs] of Object.entries(data.messages || {})) {
      const localMsgs = loadThreadMessages(threadId)
      // Use whichever has more messages (simple heuristic)
      if (serverMsgs.length >= localMsgs.length) {
        const normalizedServerMsgs = serverMsgs.map((m) => (
          m.toolCalls ? { ...m, toolCalls: normalizeToolCalls(m.toolCalls) } : m
        ))
        try {
          localStorage.setItem(getMessagesKey(threadId), JSON.stringify(normalizedServerMsgs))
        } catch { /* ignore */ }
      }
    }
    
    // Also push any local-only messages to server
    for (const t of localThreads) {
      if (!data.messages[t.id]) {
        const localMsgs = loadThreadMessages(t.id)
        if (localMsgs.length > 0) {
          syncMessagesToServer(t.id, localMsgs)
        }
      }
    }

    // Hydrate queued composer messages into localStorage so lazy thread load
    // restores them. If this device already has a local queue but the server
    // does not, keep the local copy and mirror it back: a Cmd+R can cancel the
    // debounced PUT that normally makes the server copy authoritative.
    const serverQueues = data.queues || {}
    for (const t of mergedThreads) {
      if (Object.prototype.hasOwnProperty.call(serverQueues, t.id)) {
        persistQueuedMessageLocal(t.id, serverQueues[t.id] ?? null)
        continue
      }

      const localQueue = loadQueuedMessageLocal(t.id)
      if (localQueue) {
        syncQueuedMessageToServer(t.id, localQueue)
      }
    }
    
    // Push merged threads to server
    syncThreadsToServer(mergedThreads)
    
    // Auto-archive threads with no activity in the last 24h
    const archiveCutoff = Date.now() - ARCHIVE_IDLE_MS
    let archiveDirty = false
    for (let i = 0; i < mergedThreads.length; i++) {
      const t = mergedThreads[i]
      if (!t.archived && !t.favorite && t.kind !== 'main' && t.updatedAt < archiveCutoff) {
        mergedThreads[i] = { ...t, archived: true }
        archiveDirty = true
      }
    }
    if (archiveDirty) {
      try { localStorage.setItem(THREADS_KEY, JSON.stringify(mergedThreads)) } catch { /* ignore */ }
      syncThreadsToServer(mergedThreads)
    }

    // Update Zustand store
    const store = useThreadsStore.getState()
    const currentActiveId = store.activeThreadId
    useThreadsStore.setState({
      threads: mergedThreads,
      activeThreadId: mergedThreads.find(t => t.id === currentActiveId) ? currentActiveId : mergedThreads[0]?.id || '',
    })

    // Auto-open tabs only for recent, non-archived threads to keep startup fast
    const { ensureChatTabsBatch } = await import('./tabs')
    const recentCutoff = archiveCutoff
    const recentWithMessages = mergedThreads.filter(t => {
      if (t.archived) return false
      if (t.updatedAt < recentCutoff) return false
      const msgs = loadThreadMessages(t.id)
      return msgs.length > 0
    })
    ensureChatTabsBatch(recentWithMessages.map(t => ({ threadId: t.id, title: t.title, updatedAt: t.updatedAt })))

    if (shouldDiscoverHermesConversations()) {
      // Discover conversations from Hermes that don't exist locally (cross-device sync)
      try {
        const hermesRes = await fetch('/api/hermes/conversations')
        if (hermesRes.ok) {
          const conversations = await hermesRes.json() as { threadId: string; responseId: string; status: string; createdAt: number; lastUserMessage: string }[]
          const existingIds = new Set(mergedThreads.map(t => t.id))
          const newThreads: Thread[] = []
          for (const conv of conversations) {
            if (existingIds.has(conv.threadId) || conv.status === 'failed') continue
            newThreads.push({
              id: conv.threadId,
              title: conv.lastUserMessage?.slice(0, 60) || 'Recovered conversation',
              createdAt: (conv.createdAt || 0) * 1000,
              updatedAt: (conv.createdAt || 0) * 1000,
              lastMessagePreview: conv.lastUserMessage?.slice(0, 80) || '',
            })
          }
          if (newThreads.length > 0) {
            const allThreads = [...mergedThreads, ...newThreads]
            try { localStorage.setItem(THREADS_KEY, JSON.stringify(allThreads)) } catch { /* ignore */ }
            useThreadsStore.setState({ threads: allThreads })
            syncThreadsToServer(allThreads)
            ensureChatTabsBatch(newThreads
              .filter(t => t.createdAt > recentCutoff)
              .map(t => ({ threadId: t.id, title: t.title, updatedAt: t.updatedAt })))
          }
        }
      } catch { /* Hermes unavailable — skip discovery */ }
    }

    return true
  } catch {
    return false
  }
}

/**
 * Surgical thread-list merge. Unlike `syncFromServer`, this:
 *  - does NOT reset `activeThreadId`
 *  - does NOT auto-archive idle threads
 *  - does NOT open new chat tabs
 *  - preserves per-device local-only fields (modelId, reasoningLevel)
 *  - keeps unchanged thread object references so React skips re-rendering them
 *
 *  Intended for live updates from the SSE bus and focus refreshes.
 */
export function mergeThreadsFromServer(serverThreads: Thread[]): boolean {
  const store = useThreadsStore.getState()
  const localById = new Map(store.threads.map(t => [t.id, t]))
  let changed = false

  for (const incoming of serverThreads) {
    const local = localById.get(incoming.id)
    if (!local) {
      localById.set(incoming.id, incoming)
      changed = true
      continue
    }
    if (incoming.updatedAt > local.updatedAt) {
      // Preserve per-device local-only prefs (model + reasoning) which the
      // server copy may not have or may be stale on.
      const merged: Thread = {
        ...local,
        ...incoming,
        modelId: local.modelId ?? incoming.modelId,
        reasoningLevel: local.reasoningLevel ?? incoming.reasoningLevel,
        lastSeenAt: Math.max(local.lastSeenAt ?? 0, incoming.lastSeenAt ?? 0) || undefined,
      }
      localById.set(incoming.id, merged)
      changed = true
    } else {
      // Server is authoritative for routing metadata (summary/kind/parentThreadId)
      // and seen-markers — none of these bump updatedAt, so adopt them
      // independently of the updatedAt comparison above.
      const nextSummary = incoming.summary ?? local.summary
      const nextKind = incoming.kind ?? local.kind
      const nextParent = incoming.parentThreadId ?? local.parentThreadId
      const nextSeen = Math.max(local.lastSeenAt ?? 0, incoming.lastSeenAt ?? 0) || undefined
      if (
        nextSummary !== local.summary
        || nextKind !== local.kind
        || nextParent !== local.parentThreadId
        || nextSeen !== local.lastSeenAt
      ) {
        localById.set(incoming.id, {
          ...local,
          summary: nextSummary,
          kind: nextKind,
          parentThreadId: nextParent,
          lastSeenAt: nextSeen,
        })
        changed = true
      }
    }
  }

  if (!changed) return false

  const next = Array.from(localById.values())
  try { localStorage.setItem(THREADS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  useThreadsStore.setState({ threads: next })
  return true
}

/** Fetch + merge the thread list from the server without disturbing the active view. */
export async function refreshThreadsMetadata(): Promise<boolean> {
  try {
    const res = await fetch('/api/threads')
    if (!res.ok) return false
    const data = await res.json() as Thread[]
    if (!Array.isArray(data)) return false
    return mergeThreadsFromServer(data)
  } catch {
    return false
  }
}

// Initialize threads
const initialThreads = loadThreads()

// Bootstrap the persistent Main ("Jane") conversation if it doesn't exist yet.
// The server bootstraps the same stable id, so a fresh device and a fresh
// server converge on one thread after sync (dedup by id).
if (!initialThreads.find((t) => t.id === MAIN_THREAD_ID)) {
  const now = Date.now()
  initialThreads.unshift({
    id: MAIN_THREAD_ID,
    title: 'Jane',
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: '',
    kind: 'main',
  })
  saveThreads(initialThreads)
}

let initialActiveId = getActiveThreadId()

// If active thread doesn't exist anymore, clear it
if (initialActiveId && !initialThreads.find((t) => t.id === initialActiveId)) {
  initialActiveId = ''
  saveActiveThreadId('')
}

// Migrate old single-thread messages to first thread if needed
const oldMessages = localStorage.getItem('clavus-messages')
if (oldMessages && initialThreads.length === 1) {
  const firstThread = initialThreads[0]
  const existing = localStorage.getItem(getMessagesKey(firstThread.id))
  if (!existing) {
    try {
      const msgs = JSON.parse(oldMessages) as Message[]
      const normalizedOldMessages = Array.isArray(msgs)
        ? msgs.map((m) => (m.toolCalls ? { ...m, toolCalls: normalizeToolCalls(m.toolCalls) } : m))
        : []
      localStorage.setItem(getMessagesKey(firstThread.id), JSON.stringify(normalizedOldMessages))
    } catch {
      localStorage.setItem(getMessagesKey(firstThread.id), oldMessages)
    }
    // Try to set a title from the first user message
    try {
      const msgs = JSON.parse(oldMessages) as Message[]
      const firstUserMsg = msgs.find((m) => m.role === 'user')
      if (firstUserMsg) {
        firstThread.title = firstUserMsg.content.slice(0, 50)
        firstThread.updatedAt = msgs[msgs.length - 1]?.timestamp || Date.now()
        const lastMsg = msgs[msgs.length - 1]
        if (lastMsg) firstThread.lastMessagePreview = lastMsg.content.slice(0, 80)
        saveThreads(initialThreads)
      }
    } catch {
      // ignore
    }
  }
  localStorage.removeItem('clavus-messages')
}

export const useThreadsStore = create<ThreadsState>((set, get) => ({
  threads: initialThreads,
  activeThreadId: initialActiveId,

  createThread: () => {
    const id = generateThreadId()
    const thread: Thread = {
      id,
      title: 'New conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastMessagePreview: '',
    }
    set((state) => {
      const threads = [thread, ...state.threads]
      saveThreads(threads)
      saveActiveThreadId(id)
      return { threads, activeThreadId: id }
    })
    return id
  },

  ensureBranchThread: (id, title, parentThreadId = MAIN_THREAD_ID) => {
    set((state) => {
      if (state.threads.some((t) => t.id === id)) return state
      const now = Date.now()
      const thread: Thread = {
        id,
        title: title || 'New conversation',
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: '',
        kind: 'branch',
        parentThreadId,
      }
      const threads = [thread, ...state.threads]
      saveThreads(threads)
      return { threads }
    })
  },

  deleteThread: (id) => {
    set((state) => {
      const threads = state.threads.filter((t) => t.id !== id)
      localStorage.removeItem(getMessagesKey(id))
      localStorage.removeItem(getQueueKey(id))

      let activeThreadId = state.activeThreadId
      if (activeThreadId === id) {
        // Fall back to first remaining thread or empty
        activeThreadId = threads.length > 0 ? threads[0].id : ''
      }

      // Persist the trimmed list locally for instant UI. We do NOT rely on a
      // PUT to remove it (the server now merges and never drops); deletion goes
      // through the explicit tombstoning DELETE endpoint, which also broadcasts
      // thread-deleted to other devices.
      try { localStorage.setItem(THREADS_KEY, JSON.stringify(threads)) } catch { /* ignore */ }
      saveActiveThreadId(activeThreadId)
      fetch(`/api/threads/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => { /* offline; best-effort */ })
      return { threads, activeThreadId }
    })
  },

  switchThread: (id) => {
    const thread = get().threads.find((t) => t.id === id)
    if (!thread) return
    saveActiveThreadId(id)
    set({ activeThreadId: id })
    // Restore the per-thread model selection. When nothing is pinned (thread
    // last used on another device, or predates pinning), derive it from the
    // last assistant message so the pill shows what was actually used — an
    // existing conversation must never open as bare "Auto".
    let modelId = thread.modelId
    if (!modelId || modelId === 'auto') {
      const derived = inferModelIdFromMessages(id)
      if (derived) {
        modelId = derived
        get().updateThreadModel(id, derived)
      }
    }
    useModelStore.getState().setSelectedModelId(modelId || 'auto')
    // Restore the per-thread reasoning level.
    useChatSettingsStore.getState().setGlobalReasoning(thread.reasoningLevel ?? null)
  },

  updateThreadTitle: (id, title) => {
    set((state) => {
      const threads = state.threads.map((t) =>
        t.id === id ? { ...t, title, updatedAt: Date.now() } : t,
      )
      saveThreads(threads)
      return { threads }
    })
    // Also update the corresponding tab title
    useTabsStore.getState().updateTab(id, { title })
  },

  updateThreadModel: (id, modelId) => {
    set((state) => {
      const threads = state.threads.map((t) =>
        t.id === id ? { ...t, modelId } : t,
      )
      saveThreads(threads)
      return { threads }
    })
  },

  updateThreadReasoning: (id, level) => {
    set((state) => {
      const threads = state.threads.map((t) =>
        t.id === id ? { ...t, reasoningLevel: level ?? undefined } : t,
      )
      saveThreads(threads)
      return { threads }
    })
  },

  updateThreadPreview: (id, preview, updatedAt) => {
    if (!preview.trim()) return
    set((state) => {
      const activityAt = updatedAt ?? Date.now()
      const threads = state.threads.map((t) =>
        t.id === id ? { ...t, lastMessagePreview: preview.slice(0, 80), updatedAt: activityAt } : t,
      )
      saveThreads(threads)
      return { threads }
    })
  },

  archiveThread: (id) => {
    set((state) => {
      const now = Date.now()
      const threads = state.threads.map((t) =>
        t.id === id ? { ...t, archived: true, updatedAt: now } : t,
      )
      saveThreads(threads)
      return { threads }
    })
  },

  unarchiveThread: (id) => {
    set((state) => {
      const now = Date.now()
      const threads = state.threads.map((t) =>
        t.id === id ? { ...t, archived: false, updatedAt: now } : t,
      )
      saveThreads(threads)
      return { threads }
    })
  },

  // Deliberately does NOT bump updatedAt — seeing isn't activity.
  markThreadSeen: (id) => {
    const cur = get().threads
    const target = cur.find((t) => t.id === id)
    if (!target) return
    const now = Date.now()
    // Skip no-op writes (called on every message-count change while viewing).
    if (target.lastSeenAt && now - target.lastSeenAt < 1000 && target.lastSeenAt >= target.updatedAt) return
    set((state) => {
      const threads = state.threads.map((t) =>
        t.id === id ? { ...t, lastSeenAt: now } : t,
      )
      saveThreads(threads)
      return { threads }
    })
  },

  toggleFavorite: (id) => {
    set((state) => {
      const now = Date.now()
      const threads = state.threads.map((t) =>
        t.id === id ? { ...t, favorite: !t.favorite, updatedAt: now } : t,
      )
      saveThreads(threads)
      return { threads }
    })
  },

  addLinkedDoc: (threadId, doc) => {
    // Pre-check OUTSIDE of `set` so a no-op early-returns without producing a
    // new state reference. The previous implementation always returned a new
    // `threads` array (via `.map()`), which woke every subscriber on every
    // call — and with FileLinkCard's mount-time useEffect this caused an
    // infinite render loop when a chat contained a workspace-file link.
    const cur = get().threads
    const target = cur.find((t) => t.id === threadId)
    if (!target) return
    const existing = target.linkedDocs ?? []
    if (existing.some((d) => d.path === doc.path)) return // already linked
    set(() => {
      const threads = cur.map((t) =>
        t.id !== threadId ? t : { ...t, linkedDocs: [...existing, doc] },
      )
      saveThreads(threads)
      return { threads }
    })
  },

  getActiveThread: () => {
    const state = get()
    return state.threads.find((t) => t.id === state.activeThreadId)
  },
}))
