import { create } from 'zustand'
import { useThreadsStore, loadThreadMessages, saveThreadMessages } from './threads'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  streaming?: boolean
  images?: string[] // base64 data URLs
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
  loadThread: (threadId: string) => void
}

const WELCOME_MESSAGE: Message = {
  id: 'msg-welcome',
  role: 'assistant',
  content: 'Hi! I\'m Jane, your OpenClaw assistant. How can I help you today?',
  timestamp: Date.now(),
}

function loadMessages(): Message[] {
  const threadId = useThreadsStore.getState().activeThreadId
  const msgs = loadThreadMessages(threadId)
  if (msgs.length === 0) return [{ ...WELCOME_MESSAGE, timestamp: Date.now() }]
  return msgs
}

function saveMessages(messages: Message[]) {
  const threadId = useThreadsStore.getState().activeThreadId
  saveThreadMessages(threadId, messages)

  // Update thread preview with last non-system message
  const lastMsg = [...messages].reverse().find((m) => m.role !== 'system')
  if (lastMsg) {
    useThreadsStore.getState().updateThreadPreview(threadId, lastMsg.content)
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

      // Auto-set thread title from first user message
      if (msg.role === 'user') {
        const threadId = useThreadsStore.getState().activeThreadId
        const thread = useThreadsStore.getState().threads.find((t) => t.id === threadId)
        if (thread && thread.title === 'New conversation') {
          useThreadsStore.getState().updateThreadTitle(threadId, msg.content.slice(0, 30))
        }
      }

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

  loadThread: (threadId: string) => {
    const msgs = loadThreadMessages(threadId)
    const messages = msgs.length === 0 ? [{ ...WELCOME_MESSAGE, timestamp: Date.now() }] : msgs
    set({ messages, isStreaming: false, abortController: null })
  },
}))
