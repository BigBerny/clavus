import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '../state/chat.ts'
import { useUIStore } from '../state/ui.ts'
import { sendChatStream, checkGateway, generateTitle } from '../gateway/chat.ts'
import { useThreadsStore } from '../state/threads.ts'
import { getConfig } from '../gateway/config.ts'
import type { ChatCompletionMessage } from '../gateway/chat.ts'

const MAX_RETRIES = 2
const RETRY_DELAY = 1500
const TITLE_GEN_AT = [2, 10] // Generate title after 2 messages (first exchange) and 10 messages

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function useChat() {
  const {
    messages,
    isStreaming,
    addMessage,
    appendToMessage,
    appendThinking,
    setThinkingDone,
    finalizeMessage,
    setStreaming,
    setAbortController,
    abortController,
    clearMessages,
  } = useChatStore()

  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)
  const offlineQueueRef = useRef<string[]>([])
  const sendRef = useRef<((content: string, images?: string[], retryCount?: number) => Promise<void>) | undefined>(undefined)

  // Online/offline detection + reconnect
  useEffect(() => {
    const handleOnline = async () => {
      setConnectionStatus('reconnecting')
      const config = getConfig()
      const ok = await checkGateway(config)
      setConnectionStatus(ok ? 'connected' : 'disconnected')

      if (ok && offlineQueueRef.current.length > 0) {
        const queued = offlineQueueRef.current.splice(0)
        for (const content of queued) {
          sendRef.current?.(content)
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

  const send = useCallback(async (content: string, images?: string[], retryCount = 0) => {
    if (!content.trim() && (!images || images.length === 0)) return
    const store = useChatStore.getState()
    if (store.isStreaming) return

    // If offline, queue
    if (!navigator.onLine) {
      addMessage({ role: 'user', content: content.trim(), images })
      addMessage({ role: 'system', content: 'You are offline. Message will be sent when connection is restored.' })
      offlineQueueRef.current.push(content.trim())
      return
    }

    if (retryCount === 0) {
      addMessage({ role: 'user', content: content.trim(), images })
    }

    const apiMessages: ChatCompletionMessage[] = useChatStore
      .getState()
      .messages.filter((m) => m.role !== 'system')
      .map((m) => {
        // Build vision-format content if message has images
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

    const assistantId = useChatStore.getState().addMessage({
      role: 'assistant',
      content: '',
      streaming: true,
    })

    const controller = new AbortController()
    setAbortController(controller)
    setStreaming(true)
    setConnectionStatus('connected')

    try {
      await sendChatStream(
        getConfig(),
        apiMessages,
        {
          onThinking: (token) => appendThinking(assistantId, token),
          onThinkingDone: () => setThinkingDone(assistantId),
          onToken: (token) => appendToMessage(assistantId, token),
          onDone: () => {
            finalizeMessage(assistantId)
            setStreaming(false)
            setAbortController(null)

            // Auto-generate title at specific message counts
            const currentMessages = useChatStore.getState().messages.filter(m => m.role !== 'system')
            const msgCount = currentMessages.length
            if (TITLE_GEN_AT.includes(msgCount) || (msgCount > 2 && msgCount % 10 === 0)) {
              const activeThreadId = useThreadsStore.getState().activeThreadId
              const activeThread = useThreadsStore.getState().threads.find(t => t.id === activeThreadId)
              // Only generate if title is still default or on the 10-message interval
              if (activeThread && (activeThread.title === 'New conversation' || msgCount >= 10)) {
                const apiMsgs = currentMessages.map(m => ({
                  role: m.role as 'user' | 'assistant',
                  content: m.content,
                }))
                generateTitle(getConfig(), apiMsgs).then(title => {
                  if (title) {
                    useThreadsStore.getState().updateThreadTitle(activeThreadId, title)
                  }
                })
              }
            }
          },
          onError: (error) => {
            finalizeMessage(assistantId)
            setStreaming(false)
            setAbortController(null)
            if (error.name !== 'AbortError') {
              // Remove empty assistant message
              const state = useChatStore.getState()
              const msg = state.messages.find((m) => m.id === assistantId)
              if (msg && !msg.content) {
                useChatStore.setState({
                  messages: state.messages.filter((m) => m.id !== assistantId),
                })
              }
              addMessage({ role: 'system', content: `Error: ${error.message}` })
            }
          },
        },
        controller.signal,
      )
    } catch (error) {
      finalizeMessage(assistantId)
      setStreaming(false)
      setAbortController(null)

      if (error instanceof Error && error.name === 'AbortError') return

      // Remove empty assistant message
      const state = useChatStore.getState()
      const msg = state.messages.find((m) => m.id === assistantId)
      if (msg && !msg.content) {
        useChatStore.setState({
          messages: state.messages.filter((m) => m.id !== assistantId),
        })
      }

      // Retry
      if (retryCount < MAX_RETRIES) {
        setConnectionStatus('reconnecting')
        addMessage({ role: 'system', content: `Connection failed. Retrying... (${retryCount + 1}/${MAX_RETRIES})` })
        await delay(RETRY_DELAY)
        return sendRef.current?.(content, images, retryCount + 1)
      }

      setConnectionStatus('disconnected')
      addMessage({
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : 'Connection failed'}`,
      })
    }
  }, [addMessage, appendToMessage, appendThinking, setThinkingDone, finalizeMessage, setStreaming, setAbortController, setConnectionStatus])

  // Keep ref updated for offline queue flush
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const abort = useCallback(() => {
    abortController?.abort()
    setStreaming(false)
    setAbortController(null)
  }, [abortController, setStreaming, setAbortController])

  return { messages, isStreaming, send, abort, clearMessages }
}
