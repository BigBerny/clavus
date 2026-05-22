import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '../state/chat.ts'
import { recoverResponse, resumeChatStream } from '../gateway/chat.ts'
import { useThreadsStore } from '../state/threads.ts'
import { getConfig } from '../gateway/config.ts'

/**
 * Detects interrupted/missing assistant responses and recovers them from the
 * server-side Responses event buffer.
 *
 * The selected chat backend can keep processing server-side even when the
 * client disconnects (e.g. iOS killing the WebView). This hook replays the
 * buffered stream on app resume or thread switch.
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

async function attemptRecovery(threadId: string): Promise<void> {
  console.log('[Recovery] Attempting recovery for', threadId)

  const store = useChatStore.getState()
  const ts = store.getThreadState(threadId)

  // Re-check: don't interfere with active streams
  if (ts.isStreaming) {
    console.log('[Recovery] Skipping — thread is actively streaming')
    return
  }

  // 1) Prefer streaming from the Clavus server-side event buffer. This restores
  //    reasoning + tool calls + text, not just final text.
  // Identify (or create) the assistant message slot we will populate.
  const assistantMsg = [...ts.messages].reverse().find(m => m.role === 'assistant' && (!m.content || !!m.streaming))
  let assistantId: string | null = assistantMsg?.id || null
  const responseId = assistantMsg?.backendResponseId ?? assistantMsg?.hermesResponseId
  const fromSeq = typeof assistantMsg?.lastEventSeq === 'number' ? assistantMsg.lastEventSeq + 1 : 0

  // Clean up any stale connection-failed system messages before re-streaming
  const messages = [...ts.messages]
  while (messages.length > 0) {
    const last = messages[messages.length - 1]
    if (last.role === 'system' && (last.content.startsWith('Connection failed') || last.content.startsWith('Error:'))) {
      messages.pop()
    } else {
      break
    }
  }
  if (messages.length !== ts.messages.length) {
    useChatStore.setState((s) => {
      const cur = s.threadStates[threadId]
      if (!cur) return s
      return { threadStates: { ...s.threadStates, [threadId]: { ...cur, messages } } }
    })
  }

  // Lazy slot creation: only allocate an assistant bubble once we know a buffer
  // or a completed response actually exists. This avoids polluting old threads
  // with empty streaming bubbles on app mount.
  let createdSlot = false
  const ensureSlot = (): string => {
    if (assistantId) return assistantId
    assistantId = useChatStore.getState().addMessage(threadId, {
      role: 'assistant',
      content: '',
      streaming: true,
    })
    createdSlot = true
    useChatStore.getState().setStreaming(threadId, true)
    return assistantId
  }
  // If a prior assistant slot already exists, mark the thread streaming so the
  // UI shows the bubble while we attempt resume.
  if (assistantId) useChatStore.getState().setStreaming(threadId, true)

  // Build resume callbacks that allocate the slot lazily on the FIRST inbound
  // event. Until then, the buffer endpoint may still 404 (no buffer for this
  // thread) — in which case we never create a bubble.
  let resumeReceivedEvent = false
  const resumeCallbacks = {
    onThinking: (token: string) => useChatStore.getState().appendThinking(threadId, ensureSlot(), token),
    onThinkingDone: () => useChatStore.getState().setThinkingDone(threadId, ensureSlot()),
    onToken: (token: string) => useChatStore.getState().appendToMessage(threadId, ensureSlot(), token),
    onToolCall: (tc: import('../gateway/chat.ts').ToolCallEvent) => {
      const id = ensureSlot()
      const cur = useChatStore.getState().getThreadState(threadId).messages.find(m => m.id === id)
      const existing = cur?.toolCalls || []
      const idx = existing.findIndex(t => t.id === tc.id)
      const next = idx >= 0
        ? existing.map((t, i) => i === idx ? tc : t)
        : [...existing, tc]
      useChatStore.getState().updateToolCalls(threadId, id, next)
    },
    onResponseId: (rid: string) => useChatStore.getState().setBackendResponseId(threadId, ensureSlot(), rid),
    onSeq: (seq: number) => {
      resumeReceivedEvent = true
      // Only persist seq if we have a slot (i.e. real content has flowed)
      if (assistantId) useChatStore.getState().setLastEventSeq(threadId, assistantId, seq)
    },
    onUsage: (usage: import('../gateway/chat.ts').UsageData) => {
      const id = ensureSlot()
      useChatStore.getState().setMessageUsage(threadId, id, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      })
      if (usage.model) useChatStore.getState().setMessageModel(threadId, id, usage.model)
    },
    onDone: () => {
      if (assistantId) useChatStore.getState().finalizeMessage(threadId, assistantId)
      useChatStore.getState().setStreaming(threadId, false)
    },
    onError: (err: Error) => {
      console.error('[Recovery] resumeChatStream onError:', err.message)
      if (assistantId) useChatStore.getState().finalizeMessage(threadId, assistantId)
      useChatStore.getState().setStreaming(threadId, false)
    },
  }

  try {
    await resumeChatStream({ responseId, threadId, fromSeq }, resumeCallbacks)
    if (resumeReceivedEvent) {
      console.log('[Recovery] Resume completed for', threadId)
      return
    }
    // Resume returned 200 but emitted no events (unlikely with our buffer) —
    // fall through to legacy recovery.
  } catch (e) {
    console.warn('[Recovery] Buffer resume not available, trying backend-store recovery:', e)
    useChatStore.getState().setStreaming(threadId, false)
  }

  // 2) Legacy fallback: backend-store-only recovery when the selected backend supports it.
  const recovered = await recoverResponse(threadId, getConfig())
  if (!recovered) {
    console.log('[Recovery] No backend response found for', threadId)
    // If we eagerly created a slot but neither path produced content, remove it.
    if (createdSlot && assistantId) {
      useChatStore.getState().removeMessage(threadId, assistantId)
    }
    return
  }

  // Dedup: if our assistant slot already references this responseId, do nothing.
  if (recovered.responseId) {
    const existing = useChatStore.getState().getThreadState(threadId).messages
      .find(m => (m.backendResponseId ?? m.hermesResponseId) === recovered.responseId && m.content)
    if (existing) {
      console.log('[Recovery] Already have this response, skipping')
      return
    }
  }

  if ((recovered.status === 'completed' || recovered.status === 'incomplete') && recovered.text) {
    const freshStore = useChatStore.getState()
    // Use the existing slot if any, else add a new one.
    const targetId = assistantId && freshStore.getThreadState(threadId).messages.some(m => m.id === assistantId)
      ? assistantId
      : null
    if (targetId) {
      freshStore.updateMessage(threadId, targetId, recovered.text)
      if (recovered.toolCalls && recovered.toolCalls.length > 0) {
        freshStore.updateToolCalls(threadId, targetId, recovered.toolCalls)
      }
      if (recovered.model) freshStore.setMessageModel(threadId, targetId, recovered.model)
      if (recovered.usage) freshStore.setMessageUsage(threadId, targetId, recovered.usage)
      freshStore.setBackendResponseId(threadId, targetId, recovered.responseId)
      freshStore.finalizeMessage(threadId, targetId)
    } else {
      const newId = freshStore.addMessage(threadId, {
        role: 'assistant',
        content: recovered.text,
        thinking: recovered.thinking,
        thinkingDone: recovered.thinking ? true : undefined,
        toolCalls: recovered.toolCalls,
        model: recovered.model,
        usage: recovered.usage ? {
          inputTokens: recovered.usage.inputTokens,
          outputTokens: recovered.usage.outputTokens,
          totalTokens: recovered.usage.totalTokens,
        } : undefined,
        backendResponseId: recovered.responseId,
        hermesResponseId: recovered.responseId,
      })
      freshStore.finalizeMessage(threadId, newId)
    }

    console.log('[Recovery] Response recovered via backend store for thread', threadId, recovered.responseId)
    return
  }

  // Recovered but neither completed nor with text — drop any eager slot.
  if (createdSlot && assistantId) {
    useChatStore.getState().removeMessage(threadId, assistantId)
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
