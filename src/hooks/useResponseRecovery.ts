import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '../state/chat.ts'
import { recoverResponse } from '../gateway/chat.ts'

/**
 * Detects interrupted/missing assistant responses and recovers them from Hermes.
 *
 * Hermes continues processing server-side even when the client disconnects
 * (e.g. iOS killing the WebView). This hook fetches the completed response
 * on app resume or thread switch.
 */

function needsRecovery(threadId: string): boolean {
  const ts = useChatStore.getState().getThreadState(threadId)
  if (ts.isStreaming) return false // active stream, don't interfere
  if (ts.messages.length === 0) return false

  const last = ts.messages[ts.messages.length - 1]

  // Stuck streaming message (app was killed mid-stream, reloaded with streaming: true → set to false on load)
  if (last.role === 'assistant' && !last.content && !last.streaming) {
    return true
  }

  // System error message from failed retry
  if (last.role === 'system' && last.content.startsWith('Connection failed')) {
    return true
  }

  // Last user message with no assistant response after it
  if (last.role === 'user') {
    return true
  }

  return false
}

const POLL_DELAYS = [3000, 6000, 12000]

async function attemptRecovery(threadId: string, pollAttempt = 0): Promise<void> {
  const store = useChatStore.getState()
  const ts = store.getThreadState(threadId)

  // Re-check: don't interfere with active streams
  if (ts.isStreaming) return

  const recovered = await recoverResponse(threadId)
  if (!recovered) return

  // Dedup: check if we already have this response
  if (recovered.responseId) {
    const existing = ts.messages.find(m => m.hermesResponseId === recovered.responseId)
    if (existing) return
  }

  if (recovered.status === 'completed' && recovered.text) {
    // Remove error system messages and empty assistant messages from the end
    const messages = [...ts.messages]
    while (messages.length > 0) {
      const last = messages[messages.length - 1]
      if (last.role === 'system' && (last.content.startsWith('Connection failed') || last.content.startsWith('Error:'))) {
        messages.pop()
      } else if (last.role === 'assistant' && !last.content) {
        messages.pop()
      } else {
        break
      }
    }

    // Update store with cleaned messages
    const freshStore = useChatStore.getState()
    const currentTs = freshStore.threadStates[threadId]
    if (currentTs) {
      useChatStore.setState({
        threadStates: {
          ...freshStore.threadStates,
          [threadId]: { ...currentTs, messages },
        },
      })
    }

    // Add the recovered assistant message
    const msgId = freshStore.addMessage(threadId, {
      role: 'assistant',
      content: recovered.text,
      thinking: recovered.thinking,
      thinkingDone: recovered.thinking ? true : undefined,
      model: recovered.model,
      usage: recovered.usage ? {
        inputTokens: recovered.usage.inputTokens,
        outputTokens: recovered.usage.outputTokens,
        totalTokens: recovered.usage.totalTokens,
      } : undefined,
      hermesResponseId: recovered.responseId,
    })
    freshStore.finalizeMessage(threadId, msgId)

    console.log('[Recovery] Response recovered for thread', threadId, recovered.responseId)
    return
  }

  if (recovered.status === 'in_progress' && pollAttempt < POLL_DELAYS.length) {
    // Still processing — poll again after delay
    setTimeout(() => attemptRecovery(threadId, pollAttempt + 1), POLL_DELAYS[pollAttempt])
    return
  }

  // incomplete/failed — nothing to recover
}

export function useResponseRecovery() {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkRecovery = useCallback((threadId: string) => {
    if (!threadId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (needsRecovery(threadId)) {
        attemptRecovery(threadId)
      }
    }, 500)
  }, [])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return { checkRecovery }
}
