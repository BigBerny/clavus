import { create } from 'zustand'
import { useThreadsStore, loadThreadMessages, saveThreadMessages } from './threads'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  thinkingDone?: boolean
  timestamp: number
  streaming?: boolean
  images?: string[] // base64 data URLs
}

export interface ThreadStreamState {
  messages: Message[]
  isStreaming: boolean
  abortController: AbortController | null
}

const EMPTY_THREAD_STATE: ThreadStreamState = {
  messages: [],
  isStreaming: false,
  abortController: null,
}

interface ChatState {
  threadStates: Record<string, ThreadStreamState>

  getThreadState: (threadId: string) => ThreadStreamState
  ensureThread: (threadId: string) => void
  addMessage: (threadId: string, msg: Omit<Message, 'id' | 'timestamp'>) => string
  updateMessage: (threadId: string, id: string, content: string) => void
  appendToMessage: (threadId: string, id: string, token: string) => void
  appendThinking: (threadId: string, id: string, token: string) => void
  setThinkingDone: (threadId: string, id: string) => void
  finalizeMessage: (threadId: string, id: string) => void
  setStreaming: (threadId: string, streaming: boolean) => void
  setAbortController: (threadId: string, controller: AbortController | null) => void
  clearMessages: (threadId: string) => void
  removeMessage: (threadId: string, messageId: string) => void
}

function saveMessages(threadId: string, messages: Message[]) {
  saveThreadMessages(threadId, messages)

  // Update thread preview with last non-system message
  const lastMsg = [...messages].reverse().find((m) => m.role !== 'system')
  if (lastMsg) {
    useThreadsStore.getState().updateThreadPreview(threadId, lastMsg.content)
  }
}

let messageCounter = 0

export const useChatStore = create<ChatState>((set, get) => ({
  threadStates: {},

  getThreadState: (threadId: string): ThreadStreamState => {
    const state = get().threadStates[threadId]
    if (state) return state
    // Lazy-load from localStorage
    const messages = loadThreadMessages(threadId)
    const newState: ThreadStreamState = { messages, isStreaming: false, abortController: null }
    set((s) => ({
      threadStates: { ...s.threadStates, [threadId]: newState },
    }))
    return newState
  },

  ensureThread: (threadId: string) => {
    if (get().threadStates[threadId]) return
    const messages = loadThreadMessages(threadId)
    set((s) => ({
      threadStates: {
        ...s.threadStates,
        [threadId]: { messages, isStreaming: false, abortController: null },
      },
    }))
  },

  addMessage: (threadId, msg) => {
    const id = `msg-${Date.now()}-${messageCounter++}`
    // Ensure thread is loaded
    get().ensureThread(threadId)

    set((state) => {
      const ts = state.threadStates[threadId] || EMPTY_THREAD_STATE
      const messages = [...ts.messages, { ...msg, id, timestamp: Date.now() }]
      if (!msg.streaming) saveMessages(threadId, messages)

      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: { ...ts, messages },
        },
      }
    })
    return id
  },

  updateMessage: (threadId, id, content) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      const messages = ts.messages.map((m) =>
        m.id === id ? { ...m, content } : m,
      )
      saveMessages(threadId, messages)
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: { ...ts, messages },
        },
      }
    }),

  appendToMessage: (threadId, id, token) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: {
            ...ts,
            messages: ts.messages.map((m) =>
              m.id === id ? { ...m, content: m.content + token } : m,
            ),
          },
        },
      }
    }),

  appendThinking: (threadId, id, token) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: {
            ...ts,
            messages: ts.messages.map((m) =>
              m.id === id ? { ...m, thinking: (m.thinking || '') + token } : m,
            ),
          },
        },
      }
    }),

  setThinkingDone: (threadId, id) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: {
            ...ts,
            messages: ts.messages.map((m) =>
              m.id === id ? { ...m, thinkingDone: true } : m,
            ),
          },
        },
      }
    }),

  finalizeMessage: (threadId, id) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      const messages = ts.messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m,
      )
      saveMessages(threadId, messages)
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: { ...ts, messages },
        },
      }
    }),

  setStreaming: (threadId, streaming) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: { ...ts, isStreaming: streaming },
        },
      }
    }),

  setAbortController: (threadId, controller) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: { ...ts, abortController: controller },
        },
      }
    }),

  clearMessages: (threadId) => {
    const messages: Message[] = []
    saveMessages(threadId, messages)
    set((state) => ({
      threadStates: {
        ...state.threadStates,
        [threadId]: {
          ...(state.threadStates[threadId] || EMPTY_THREAD_STATE),
          messages,
        },
      },
    }))
  },

  removeMessage: (threadId, messageId) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      const messages = ts.messages.filter((m) => m.id !== messageId)
      saveMessages(threadId, messages)
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: { ...ts, messages },
        },
      }
    }),
}))
