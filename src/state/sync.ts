import { getClientId, getMessagesKey, refreshThreadsMetadata, useThreadsStore } from './threads'
import { applyQueueFromServer, refreshThreadMessages, useChatStore, type Message, type QueuedMessage } from './chat'
import { normalizeToolCalls } from '../lib/toolCalls'

type ChangeEvent =
  | { type: 'threads' }
  | { type: 'messages'; threadId: string }
  | { type: 'thread-deleted'; threadId: string }
  | { type: 'queue'; threadId: string; queue: QueuedMessage | null }

let es: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let started = false

function close() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (es) {
    try { es.close() } catch { /* ignore */ }
    es = null
  }
}

function open() {
  close()
  try {
    // Tag the connection so the server can skip echoing our own writes back to us.
    const url = `/api/threads/events?clientId=${encodeURIComponent(getClientId())}`
    es = new EventSource(url)
  } catch {
    return
  }
  es.onopen = () => {
    // On (re)connect, do a one-shot metadata sweep so we don't miss anything
    // that happened while we were disconnected. The active thread, if loaded,
    // also gets a message refresh.
    refreshThreadsMetadata()
    const activeId = useThreadsStore.getState().activeThreadId
    if (activeId && useChatStore.getState().threadStates[activeId]) {
      refreshThreadMessages(activeId)
    }
  }
  es.onmessage = (ev) => {
    let event: ChangeEvent | null = null
    try { event = JSON.parse(ev.data) as ChangeEvent } catch { return }
    if (!event) return
    handleEvent(event)
  }
  es.onerror = () => {
    // EventSource auto-reconnects, but Vite middlewares can leave it in a
    // broken state after an HMR. Close and retry with backoff.
    close()
    reconnectTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') open()
    }, 3000)
  }
}

function handleEvent(event: ChangeEvent) {
  if (event.type === 'threads') {
    refreshThreadsMetadata()
    return
  }
  if (event.type === 'messages') {
    const loaded = !!useChatStore.getState().threadStates[event.threadId]
    if (loaded) {
      // Loaded thread: surgical merge into Zustand (preserves scroll + refs).
      refreshThreadMessages(event.threadId)
    } else {
      // Not currently loaded: refresh localStorage so the lazy loader returns
      // up-to-date messages the moment the user opens this thread. Otherwise
      // "reload doesn't help" persists because loadThreadMessages reads from a
      // stale localStorage entry.
      void fetch(`/api/threads/messages/${encodeURIComponent(event.threadId)}`)
        .then(r => r.ok ? r.json() as Promise<Message[]> : null)
        .then((data) => {
          if (!Array.isArray(data)) return
          const messages = data.slice(-100).map((m) => (
            m.toolCalls ? { ...m, toolCalls: normalizeToolCalls(m.toolCalls) } : m
          ))
          try {
            localStorage.setItem(getMessagesKey(event.threadId), JSON.stringify(messages))
          } catch { /* ignore */ }
        })
        .catch(() => { /* server unavailable */ })
    }
    return
  }
  if (event.type === 'queue') {
    applyQueueFromServer(event.threadId, event.queue ?? null)
    return
  }
  if (event.type === 'thread-deleted') {
    // Drop the thread metadata locally so the sidebar stays in sync.
    const store = useThreadsStore.getState()
    if (store.threads.some(t => t.id === event.threadId)) {
      const next = store.threads.filter(t => t.id !== event.threadId)
      try { localStorage.setItem('clavus-threads', JSON.stringify(next)) } catch { /* ignore */ }
      useThreadsStore.setState({ threads: next })
    }
    // Also clear messages from the store so we don't show ghost content.
    const chat = useChatStore.getState()
    if (chat.threadStates[event.threadId]) {
      const rest = { ...chat.threadStates }
      delete rest[event.threadId]
      useChatStore.setState({ threadStates: rest })
    }
    try { localStorage.removeItem(`clavus-queue-${event.threadId}`) } catch { /* ignore */ }
    return
  }
}

/** Start the live cross-device sync channel. Idempotent. */
export function startThreadsSync() {
  if (started) return
  started = true

  open()

  const onVis = () => {
    if (document.visibilityState === 'visible') {
      // Always re-open on visibility — mobile WebKit aggressively kills idle
      // EventSource connections. Re-opening triggers an onopen sweep that
      // catches us up on anything missed.
      open()
    } else {
      // Stop holding the connection open in the background.
      close()
    }
  }
  document.addEventListener('visibilitychange', onVis)
  window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible' && !es) open()
  })

  // Re-export for ad-hoc refresh from elsewhere if needed.
  ;(window as Window & { __clavusRefreshActiveThread?: () => void }).__clavusRefreshActiveThread = () => {
    const activeId = useThreadsStore.getState().activeThreadId
    if (activeId) refreshThreadMessages(activeId)
  }
}

/** Re-open the live sync channel after an explicit connection retry/resume. */
export function restartThreadsSync() {
  if (!started) {
    startThreadsSync()
    return
  }
  if (document.visibilityState === 'visible') open()
}
