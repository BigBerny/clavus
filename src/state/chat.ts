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

const STORAGE_KEY = 'clavus-messages'
const MAX_MESSAGES = 100

const WELCOME_MESSAGE: Message = {
  id: 'msg-welcome',
  role: 'assistant',
  content: 'Hi! I\'m your OpenClaw assistant. How can I help you today?',
  timestamp: Date.now(),
}

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [WELCOME_MESSAGE]
    const parsed = JSON.parse(raw) as Message[]
    if (!Array.isArray(parsed) || parsed.length === 0) return [WELCOME_MESSAGE]
    return parsed.map((m) => ({ ...m, streaming: false }))
  } catch {
    return [WELCOME_MESSAGE]
  }
}

function saveMessages(messages: Message[]) {
  try {
    const toSave = messages.slice(-MAX_MESSAGES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  } catch {
    // localStorage full or unavailable
  }
}

let messageCounter = 0

export const useChatStore = create<ChatState>((set) => ({
  messages: loadMessages(),
  isStreaming: false,
  abortController: null,

  addMessage: (msg) => {
    const id = `msg-${Date.now()}-${messageCounter++}`
    set((state) => {
      const messages = [...state.messages, { ...msg, id, timestamp: Date.now() }]
      if (!msg.streaming) saveMessages(messages)
      return { messages }
    })
    return id
  },

  updateMessage: (id, content) =>
    set((state) => {
      const messages = state.messages.map((m) =>
        m.id === id ? { ...m, content } : m,
      )
      saveMessages(messages)
      return { messages }
    }),

  appendToMessage: (id, token) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + token } : m,
      ),
    })),

  finalizeMessage: (id) =>
    set((state) => {
      const messages = state.messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m,
      )
      saveMessages(messages)
      return { messages }
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  setAbortController: (controller) => set({ abortController: controller }),

  clearMessages: () => {
    const messages = [{ ...WELCOME_MESSAGE, timestamp: Date.now() }]
    saveMessages(messages)
    set({ messages })
  },
}))
