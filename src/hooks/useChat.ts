import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '../state/chat.ts'
import { useUIStore } from '../state/ui.ts'
import { sendChatStream, sendChatViaWs, abortChat, generateTitleViaOpenRouter } from '../gateway/chat.ts'
import { useThreadsStore } from '../state/threads.ts'
import { useSessionsStore, makeSessionKey } from '../state/sessions.ts'
import { gateway } from '../gateway/ws.ts'
import { getConfig } from '../gateway/config.ts'
import type { ChatCompletionMessage } from '../gateway/chat.ts'

const MAX_RETRIES = 2
const RETRY_DELAY = 1500

function shouldGenerateTitle(userMsgCount: number): boolean {
  return userMsgCount > 0 && (userMsgCount & (userMsgCount - 1)) === 0
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function useChat() {
  const store = useChatStore
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)
  const offlineQueueRef = useRef<{ threadId: string; content: string; images?: string[] }[]>([])
  const sendRef = useRef<((threadId: string, content: string, images?: string[], retryCount?: number) => Promise<void>) | undefined>(undefined)
  const activeRunsRef = useRef<Map<string, { runId: string; cleanup: () => void }>>(new Map())

  // Online/offline detection + reconnect
  useEffect(() => {
    const handleOnline = async () => {
      setConnectionStatus('reconnecting')
      const config = getConfig()

      // Try WebSocket first
      if (!gateway.connected) {
        try {
          await gateway.connect(config.url, config.token)
        } catch { /* ignore */ }
      }

      const ok = gateway.connected || await import('../gateway/chat.ts').then(m => m.checkGateway(config))
      setConnectionStatus(ok ? 'connected' : 'disconnected')

      if (ok && offlineQueueRef.current.length > 0) {
        const queued = offlineQueueRef.current.splice(0)
        for (const { threadId, content, images } of queued) {
          sendRef.current?.(threadId, content, images)
        }
      }
    }

    const handleOffline = () => {
      setConnectionStatus('disconnected')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [setConnectionStatus])

  const send = useCallback(async (threadId: string, content: string, images?: string[], retryCount = 0) => {
    if (!content.trim() && (!images || images.length === 0)) return

    const {
      getThreadState,
      ensureThread,
      addMessage,
      appendToMessage,
      appendThinking,
      setThinkingDone,
      finalizeMessage,
      setStreaming,
      setAbortController,
      removeMessage,
    } = store.getState()

    const threadState = getThreadState(threadId)
    if (threadState.isStreaming) return

    ensureThread(threadId)

    // If offline, queue
    if (!navigator.onLine) {
      addMessage(threadId, { role: 'user', content: content.trim(), images })
      addMessage(threadId, { role: 'system', content: 'You are offline. Message will be sent when connection is restored.' })
      offlineQueueRef.current.push({ threadId, content: content.trim(), images })
      return
    }

    if (retryCount === 0) {
      addMessage(threadId, { role: 'user', content: content.trim(), images })
    }

    const assistantId = store.getState().addMessage(threadId, {
      role: 'assistant',
      content: '',
      streaming: true,
    })

    setStreaming(threadId, true)
    setConnectionStatus('connected')

    // Try WebSocket first, fall back to REST
    if (gateway.connected) {
      try {
        const config = getConfig()
        const sessionKey = makeSessionKey(config.agentId, threadId)

        const { runId, cleanup } = await sendChatViaWs(
          sessionKey,
          content.trim(),
          {
            onThinking: (token) => store.getState().appendThinking(threadId, assistantId, token),
            onThinkingDone: () => store.getState().setThinkingDone(threadId, assistantId),
            onToken: (token) => store.getState().appendToMessage(threadId, assistantId, token),
            onToolCall: (tc) => {
              const msg = store.getState().getThreadState(threadId).messages.find(m => m.id === assistantId)
              const existing = msg?.toolCalls || []
              const idx = existing.findIndex(t => t.id === tc.id)
              const updated = idx >= 0
                ? existing.map((t, i) => i === idx ? tc : t)
                : [...existing, tc]
              store.getState().updateToolCalls(threadId, assistantId, updated)
            },
            onDone: () => {
              store.getState().finalizeMessage(threadId, assistantId)
              store.getState().setStreaming(threadId, false)
              activeRunsRef.current.delete(threadId)
              generateTitleIfNeeded(threadId)
            },
            onError: (error) => {
              store.getState().finalizeMessage(threadId, assistantId)
              store.getState().setStreaming(threadId, false)
              activeRunsRef.current.delete(threadId)
              const ts = store.getState().getThreadState(threadId)
              const msg = ts.messages.find((m) => m.id === assistantId)
              if (msg && !msg.content) {
                store.getState().removeMessage(threadId, assistantId)
              }
              store.getState().addMessage(threadId, { role: 'system', content: `Error: ${error.message}` })
            },
          },
        )

        activeRunsRef.current.set(threadId, { runId, cleanup })
        return
      } catch (e) {
        console.warn('[Chat] WebSocket send failed, falling back to REST:', e)
        // Fall through to REST
      }
    }

    // REST fallback
    const config = getConfig()
    const apiMessages: ChatCompletionMessage[] = store
      .getState()
      .getThreadState(threadId)
      .messages.filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.images && m.images.length > 0) {
          const parts: ChatCompletionMessage['content'] = []
          if (m.content) parts.push({ type: 'text' as const, text: m.content })
          for (const img of m.images) {
            parts.push({ type: 'image_url' as const, image_url: { url: img } })
          }
          return { role: m.role, content: parts }
        }
        return { role: m.role, content: m.content }
      })

    const controller = new AbortController()
    setAbortController(threadId, controller)

    try {
      await sendChatStream(
        config,
        apiMessages,
        {
          onThinking: (token) => store.getState().appendThinking(threadId, assistantId, token),
          onThinkingDone: () => store.getState().setThinkingDone(threadId, assistantId),
          onToken: (token) => store.getState().appendToMessage(threadId, assistantId, token),
          onDone: () => {
            store.getState().finalizeMessage(threadId, assistantId)
            store.getState().setStreaming(threadId, false)
            store.getState().setAbortController(threadId, null)
            generateTitleIfNeeded(threadId)
          },
          onError: (error) => {
            store.getState().finalizeMessage(threadId, assistantId)
            store.getState().setStreaming(threadId, false)
            store.getState().setAbortController(threadId, null)
            if (error.name !== 'AbortError') {
              const ts = store.getState().getThreadState(threadId)
              const msg = ts.messages.find((m) => m.id === assistantId)
              if (msg && !msg.content) {
                store.getState().removeMessage(threadId, assistantId)
              }
              store.getState().addMessage(threadId, { role: 'system', content: `Error: ${error.message}` })
            }
          },
        },
        controller.signal,
      )
    } catch (error) {
      store.getState().finalizeMessage(threadId, assistantId)
      store.getState().setStreaming(threadId, false)
      store.getState().setAbortController(threadId, null)

      if (error instanceof Error && error.name === 'AbortError') return

      const ts = store.getState().getThreadState(threadId)
      const msg = ts.messages.find((m) => m.id === assistantId)
      if (msg && !msg.content) {
        store.getState().removeMessage(threadId, assistantId)
      }

      if (retryCount < MAX_RETRIES) {
        setConnectionStatus('reconnecting')
        store.getState().addMessage(threadId, { role: 'system', content: `Connection failed. Retrying... (${retryCount + 1}/${MAX_RETRIES})` })
        await delay(RETRY_DELAY)
        return sendRef.current?.(threadId, content, images, retryCount + 1)
      }

      setConnectionStatus('disconnected')
      store.getState().addMessage(threadId, {
        role: 'system',
        content: `Connection failed after ${MAX_RETRIES} retries. Pull down to refresh or resend your message.`,
      })
    }
  }, [setConnectionStatus])

  useEffect(() => {
    sendRef.current = send
  }, [send])

  const abort = useCallback((threadId: string) => {
    // Try WebSocket abort first
    const activeRun = activeRunsRef.current.get(threadId)
    if (activeRun) {
      activeRun.cleanup()
      activeRunsRef.current.delete(threadId)
      const config = getConfig()
      const sessionKey = makeSessionKey(config.agentId, threadId)
      abortChat(sessionKey, activeRun.runId).catch(() => {})
      store.getState().setStreaming(threadId, false)
      return
    }

    // REST fallback
    const ts = store.getState().getThreadState(threadId)
    ts.abortController?.abort()
    store.getState().setStreaming(threadId, false)
    store.getState().setAbortController(threadId, null)
  }, [])

  return { send, abort }
}

function generateTitleIfNeeded(threadId: string) {
  const currentMessages = useChatStore.getState().getThreadState(threadId).messages.filter(m => m.role !== 'system')
  const userMessages = currentMessages.filter(m => m.role === 'user')
  const userMsgCount = userMessages.length
  if (userMsgCount > 0 && (userMsgCount & (userMsgCount - 1)) === 0) {
    const config = getConfig()
    if (config.openrouterApiKey) {
      const userTexts = userMessages.map(m => m.content)
      generateTitleViaOpenRouter(config.openrouterApiKey, userTexts).then(title => {
        if (title) {
          useThreadsStore.getState().updateThreadTitle(threadId, title)
        }
      })
    }
  }
}
