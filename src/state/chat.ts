import { create } from 'zustand'
import {
  useThreadsStore,
  loadThreadMessages,
  saveThreadMessages,
  getMessagesKey,
  loadQueuedMessageLocal,
  persistQueuedMessageLocal,
  syncQueuedMessageToServer,
} from './threads'
import { buildWorkspaceMediaUrl, mediaFromToolCalls, mediaTypeFromPath } from '../lib/media.ts'
import { normalizeToolCalls } from '../lib/toolCalls.ts'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'running' | 'completed' | 'error'
}

/** A workspace note Trova matched for a sent message (the Mode 1 pre-pass).
 *  Shown under the user's message; `inject` excerpts were put into the prompt,
 *  `suggest` notes were merely flagged as related. */
export interface WorkspaceFile {
  path: string
  title: string
  kind: 'inject' | 'suggest'
  status?: 'active' | 'archived' | 'superseded'
  excerpt?: string
}

export interface MediaAttachment {
  type: 'image' | 'audio' | 'video' | 'file'
  url: string
  title?: string
  mimeType?: string
}

export interface ChildThreadReference {
  threadId: string
  title: string
  description?: string
  status?: 'created' | 'running'
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
  meta?: string
  thinking?: string
  thinkingDone?: boolean
  timestamp: number
  streaming?: boolean
  images?: string[] // base64 data URLs
  toolCalls?: ToolCall[]
  /** Workspace notes Trova surfaced for this (user) message. */
  workspaceFiles?: WorkspaceFile[]
  model?: string
  usage?: MessageUsage
  media?: MediaAttachment[]
  childThread?: ChildThreadReference
  attachments?: PendingFile[]
  /** How this (user) message was produced + its origin context (typed/dictated,
   *  focused app, dictation telemetry). Rendered into the agent input on send. */
  clientMeta?: import('../gateway/chat.ts').ClientMeta
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

/** Compose the final message text the gateway sees by prepending `<file>` blocks.
 *  Only sends path references — the agent can read files directly. */
export function composeMessageText(content: string, files: PendingFile[] | undefined): string {
  if (!files || files.length === 0) return content
  const fileParts = files.map((f) => {
    const attrs = `name="${f.name}"${f.localPath ? ` path="${f.localPath}"` : ''}`
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
  setWorkspaceFiles: (threadId: string, id: string, files: WorkspaceFile[]) => void
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
  /** Move the given messages (by id, preserving objects/order) from one thread
   *  to another. Kept for explicit thread-management flows. */
  relocateMessages: (fromThreadId: string, toThreadId: string, messageIds: string[]) => void
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

  // Update thread preview with the last meaningful non-system message. Empty
  // assistant placeholders must not make old threads look active again.
  const lastMsg = [...messages].reverse().find((m) => m.role !== 'system' && m.content.trim().length > 0)
  if (lastMsg) {
    useThreadsStore.getState().updateThreadPreview(threadId, lastMsg.content, lastMsg.timestamp)
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
    const messages = loadThreadMessages(threadId).map((m) => (
      m.toolCalls ? { ...m, toolCalls: normalizeToolCalls(m.toolCalls) } : m
    ))
    const queuedMessage = loadQueuedMessageLocal<QueuedMessage>(threadId)
    const newState: ThreadStreamState = { messages, isStreaming: false, abortController: null, queuedMessage }
    set((s) => ({
      threadStates: { ...s.threadStates, [threadId]: newState },
    }))
    return newState
  },

  ensureThread: (threadId: string) => {
    if (get().threadStates[threadId]) return
    const messages = loadThreadMessages(threadId)
    const queuedMessage = loadQueuedMessageLocal<QueuedMessage>(threadId)
    set((s) => ({
      threadStates: {
        ...s.threadStates,
        [threadId]: { messages, isStreaming: false, abortController: null, queuedMessage },
      },
    }))
  },

  addMessage: (threadId, msg) => {
    const id = `msg-${Date.now()}-${messageCounter++}`
    // Ensure thread is loaded
    get().ensureThread(threadId)

    set((state) => {
      const ts = state.threadStates[threadId] || EMPTY_THREAD_STATE
      const message = {
        ...msg,
        ...(msg.toolCalls ? { toolCalls: normalizeToolCalls(msg.toolCalls) } : {}),
        id,
        timestamp: Date.now(),
      }
      const messages = [...ts.messages, message]
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
        const { text, media: contentMedia } = extractMedia(m.content)
        // Agent-generated images arrive as a MEDIA: marker in a tool result.
        // The live path attaches them immediately, but resume/recovery paths
        // don't — so re-derive here and dedup so every path persists the image.
        const existingUrls = new Set((m.media || []).map((x) => x.url))
        const newMedia = [...contentMedia, ...mediaFromToolCalls(m.toolCalls)]
          .filter((x) => !existingUrls.has(x.url) && (existingUrls.add(x.url), true))
        return {
          ...m,
          streaming: false,
          content: text,
          ...(newMedia.length > 0 ? { media: [...(m.media || []), ...newMedia] } : {}),
        }
      })
      // Instrumentation: the durable persistence boundary. If an async/failed
      // run's visible reply never logs here, it was never finalized client-side.
      const finalized = messages.find((m) => m.id === id)
      if (finalized?.role === 'assistant') {
        console.log('[recovery-diag] finalize', {
          threadId,
          id,
          rid: finalized.backendResponseId ?? finalized.hermesResponseId ?? null,
          len: (finalized.content || '').length,
        })
      }
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
              m.id === id ? { ...m, toolCalls: normalizeToolCalls(toolCalls) } : m,
            ),
          },
        },
      }
    }),

  setWorkspaceFiles: (threadId, id, files) =>
    set((state) => {
      const ts = state.threadStates[threadId]
      if (!ts) return state
      const messages = ts.messages.map((m) =>
        m.id === id ? { ...m, workspaceFiles: files } : m,
      )
      // The user message isn't streaming, so persist immediately (no finalize will run on it).
      saveMessages(threadId, messages)
      return {
        threadStates: {
          ...state.threadStates,
          [threadId]: { ...ts, messages },
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

  relocateMessages: (fromThreadId, toThreadId, messageIds) => {
    if (fromThreadId === toThreadId || messageIds.length === 0) return
    get().ensureThread(toThreadId)
    const fromTs = get().threadStates[fromThreadId]
    if (!fromTs) return
    const idSet = new Set(messageIds)
    const moving = fromTs.messages.filter((m) => idSet.has(m.id))
    if (moving.length === 0) return
    const remaining = fromTs.messages.filter((m) => !idSet.has(m.id))
    const toTs = get().threadStates[toThreadId]!
    const merged = [...toTs.messages, ...moving]
    saveMessages(fromThreadId, remaining)
    saveMessages(toThreadId, merged)
    set((state) => ({
      threadStates: {
        ...state.threadStates,
        [fromThreadId]: { ...state.threadStates[fromThreadId]!, messages: remaining },
        [toThreadId]: { ...state.threadStates[toThreadId]!, messages: merged },
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
      persistQueuedMessageLocal(threadId, merged)
      syncQueuedMessageToServer(threadId, merged)
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
      persistQueuedMessageLocal(threadId, null)
      syncQueuedMessageToServer(threadId, null)
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

/**
 * Surgically merge a server-side messages array into the chat store for a
 * thread. Designed for SSE live-refresh from other devices.
 *
 *  - If the thread is actively streaming, skip entirely to avoid clobbering
 *    the in-flight assistant message.
 *  - Otherwise: keep existing message object references for any id we already
 *    have (so React skips re-rendering existing bubbles and the scroll
 *    container does not jump), append new ids in server order at the end, and
 *    drop nothing.
 */
export function mergeMessagesFromServer(threadId: string, serverMessages: Message[]): boolean {
  if (!Array.isArray(serverMessages)) return false
  const normalizedServerMessages = serverMessages.map((m) => (
    m.toolCalls ? { ...m, toolCalls: normalizeToolCalls(m.toolCalls), streaming: false } : { ...m, streaming: false }
  ))
  const chat = useChatStore.getState()
  const ts = chat.threadStates[threadId]

  // Thread not currently loaded into the store — just persist; lazy load picks it up.
  if (!ts) {
    try {
      localStorage.setItem(getMessagesKey(threadId), JSON.stringify(normalizedServerMessages.slice(-100)))
    } catch { /* ignore */ }
    return false
  }

  // Mid-stream: never replace the array. Persistence happens on finalize anyway.
  if (ts.isStreaming) return false

  const localById = new Map(ts.messages.map(m => [m.id, m]))
  const localIds = new Set(localById.keys())
  const serverIds = new Set(normalizedServerMessages.map(m => m.id))

  // Detect new ids from the server side. If none, bail without churn.
  let hasNew = false
  for (const id of serverIds) {
    if (!localIds.has(id)) { hasNew = true; break }
  }
  if (!hasNew) return false

  // Build merged array in server's order, reusing local refs where possible.
  const merged: Message[] = normalizedServerMessages.map(s => {
    const existing = localById.get(s.id)
    return existing ?? s
  })

  // Preserve any local-only messages (e.g. just-sent that haven't reached the
  // server yet) by appending them at the end — EXCEPT when the same backend
  // response already arrived from the server under a different message id
  // (a recovery replay racing the other surface's stream). Appending that
  // copy is how answers showed up twice.
  const serverResponseIds = new Set(
    normalizedServerMessages
      .map((m) => m.backendResponseId ?? m.hermesResponseId)
      .filter((rid): rid is string => !!rid),
  )
  for (const local of ts.messages) {
    if (serverIds.has(local.id)) continue
    const rid = local.backendResponseId ?? local.hermesResponseId
    if (rid && serverResponseIds.has(rid)) continue
    // Place the local-only message at its chronological position instead of
    // blindly appending at the end. A local message that is OLDER than the
    // server tail (e.g. a recovered mid-thread reply, or a just-sent message
    // racing a newer server message) would otherwise land last and read as an
    // out-of-order duplicate. Server order is preserved; only the local message
    // is slotted in by timestamp.
    let at = merged.length
    while (at > 0 && merged[at - 1].timestamp > local.timestamp) at -= 1
    merged.splice(at, 0, local)
  }

  // Instrumentation: this is the server-sync boundary that can replace the
  // visible array. Pairs with [recovery-diag] finalize to tell whether an async
  // reply was client-finalized then clobbered, vs only ever arrived via sync.
  console.log('[recovery-diag] merge-from-server', {
    threadId,
    server: normalizedServerMessages.length,
    local: ts.messages.length,
    merged: merged.length,
    lastRole: merged[merged.length - 1]?.role ?? null,
    lastId: merged[merged.length - 1]?.id ?? null,
  })

  try {
    const toSave = merged.slice(-100).map((m) => (
      m.toolCalls ? { ...m, toolCalls: normalizeToolCalls(m.toolCalls) } : m
    ))
    localStorage.setItem(getMessagesKey(threadId), JSON.stringify(toSave))
  } catch { /* ignore */ }

  useChatStore.setState((state) => ({
    threadStates: {
      ...state.threadStates,
      [threadId]: { ...ts, messages: merged },
    },
  }))
  return true
}

/** Fetch + merge the messages of a single thread (used by SSE handler). */
export async function refreshThreadMessages(threadId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/threads/messages/${encodeURIComponent(threadId)}`)
    if (!res.ok) return false
    const data = await res.json() as Message[]
    return mergeMessagesFromServer(threadId, data)
  } catch {
    return false
  }
}

/** Apply a queued-message update that arrived from the server (SSE or sync).
 *  Skipped while a stream is in flight so we don't trample a just-drained queue. */
export function applyQueueFromServer(threadId: string, queue: QueuedMessage | null): void {
  persistQueuedMessageLocal(threadId, queue)
  const chat = useChatStore.getState()
  const ts = chat.threadStates[threadId]
  if (!ts) return
  if (ts.isStreaming && queue === null) return
  useChatStore.setState((state) => ({
    threadStates: {
      ...state.threadStates,
      [threadId]: { ...ts, queuedMessage: queue },
    },
  }))
}
