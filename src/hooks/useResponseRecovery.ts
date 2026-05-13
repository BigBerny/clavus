import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '../state/chat.ts'
import { recoverResponse } from '../gateway/chat.ts'
import { useThreadsStore } from '../state/threads.ts'

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
  console.log('[Recovery] Attempting recovery for', threadId, 'poll attempt', pollAttempt)

  const store = useChatStore.getState()
  const ts = store.getThreadState(threadId)

  // Re-check: don't interfere with active streams
  if (ts.isStreaming) {
    console.log('[Recovery] Skipping — thread is actively streaming')
    return
  }

  const recovered = await recoverResponse(threadId)
  if (!recovered) {
    console.log('[Recovery] No response found in Hermes for', threadId)
    return
  }

  console.log('[Recovery] Hermes response:', recovered.status, 'text length:', recovered.text?.length || 0)

  // Dedup: check if we already have this response
  if (recovered.responseId) {
    const existing = ts.messages.find(m => m.hermesResponseId === recovered.responseId)
    if (existing) {
      console.log('[Recovery] Already have this response, skipping')
      return
    }
  }

  if ((recovered.status === 'completed' || recovered.status === 'incomplete') && recovered.text) {
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
    console.log('[Recovery] Still in progress, polling again in', POLL_DELAYS[pollAttempt], 'ms')
    setTimeout(() => attemptRecovery(threadId, pollAttempt + 1), POLL_DELAYS[pollAttempt])
    return
  }

  console.log('[Recovery] Cannot recover — status:', recovered.status, 'text:', recovered.text?.length || 0)
}

/** Check all threads that might need recovery (e.g., on startup) */
export function checkAllThreadsRecovery() {
  const threads = useThreadsStore.getState().threads
  for (const thread of threads) {
    if (needsRecovery(thread.id)) {
      console.log('[Recovery] Thread needs recovery:', thread.id)
      attemptRecovery(thread.id)
    }
  }
}

export function useResponseRecovery() {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkRecovery = useCallback((threadId: string) => {
    if (!threadId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (needsRecovery(threadId)) {
        console.log('[Recovery] Thread needs recovery:', threadId)
        attemptRecovery(threadId)
      }
    }, 500)
  }, [])

  // On mount, check all threads for recovery
  useEffect(() => {
    const timer = setTimeout(checkAllThreadsRecovery, 2000)
    return () => {
      clearTimeout(timer)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return { checkRecovery }
}
