import { useCallback, useEffect, useRef } from 'react'
import { useChatStore, refreshThreadMessages, type Message, type PendingFile } from '../state/chat.ts'
import { recoverResponse, resumeChatStream } from '../gateway/chat.ts'
import { useThreadsStore } from '../state/threads.ts'
import { getConfig } from '../gateway/config.ts'
import { normalizeToolCalls } from '../lib/toolCalls.ts'
import { markStreamActivity, recentStreamActivity } from '../lib/streamActivity.ts'

type RecoveryResult = 'recovered' | 'no-buffer' | 'skipped'

/** Threads we already auto-resent in this session, to avoid loops if the
 *  re-send also fails to produce a saved response. */
const autoRetriedThreads = new Set<string>()

/** Per-thread: the terminal user-message id we already attempted recovery for
 *  and found nothing durable to add. Without this, every visibilitychange /
 *  focus / panel switch re-runs recovery for the same unanswered turn and
 *  re-streams the buffered response into a throwaway bubble — the "answer
 *  flashes, shows twice, then vanishes on reload" loop the user hit while an
 *  async run's real reply was still pending server-side. A newer user message
 *  (different id) or a reload clears it; the server-sync path can still surface
 *  a late reply independently of this guard. */
const recoveryResolvedUserMsg = new Map<string, string>()

function markRecoveryResolved(threadId: string) {
  const ts = useChatStore.getState().getThreadState(threadId)
  const last = ts.messages[ts.messages.length - 1]
  if (last && last.role === 'user') recoveryResolvedUserMsg.set(threadId, last.id)
}

type AutoRetryCallback = (threadId: string, content: string, images?: string[], files?: PendingFile[]) => void
let autoRetryHandler: AutoRetryCallback | null = null
let drainQueuedHandler: AutoRetryCallback | null = null

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
  // The OTHER surface (window vs overlay) is streaming or just streamed this
  // thread — our local list is simply behind, not abandoned.
  if (recentStreamActivity(threadId, 12_000)) return false
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

  // Last user message with no assistant response after it. Skip if it's only
  // seconds old — useChat.send hasn't reached its assistant slot yet (the
  // auto-classify await can take up to 3s) and treating an in-flight send as
  // needing recovery races the user's own stream and produces a duplicate run.
  if (last.role === 'user') {
    // Already tried recovery for this exact unanswered turn and had nothing
    // durable to show — don't re-stream a throwaway copy on the next
    // focus/visibility tick. A newer user message re-enables recovery.
    if (recoveryResolvedUserMsg.get(threadId) === last.id) return false
    const age = Date.now() - last.timestamp
    if (age < 15_000) return false
    return true
  }

  return false
}

function previousUserTimestamp(messages: Message[], beforeIndex: number): number | undefined {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') return msg.timestamp
  }
  return undefined
}

function isDisposableEmptyAssistant(message: Message | null | undefined): boolean {
  return Boolean(
    message
    && message.role === 'assistant'
    && !message.content.trim()
    && !message.streaming
    && !message.thinking?.trim()
    && !message.toolCalls?.length
    && !message.media?.length,
  )
}

async function attemptRecovery(threadId: string): Promise<RecoveryResult> {
  console.log('[Recovery] Attempting recovery for', threadId)

  const store = useChatStore.getState()
  const ts = store.getThreadState(threadId)

  // Re-check: don't interfere with active streams
  if (ts.isStreaming) {
    console.log('[Recovery] Skipping — thread is actively streaming')
    return 'skipped'
  }

  // 1) Prefer streaming from the Clavus server-side event buffer. This restores
  //    reasoning + tool calls + text, not just final text.
  // Identify (or create) the assistant message slot we will populate.
  const assistantMsg = [...ts.messages].reverse().find(m => m.role === 'assistant' && (!m.content || !!m.streaming))
  let assistantId: string | null = assistantMsg?.id || null
  const responseId = assistantMsg?.backendResponseId ?? assistantMsg?.hermesResponseId
  const fromSeq = typeof assistantMsg?.lastEventSeq === 'number' ? assistantMsg.lastEventSeq + 1 : 0
  const assistantIndex = assistantMsg ? ts.messages.findIndex(m => m.id === assistantMsg.id) : ts.messages.length
  const minCreatedAt = previousUserTimestamp(ts.messages, assistantIndex >= 0 ? assistantIndex : ts.messages.length)

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
  let resumeProducedContent = false
  let lastActivityMark = 0
  const markProducedContent = () => {
    resumeProducedContent = true
  }
  const markThrottled = () => {
    const now = Date.now()
    if (now - lastActivityMark > 2000) {
      lastActivityMark = now
      markStreamActivity(threadId)
    }
  }
  const resumeCallbacks = {
    onThinking: (token: string) => {
      if (token.trim()) markProducedContent()
      markThrottled()
      useChatStore.getState().appendThinking(threadId, ensureSlot(), token)
    },
    onThinkingDone: () => useChatStore.getState().setThinkingDone(threadId, ensureSlot()),
    onToken: (token: string) => {
      if (token) markProducedContent()
      markThrottled()
      useChatStore.getState().appendToMessage(threadId, ensureSlot(), token)
    },
    onToolCall: (tc: import('../gateway/chat.ts').ToolCallEvent) => {
      markProducedContent()
      const id = ensureSlot()
      const cur = useChatStore.getState().getThreadState(threadId).messages.find(m => m.id === id)
      const existing = cur?.toolCalls || []
      const idx = existing.findIndex(t => t.id === tc.id)
      const next = idx >= 0
        ? existing.map((t, i) => i === idx ? tc : t)
        : [...existing, tc]
      useChatStore.getState().updateToolCalls(threadId, id, normalizeToolCalls(next))
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
      drainQueuedAfterRecoveredResponse(threadId)
    },
    onError: (err: Error) => {
      console.error('[Recovery] resumeChatStream onError:', err.message)
      if (assistantId) useChatStore.getState().finalizeMessage(threadId, assistantId)
      useChatStore.getState().setStreaming(threadId, false)
    },
  }

  const tryResumeBuffer = async (
    request: { responseId?: string; threadId: string; fromSeq?: number; minCreatedAt?: number },
    label: string,
  ): Promise<boolean> => {
    resumeReceivedEvent = false
    resumeProducedContent = false

    try {
      await resumeChatStream(request, resumeCallbacks)
    } catch (e) {
      console.warn(`[Recovery] Buffer resume (${label}) not available:`, e)
      return false
    }

    if (resumeProducedContent) {
      console.log('[Recovery] Resume completed for', threadId, label)
      return true
    }

    if (resumeReceivedEvent) {
      console.warn('[Recovery] Buffer resume produced no visible content:', label)
    }
    return false
  }

  const recoveredFromResponseId = await tryResumeBuffer({
    responseId,
    threadId,
    fromSeq,
    minCreatedAt: responseId ? undefined : minCreatedAt,
  }, responseId ? 'response id' : 'thread')
  if (recoveredFromResponseId) return 'recovered'

  if (responseId) {
    // A stale assistant slot can point at a newer failed/empty retry. Fall back
    // to the best thread-level buffer; it may be an older partial response with
    // real text or tool activity that should be shown instead.
    useChatStore.getState().setStreaming(threadId, true)
    const recoveredFromThread = await tryResumeBuffer({ threadId, fromSeq: 0, minCreatedAt }, 'thread fallback')
    if (recoveredFromThread) return 'recovered'
  }

  if (assistantId) {
    useChatStore.getState().setStreaming(threadId, false)
  }

  // 2) OpenClaw suspend/resume fallback: a yielded turn may complete later
  // outside Clavus's response buffer. Fetching server messages runs the
  // server-side OpenClaw session-tail reconciler before returning.
  const refreshedSessionTail = await refreshThreadMessages(threadId).catch(() => false)
  if (refreshedSessionTail) {
    const freshStore = useChatStore.getState()
    const freshMessages = freshStore.getThreadState(threadId).messages
    const recoveredTail = [...freshMessages].reverse().find((m) =>
      m.role === 'assistant'
      && (m.meta === 'openclaw-session-recovery' || m.meta === 'openclaw-announce')
      && m.content.trim()
      && (minCreatedAt == null || m.timestamp >= minCreatedAt))
    if (recoveredTail) {
      const staleSlot = assistantId ? freshMessages.find((m) => m.id === assistantId) : null
      if (staleSlot && staleSlot.id !== recoveredTail.id && !staleSlot.content.trim()) {
        freshStore.removeMessage(threadId, staleSlot.id)
      }
      freshStore.setStreaming(threadId, false)
      drainQueuedAfterRecoveredResponse(threadId)
      console.log('[Recovery] Response recovered via OpenClaw session tail for thread', threadId, recoveredTail.backendResponseId)
      return 'recovered'
    }
  }

  // 3) Legacy fallback: backend-store-only recovery when the selected backend supports it.
  const recovered = await recoverResponse(threadId, getConfig())
  if (!recovered) {
    console.log('[Recovery] No backend response found for', threadId)
    // If neither path produced content, remove empty shells but preserve slots
    // with tool/media evidence for later diagnostics.
    const staleSlot = assistantId
      ? useChatStore.getState().getThreadState(threadId).messages.find((m) => m.id === assistantId)
      : null
    if (assistantId && (createdSlot || isDisposableEmptyAssistant(staleSlot))) {
      useChatStore.getState().removeMessage(threadId, assistantId)
    }
    markRecoveryResolved(threadId)
    return 'no-buffer'
  }

  // Dedup: if our assistant slot already references this responseId, do nothing.
  if (recovered.responseId) {
    const existing = useChatStore.getState().getThreadState(threadId).messages
      .find(m => (m.backendResponseId ?? m.hermesResponseId) === recovered.responseId && m.content)
    if (existing) {
      console.log('[Recovery] Already have this response, skipping')
      useChatStore.getState().setStreaming(threadId, false)
      drainQueuedAfterRecoveredResponse(threadId)
      markRecoveryResolved(threadId)
      return 'skipped'
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

    freshStore.setStreaming(threadId, false)
    drainQueuedAfterRecoveredResponse(threadId)
    console.log('[Recovery] Response recovered via backend store for thread', threadId, recovered.responseId)
    return 'recovered'
  }

  // Recovered but neither completed nor with text — drop empty shells but keep
  // tool/media evidence for diagnostics.
  const staleSlot = assistantId
    ? useChatStore.getState().getThreadState(threadId).messages.find((m) => m.id === assistantId)
    : null
  if (assistantId && (createdSlot || isDisposableEmptyAssistant(staleSlot))) {
    useChatStore.getState().removeMessage(threadId, assistantId)
  }
  markRecoveryResolved(threadId)
  console.log('[Recovery] Cannot recover — status:', recovered.status, 'text:', recovered.text?.length || 0)
  return 'no-buffer'
}

/** Last user message in the thread, or null if the last message isn't from the user.
 *  Used to drive auto-resend after recovery comes up empty. */
function pendingUserMessage(threadId: string): Message | null {
  const ts = useChatStore.getState().getThreadState(threadId)
  const last = ts.messages[ts.messages.length - 1]
  return last && last.role === 'user' ? last : null
}

function maybeAutoRetry(threadId: string, result: RecoveryResult) {
  if (result !== 'no-buffer') return
  if (!autoRetryHandler) return
  if (autoRetriedThreads.has(threadId)) return
  // Any surface streamed this thread within the last two minutes — the
  // answer exists (or is on its way) even if our list hasn't synced yet.
  // Ghost-resending here is how duplicate answers were born.
  if (recentStreamActivity(threadId, 120_000)) return
  const pending = pendingUserMessage(threadId)
  if (!pending) return
  autoRetriedThreads.add(threadId)
  console.log('[Recovery] Auto-resending unanswered user message for', threadId)
  autoRetryHandler(threadId, pending.content, pending.images, pending.attachments)
}

function drainQueuedAfterRecoveredResponse(threadId: string) {
  if (!drainQueuedHandler) return
  const store = useChatStore.getState()
  const ts = store.getThreadState(threadId)
  if (ts.isStreaming || !ts.queuedMessage) return
  const queued = store.pullQueuedMessage(threadId)
  if (!queued) return
  drainQueuedHandler(threadId, queued.content, queued.images, queued.files)
}

/** Check threads that might need recovery (e.g., on startup).
 *  Only checks non-archived threads to avoid flooding with requests,
 *  and processes them sequentially with a small delay between each. */
export function checkAllThreadsRecovery() {
  const threads = useThreadsStore.getState().threads.filter(t => !t.archived)
  // Cap at 5 most-recent threads to avoid a recovery storm
  const candidates = threads.filter(t => needsRecovery(t.id)).slice(0, 5)
  if (candidates.length === 0) return

  let i = 0
  const processNext = () => {
    if (i >= candidates.length) return
    const thread = candidates[i++]
    // Pull the latest messages first — the "missing" answer may simply have
    // been produced by the other surface / another device and not synced yet.
    refreshThreadMessages(thread.id).catch(() => false).then(() => {
      if (!needsRecovery(thread.id)) {
        drainQueuedAfterRecoveredResponse(thread.id)
        setTimeout(processNext, 150)
        return
      }
      console.log('[Recovery] Thread needs recovery:', thread.id)
      attemptRecovery(thread.id).then((result) => {
        maybeAutoRetry(thread.id, result)
      }).finally(() => {
        // Stagger recovery attempts to avoid main-thread congestion
        setTimeout(processNext, 300)
      })
    })
  }
  processNext()
}

export function useResponseRecovery(options: { onAutoRetry?: AutoRetryCallback; onDrainQueued?: AutoRetryCallback } = {}) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stash the callback at module scope so the module-level attemptRecovery
  // path (called from startup `checkAllThreadsRecovery`) can reach it.
  useEffect(() => {
    autoRetryHandler = options.onAutoRetry ?? null
    drainQueuedHandler = options.onDrainQueued ?? null
    return () => {
      if (autoRetryHandler === options.onAutoRetry) autoRetryHandler = null
      if (drainQueuedHandler === options.onDrainQueued) drainQueuedHandler = null
    }
  }, [options.onAutoRetry, options.onDrainQueued])

  const checkRecovery = useCallback((threadId: string) => {
    if (!threadId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (!needsRecovery(threadId)) return
      // Sync first — the answer may exist on the server already (streamed by
      // the other surface or another device) and just not be in OUR list.
      refreshThreadMessages(threadId).catch(() => false).then(() => {
        if (needsRecovery(threadId)) {
          console.log('[Recovery] Thread needs recovery:', threadId)
          attemptRecovery(threadId).then((result) => {
            maybeAutoRetry(threadId, result)
          })
        } else {
          drainQueuedAfterRecoveredResponse(threadId)
        }
      })
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
