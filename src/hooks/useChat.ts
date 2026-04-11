import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '../state/chat.ts'
import { useUIStore } from '../state/ui.ts'
import { sendChatStream, checkGateway, generateTitleViaOpenRouter } from '../gateway/chat.ts'
import { useThreadsStore } from '../state/threads.ts'
import { getConfig } from '../gateway/config.ts'
import type { ChatCompletionMessage } from '../gateway/chat.ts'

const MAX_RETRIES = 2
const RETRY_DELAY = 1500
// Generate title after user message 1, 2, 4, 8, 16, 32... (powers of 2)
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

  // Online/offline detection + reconnect
  useEffect(() => {
    const handleOnline = async () => {
      setConnectionStatus('reconnecting')
      const config = getConfig()
      const ok = await checkGateway(config)
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

    // Per-thread streaming guard
    const threadState = getThreadState(threadId)
    if (threadState.isStreaming) return

    // Ensure thread is loaded in store
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

    const assistantId = store.getState().addMessage(threadId, {
      role: 'assistant',
      content: '',
      streaming: true,
    })

    const controller = new AbortController()
    setAbortController(threadId, controller)
    setStreaming(threadId, true)
    setConnectionStatus('connected')

    try {
      await sendChatStream(
        getConfig(),
        apiMessages,
        {
          onThinking: (token) => store.getState().appendThinking(threadId, assistantId, token),
          onThinkingDone: () => store.getState().setThinkingDone(threadId, assistantId),
          onToken: (token) => store.getState().appendToMessage(threadId, assistantId, token),
          onDone: () => {
            store.getState().finalizeMessage(threadId, assistantId)
            store.getState().setStreaming(threadId, false)
            store.getState().setAbortController(threadId, null)

            // Auto-generate title at powers of 2 user message counts (1, 2, 4, 8, 16...)
            const currentMessages = store.getState().getThreadState(threadId).messages.filter(m => m.role !== 'system')
            const userMessages = currentMessages.filter(m => m.role === 'user')
            const userMsgCount = userMessages.length
            if (shouldGenerateTitle(userMsgCount)) {
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

      // Remove empty assistant message
      const ts = store.getState().getThreadState(threadId)
      const msg = ts.messages.find((m) => m.id === assistantId)
      if (msg && !msg.content) {
        store.getState().removeMessage(threadId, assistantId)
      }

      // Retry
      if (retryCount < MAX_RETRIES) {
        setConnectionStatus('reconnecting')
        store.getState().addMessage(threadId, { role: 'system', content: `Connection failed. Retrying... (${retryCount + 1}/${MAX_RETRIES})` })
        await delay(RETRY_DELAY)
        return sendRef.current?.(threadId, content, images, retryCount + 1)
      }

      setConnectionStatus('disconnected')
      store.getState().addMessage(threadId, {
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : 'Connection failed'}`,
      })
    }
  }, [setConnectionStatus])

  // Keep ref updated for offline queue flush
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const abort = useCallback((threadId: string) => {
    const ts = store.getState().getThreadState(threadId)
    ts.abortController?.abort()
    store.getState().setStreaming(threadId, false)
    store.getState().setAbortController(threadId, null)
  }, [])

  return { send, abort }
}
