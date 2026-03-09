import { create } from 'zustand'
import type { Message } from './chat'

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
}

// Initialize: ensure at least one thread exists
const initialThreads = loadThreads()
let initialActiveId = getActiveThreadId()

if (initialThreads.length === 0) {
  const id = generateThreadId()
  const thread: Thread = {
    id,
    title: 'New conversation',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastMessagePreview: '',
  }
  initialThreads.push(thread)
  initialActiveId = id
  saveThreads(initialThreads)
  saveActiveThreadId(id)
} else if (!initialActiveId || !initialThreads.find((t) => t.id === initialActiveId)) {
  initialActiveId = initialThreads[0].id
  saveActiveThreadId(initialActiveId)
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
      // Remove messages from localStorage
      localStorage.removeItem(getMessagesKey(id))

      let activeThreadId = state.activeThreadId
      if (activeThreadId === id) {
        if (threads.length === 0) {
          // Create a new thread if we deleted the last one
          const newId = generateThreadId()
          const newThread: Thread = {
            id: newId,
            title: 'New conversation',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastMessagePreview: '',
          }
          threads.push(newThread)
          activeThreadId = newId
        } else {
          activeThreadId = threads[0].id
        }
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
