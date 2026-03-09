import { create } from 'zustand'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  streaming?: boolean
}

interface ChatState {
  messages: Message[]
  isStreaming: boolean
  abortController: AbortController | null

  addMessage: (msg: Omit<Message, 'id' | 'timestamp'>) => string
  updateMessage: (id: string, content: string) => void
  appendToMessage: (id: string, token: string) => void
  finalizeMessage: (id: string) => void
  setStreaming: (streaming: boolean) => void
  setAbortController: (controller: AbortController | null) => void
  clearMessages: () => void
}

let messageCounter = 0

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isStreaming: false,
  abortController: null,

  addMessage: (msg) => {
    const id = `msg-${Date.now()}-${messageCounter++}`
    set((state) => ({
      messages: [...state.messages, { ...msg, id, timestamp: Date.now() }],
    }))
    return id
  },

  updateMessage: (id, content) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content } : m,
      ),
    })),

  appendToMessage: (id, token) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + token } : m,
      ),
    })),

  finalizeMessage: (id) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m,
      ),
    })),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setAbortController: (controller) => set({ abortController: controller }),

  clearMessages: () => set({ messages: [] }),
}))
