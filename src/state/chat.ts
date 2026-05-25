import { create } from 'zustand'
import { useThreadsStore, loadThreadMessages, saveThreadMessages } from './threads'
import { buildWorkspaceMediaUrl, mediaTypeFromPath } from '../lib/media.ts'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'running' | 'completed' | 'error'
}

export interface MediaAttachment {
  type: 'image' | 'audio' | 'video' | 'file'
  url: string
  title?: string
  mimeType?: string
}

export interface MessageUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  thinkingDone?: boolean
  timestamp: number
  streaming?: boolean
  images?: string[] // base64 data URLs
  toolCalls?: ToolCall[]
  model?: string
  usage?: MessageUsage
  media?: MediaAttachment[]
  backendResponseId?: string
  /** @deprecated use backendResponseId */
  hermesResponseId?: string
  /** Highest seq id received from the Clavus server-side event buffer.
   *  Used to resume the stream after disconnect (`?last_event_id=<seq>`). */
  lastEventSeq?: number
}

/** A file attached to the composer (and persisted in the queue when applicable). */
export interface PendingFile {
  name: string
  content: string
  size: number
  /** Local file path — the agent can read this directly */
  localPath?: string
}

/** A message the user enqueued while a previous response was still streaming.
 *  Stored raw (not composed) so editing can restore content + attachments. */
export interface QueuedMessage {
  content: string
  images?: string[]
  files?: PendingFile[]
}

export interface ThreadStreamState {
  messages: Message[]
  isStreaming: boolean
  abortController: AbortController | null
  queuedMessage: QueuedMessage | null
}

const EMPTY_THREAD_STATE: ThreadStreamState = {
  messages: [],
  isStreaming: false,
  abortController: null,
  queuedMessage: null,
}

/** Compose the final message text the gateway sees by prepending `<file>` blocks. */
export function composeMessageText(content: string, files: PendingFile[] | undefined): string {
  if (!files || files.length === 0) return content
  const fileParts = files.map((f) => {
    const attrs = `name="${f.name}"${f.localPath ? ` path="${f.localPath}"` : ''}`
    if (f.content) return `<file ${attrs}>\n${f.content}\n</file>`
    return `<file ${attrs} />`
  })
  return fileParts.join('\n\n') + (content ? '\n\n' + content : '')
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
  updateToolCalls: (threadId: string, id: string, toolCalls: ToolCall[]) => void
  setMessageModel: (threadId: string, id: string, model: string) => void
  setMessageUsage: (threadId: string, id: string, usage: MessageUsage) => void
  setBackendResponseId: (threadId: string, id: string, responseId: string) => void
  setHermesResponseId: (threadId: string, id: string, responseId: string) => void
  setLastEventSeq: (threadId: string, id: string, seq: number) => void
  addMedia: (threadId: string, id: string, media: MediaAttachment[]) => void
  clearMessages: (threadId: string) => void
  removeMessage: (threadId: string, messageId: string) => void
  /** Remove the message with the given id and all messages after it.
   *  Returns the removed messages so callers can inspect them. */
  truncateMessagesFrom: (threadId: string, messageId: string) => Message[]
  /** Bulk-set the entire messages array for a thread (e.g. for branching). */
  setThreadMessages: (threadId: string, messages: Message[]) => void
  /** Queue a message (or append to an existing one) while a response is streaming. */
  enqueueOrAppend: (threadId: string, msg: QueuedMessage) => void
  /** Clear the queued message for a thread (e.g. after sending or trashing it). */
  clearQueuedMessage: (threadId: string) => void
  /** Atomically clear the queued message and return its previous value, so the
   *  caller can pull it back into the composer for editing. */
  pullQueuedMessage: (threadId: string) => QueuedMessage | null
}

function saveMessages(threadId: string, messages: Message[]) {
  saveThreadMessages(threadId, messages)

  // Update thread preview with last non-system message
  const lastMsg = [...messages].reverse().find((m) => m.role !== 'system')
  if (lastMsg) {
    useThreadsStore.getState().updateThreadPreview(threadId, lastMsg.content)
  }
}

const MEDIA_RE = /^MEDIA:\s*(.+)$/gm

function extractMedia(content: string): { text: string; media: MediaAttachment[] } {
  const media: MediaAttachment[] = []
  const text = content.replace(MEDIA_RE, (_match, path: string) => {
    const trimmed = path.trim().replace(/^`|`$/g, '')
    if (!trimmed) return ''
    const url = buildWorkspaceMediaUrl(trimmed)
    const type = mediaTypeFromPath(trimmed)
    media.push({ type, url, title: trimmed.split('/').pop() })
    return ''
  }).replace(/\n{3,}/g, '\n\n').trim()
  return { text, media }
}

let messageCounter = 0

export const useChatStore = create<ChatState>((set, get) => ({
  threadStates: {},

  getThreadState: (threadId: string): ThreadStreamState => {
    const state = get().threadStates[threadId]
    if (state) return state
    // Lazy-load from localStorage
    const messages = loadThreadMessages(threadId)
    const newState: ThreadStreamState = { messages, isStreaming: false, abortController: null, queuedMessage: null }
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
        [threadId]: { messages, isStreaming: false, abortController: null, queuedMessage: null },
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
      const messages = ts.messages.map((m) => {
        if (m.id !== id) return m
        const { text, media } = extractMedia(m.content)
        return {
          ...m,
          streaming: false,
          content: text,
          ...(media.length > 0 ? { media: [...(m.media || []), ...media] } : {}),
        }
      })
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

  updateToolCalls: (threadId, id, toolCalls) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: {
            ...ts,
            messages: ts.messages.map((m) =>
              m.id === id ? { ...m, toolCalls } : m,
            ),
          },
        },
      }
    }),

  setMessageModel: (threadId, id, model) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: {
            ...ts,
            messages: ts.messages.map((m) =>
              m.id === id ? { ...m, model } : m,
            ),
          },
        },
      }
    }),

  setMessageUsage: (threadId, id, usage) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: {
            ...ts,
            messages: ts.messages.map((m) =>
              m.id === id ? { ...m, usage } : m,
            ),
          },
        },
      }
    }),

  setBackendResponseId: (threadId, id, responseId) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: {
            ...ts,
            messages: ts.messages.map((m) =>
              m.id === id ? { ...m, backendResponseId: responseId, hermesResponseId: responseId } : m,
            ),
          },
        },
      }
    }),

  setHermesResponseId: (threadId, id, responseId) =>
    useChatStore.getState().setBackendResponseId(threadId, id, responseId),

  setLastEventSeq: (threadId, id, seq) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: {
            ...ts,
            messages: ts.messages.map((m) =>
              m.id === id
                ? { ...m, lastEventSeq: typeof m.lastEventSeq === 'number' ? Math.max(m.lastEventSeq, seq) : seq }
                : m,
            ),
          },
        },
      }
    }),

  addMedia: (threadId, id, media) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      const messages = ts.messages.map((m) =>
        m.id === id ? { ...m, media: [...(m.media || []), ...media] } : m,
      )
      saveMessages(threadId, messages)
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: { ...ts, messages },
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

  truncateMessagesFrom: (threadId, messageId) => {
    const ts = get().threadStates[threadId]
    if (!ts) return []
    const idx = ts.messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return []
    const removed = ts.messages.slice(idx)
    const remaining = ts.messages.slice(0, idx)
    saveMessages(threadId, remaining)
    set((state) => ({
      threadStates: {
        ...state.threadStates,
        [threadId]: { ...state.threadStates[threadId]!, messages: remaining },
      },
    }))
    return removed
  },

  setThreadMessages: (threadId, messages) => {
    get().ensureThread(threadId)
    saveMessages(threadId, messages)
    set((state) => ({
      threadStates: {
        ...state.threadStates,
        [threadId]: { ...state.threadStates[threadId]!, messages },
      },
    }))
  },

  enqueueOrAppend: (threadId, msg) => {
    // Ensure thread state exists.
    get().ensureThread(threadId)
    set((state) => {
      const ts = state.threadStates[threadId]!
      const existing = ts.queuedMessage
      // Single-item queue: when something is already queued, append the new
      // content (and merge attachments) so the user never loses what they
      // typed. Hard caps to keep payloads bounded.
      const merged: QueuedMessage = existing
        ? {
            content: existing.content && msg.content
              ? `${existing.content}\n\n${msg.content}`
              : (existing.content || msg.content),
            files: [...(existing.files || []), ...(msg.files || [])].slice(0, 10),
            images: [...(existing.images || []), ...(msg.images || [])].slice(0, 8),
          }
        : msg
      // Strip empty arrays so consumers can treat them as undefined.
      if (merged.files && merged.files.length === 0) delete merged.files
      if (merged.images && merged.images.length === 0) delete merged.images
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: { ...ts, queuedMessage: merged },
        },
      }
    })
  },

  clearQueuedMessage: (threadId) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts || !ts.queuedMessage) return state
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: { ...ts, queuedMessage: null },
        },
      }
    }),

  pullQueuedMessage: (threadId) => {
    const ts = get().threadStates[threadId]
    const queued = ts?.queuedMessage ?? null
    if (queued) get().clearQueuedMessage(threadId)
    return queued
  },
}))
