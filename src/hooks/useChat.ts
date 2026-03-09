import { useCallback } from 'react'
import { useChatStore } from '../state/chat.ts'
import { useUIStore } from '../state/ui.ts'
import { sendChatStream } from '../gateway/chat.ts'
import { getConfig } from '../gateway/config.ts'
import type { ChatCompletionMessage } from '../gateway/chat.ts'

export function useChat() {
  const {
    messages,
    isStreaming,
    addMessage,
    appendToMessage,
    finalizeMessage,
    setStreaming,
    setAbortController,
    abortController,
    clearMessages,
  } = useChatStore()

  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)

  const send = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return

    addMessage({ role: 'user', content: content.trim() })

    const apiMessages: ChatCompletionMessage[] = [
      ...useChatStore.getState().messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ]

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
          onToken: (token) => appendToMessage(assistantId, token),
          onDone: () => {
            finalizeMessage(assistantId)
            setStreaming(false)
            setAbortController(null)
          },
          onError: (error) => {
            finalizeMessage(assistantId)
            setStreaming(false)
            setAbortController(null)
            if (error.name !== 'AbortError') {
              appendToMessage(assistantId, `\n\n*Error: ${error.message}*`)
            }
          },
        },
        controller.signal,
      )
    } catch (error) {
      finalizeMessage(assistantId)
      setStreaming(false)
      setAbortController(null)
      if (error instanceof Error && error.name !== 'AbortError') {
        appendToMessage(assistantId, error.message || 'Connection failed')
        setConnectionStatus('disconnected')
      }
    }
  }, [isStreaming, addMessage, appendToMessage, finalizeMessage, setStreaming, setAbortController, setConnectionStatus])

  const abort = useCallback(() => {
    abortController?.abort()
    setStreaming(false)
    setAbortController(null)
  }, [abortController, setStreaming, setAbortController])

  return { messages, isStreaming, send, abort, clearMessages }
}
