import { create } from 'zustand'
import type { Message } from './chat'
import { useTabsStore } from './tabs'

export interface Thread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  lastMessagePreview: string
}

interface ThreadsState {
  threads: Thread[]
  activeThreadId: string

  createThread: () => string
  deleteThread: (id: string) => void
  switchThread: (id: string) => void
  updateThreadTitle: (id: string, title: string) => void
  updateThreadPreview: (id: string, preview: string) => void
  getActiveThread: () => Thread | undefined
}

const THREADS_KEY = 'clavus-threads'
const ACTIVE_THREAD_KEY = 'clavus-active-thread'

function generateThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
  localStorage.setItem(ACTIVE_THREAD_KEY, id)
}

// Get messages storage key for a thread
export function getMessagesKey(threadId: string): string {
  return `clavus-messages-${threadId}`
}

// Load messages for a specific thread
export function loadThreadMessages(threadId: string): Message[] {
  try {
    const raw = localStorage.getItem(getMessagesKey(threadId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as Message[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((m) => ({ ...m, streaming: false }))
  } catch {
    return []
  }
}

// Save messages for a specific thread
export function saveThreadMessages(threadId: string, messages: Message[]) {
  try {
    const toSave = messages.slice(-100)
    localStorage.setItem(getMessagesKey(threadId), JSON.stringify(toSave))
  } catch {
    // localStorage full or unavailable
  }
  // Async server sync
  syncMessagesToServer(threadId, messages.slice(-100))
}

// === Server Sync ===

let syncThreadsTimer: ReturnType<typeof setTimeout> | null = null
let syncMessagesTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

function syncThreadsToServer(threads: Thread[]) {
  // Debounce to avoid flooding
  if (syncThreadsTimer) clearTimeout(syncThreadsTimer)
  syncThreadsTimer = setTimeout(async () => {
    try {
      await fetch('/api/threads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      })
    } catch {
      // Server unavailable — localStorage is the fallback
    }
  }, 500))
}

// Pull from server on startup (merge with localStorage)
export async function syncFromServer(): Promise<boolean> {
  try {
    const res = await fetch('/api/threads/sync')
    if (!res.ok) return false
    const data = await res.json() as { threads: Thread[], messages: Record<string, Message[]> }
    
    const localThreads = loadThreads()
    const serverThreads: Thread[] = data.threads || []
    
    // Merge: for each thread, keep the one with newer updatedAt
    const merged = new Map<string, Thread>()
    for (const t of localThreads) merged.set(t.id, t)
    for (const t of serverThreads) {
      const existing = merged.get(t.id)
      if (!existing || t.updatedAt > existing.updatedAt) {
        merged.set(t.id, t)
      }
    }
    
    const mergedThreads = Array.from(merged.values())
    
    // Save merged threads to localStorage
    try {
      localStorage.setItem(THREADS_KEY, JSON.stringify(mergedThreads))
    } catch { /* ignore */ }
    
    // Merge messages: for each thread, use server if it has more messages or is newer
    for (const [threadId, serverMsgs] of Object.entries(data.messages || {})) {
      const localMsgs = loadThreadMessages(threadId)
      // Use whichever has more messages (simple heuristic)
      if (serverMsgs.length >= localMsgs.length) {
        try {
          localStorage.setItem(getMessagesKey(threadId), JSON.stringify(serverMsgs))
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
    
    // Push merged threads to server
    syncThreadsToServer(mergedThreads)
    
    // Update Zustand store
    const store = useThreadsStore.getState()
    const currentActiveId = store.activeThreadId
    useThreadsStore.setState({
      threads: mergedThreads,
      activeThreadId: mergedThreads.find(t => t.id === currentActiveId) ? currentActiveId : mergedThreads[0]?.id || '',
    })

    // Auto-open tabs only for recent threads (last 24h) to keep startup fast
    const { ensureChatTabsBatch } = await import('./tabs')
    const recentCutoff = Date.now() - 24 * 60 * 60 * 1000
    const recentWithMessages = mergedThreads.filter(t => {
      if (t.updatedAt < recentCutoff) return false
      const msgs = loadThreadMessages(t.id)
      return msgs.length > 0
    })
    ensureChatTabsBatch(recentWithMessages.map(t => ({ threadId: t.id, title: t.title })))

    return true
  } catch {
    return false
  }
}

// Initialize threads
const initialThreads = loadThreads()
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
    localStorage.setItem(getMessagesKey(firstThread.id), oldMessages)
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

  deleteThread: (id) => {
    set((state) => {
      const threads = state.threads.filter((t) => t.id !== id)
      localStorage.removeItem(getMessagesKey(id))

      let activeThreadId = state.activeThreadId
      if (activeThreadId === id) {
        // Fall back to first remaining thread or empty
        activeThreadId = threads.length > 0 ? threads[0].id : ''
      }

      saveThreads(threads)
      saveActiveThreadId(activeThreadId)
      return { threads, activeThreadId }
    })
  },

  switchThread: (id) => {
    const thread = get().threads.find((t) => t.id === id)
    if (!thread) return
    saveActiveThreadId(id)
    set({ activeThreadId: id })
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

  updateThreadPreview: (id, preview) => {
    set((state) => {
      const threads = state.threads.map((t) =>
        t.id === id ? { ...t, lastMessagePreview: preview.slice(0, 80), updatedAt: Date.now() } : t,
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
