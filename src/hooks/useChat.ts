import { useCallback, useEffect, useRef } from 'react'
import { useChatStore, composeMessageText } from '../state/chat.ts'
import { useUIStore } from '../state/ui.ts'
import { sendChatStream, resumeChatStream, generateTitleViaOpenRouter, recoverResponse } from '../gateway/chat.ts'
import { useThreadsStore } from '../state/threads.ts'
import { getConfig } from '../gateway/config.ts'
import { useModelStore } from '../state/preset.ts'
import { useChatSettingsStore } from '../state/chatSettings.ts'
import { useAutoClassifyStore } from '../state/autoClassify.ts'
import { classifyMessage } from '../gateway/classify.ts'
import { MODEL_OPTIONS } from '../gateway/presets.ts'
import type { ChatCompletionMessage } from '../gateway/chat.ts'
import { buildWorkspaceMediaUrl, mediaTypeFromPath } from '../lib/media.ts'

const MAX_RETRIES = 2
const RETRY_DELAY = 1500
const MEDIA_RE = /\bMEDIA:\s*`?([^\n`]+)`?/g

function buildMediaUrl(filePath: string): string {
  return buildWorkspaceMediaUrl(filePath)
}

function extractMediaFromToolResult(result: unknown): import('../state/chat.ts').MediaAttachment[] {
  const media: import('../state/chat.ts').MediaAttachment[] = []
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '')
  for (const match of text.matchAll(MEDIA_RE)) {
    const path = match[1].trim()
    if (!path) continue
    const type = mediaTypeFromPath(path)
    media.push({ type, url: buildMediaUrl(path), title: path.split('/').pop() })
  }
  return media
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function useChat() {
  const store = useChatStore
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)
  const offlineQueueRef = useRef<{ threadId: string; content: string; images?: string[] }[]>([])
  const sendRef = useRef<((threadId: string, content: string, images?: string[], retryCount?: number) => Promise<void>) | undefined>(undefined)
  // Forward-declared so `send`'s onDone callback (created earlier) can invoke
  // the drain helper (created later) without a circular useCallback dep.
  const drainQueueIfAnyRef = useRef<((threadId: string) => void) | null>(null)

  // Online/offline detection + reconnect
  useEffect(() => {
    const handleOnline = async () => {
      setConnectionStatus('reconnecting')
      const config = getConfig()

      const ok = await import('../gateway/chat.ts').then(m => m.checkGateway(config))
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
      setStreaming,
      setAbortController,
    } = store.getState()

    const threadState = getThreadState(threadId)
    if (threadState.isStreaming) {
      // Queue instead of silently dropping. The drain on stream completion
      // will pick this up. `content` is already composed at this point —
      // callers that need editing-friendly raw storage should use
      // `useChatStore.enqueueOrAppend` directly.
      store.getState().enqueueOrAppend(threadId, { content: content.trim(), images })
      return
    }

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
      // Fire title generation immediately (async, non-blocking)
      generateTitleIfNeeded(threadId)
      // Reactivate thread if it was auto-archived
      const t = useThreadsStore.getState().threads.find(t => t.id === threadId)
      if (t?.archived) useThreadsStore.getState().unarchiveThread(threadId)

      // Auto-classify if auto mode is enabled and thread has no classification yet
      const autoStore = useAutoClassifyStore.getState()
      if (autoStore.autoEnabled && !autoStore.getClassification(threadId)) {
        const cfg = getConfig()
        if (cfg.openrouterApiKey) {
          autoStore.setPending(threadId, true)
          try {
            const result = await Promise.race([
              classifyMessage(cfg.openrouterApiKey, content.trim()),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
            ])
            if (result) autoStore.setClassification(threadId, result)
          } catch { /* fallback to manual */ }
          autoStore.setPending(threadId, false)
        }
      }
    }

    const assistantId = store.getState().addMessage(threadId, {
      role: 'assistant',
      content: '',
      streaming: true,
    })

    setStreaming(threadId, true)
    setConnectionStatus('connected')

    const config = getConfig()
    // Apply selected model (auto-classification overrides manual selection)
    const { autoEnabled, getClassification: getAutoClassification } = useAutoClassifyStore.getState()
    const autoClassification = autoEnabled ? getAutoClassification(threadId) : null
    const selectedModelId = autoClassification
      ? autoClassification.modelId
      : useModelStore.getState().selectedModelId
    const modelOption = MODEL_OPTIONS.find((m) => m.id === selectedModelId)
      ?? MODEL_OPTIONS[0] // fallback to first model when "auto" has no classification yet
    if (modelOption) {
      config.model = modelOption.model
    }

    const apiMessages: ChatCompletionMessage[] = store
      .getState()
      .getThreadState(threadId)
      .messages.filter((m) => m.role !== 'system' && !(m.role === 'assistant' && m.streaming && !m.content))
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

    const handleToolCall = (tc: import('../gateway/chat.ts').ToolCallEvent) => {
      const msg = store.getState().getThreadState(threadId).messages.find(m => m.id === assistantId)
      const existing = msg?.toolCalls || []
      const idx = existing.findIndex(t => t.id === tc.id)
      const updated = idx >= 0
        ? existing.map((t, i) => i === idx ? tc : t)
        : [...existing, tc]
      store.getState().updateToolCalls(threadId, assistantId, updated)
      if (tc.status === 'completed' && tc.result) {
        const media = extractMediaFromToolResult(tc.result)
        if (media.length > 0) {
          store.getState().addMedia(threadId, assistantId, media)
        }
      }
    }

    const streamCallbacks = {
      onThinking: (token: string) => store.getState().appendThinking(threadId, assistantId, token),
      onThinkingDone: () => store.getState().setThinkingDone(threadId, assistantId),
      onToken: (token: string) => store.getState().appendToMessage(threadId, assistantId, token),
      onToolCall: handleToolCall,
      onResponseId: (responseId: string) => {
        store.getState().setHermesResponseId(threadId, assistantId, responseId)
      },
      onSeq: (seq: number) => {
        store.getState().setLastEventSeq(threadId, assistantId, seq)
      },
      onUsage: (usage: import('../gateway/chat.ts').UsageData) => {
        store.getState().setMessageUsage(threadId, assistantId, {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        })
        // Use model from response if available, fallback to selected model
        const modelLabel = usage.model || modelOption?.shortLabel
        if (modelLabel) {
          store.getState().setMessageModel(threadId, assistantId, modelLabel)
        }
      },
      onDone: () => {
        store.getState().finalizeMessage(threadId, assistantId)
        // Fallback: set model from selection if onUsage didn't fire
        const msg = store.getState().getThreadState(threadId).messages.find(m => m.id === assistantId)
        if (!msg?.model && modelOption) {
          store.getState().setMessageModel(threadId, assistantId, modelOption.shortLabel)
        }
        store.getState().setStreaming(threadId, false)
        store.getState().setAbortController(threadId, null)
        // Drain any message the user queued while this response was streaming.
        drainQueueIfAnyRef.current?.(threadId)
      },
      onError: (error: Error) => {
        console.error(`[Chat] Stream error (onError):`, error.name, error.message, error)
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
    }

    try {
      await sendChatStream(
        config,
        apiMessages,
        streamCallbacks,
        controller.signal,
        {
          conversationId: threadId,
          reasoningEffort: autoClassification
            ? autoClassification.reasoning
            : useChatSettingsStore.getState().getEffectiveReasoning(threadId) ?? undefined,
        },
      )
    } catch (error) {
      // Ownership guard: if a newer send (e.g. via `sendNow`) has already
      // replaced our abort controller, our cleanup is stale — bail out so we
      // don't clobber the newer stream's state.
      const currentController = store.getState().getThreadState(threadId).abortController
      if (currentController !== controller && currentController !== null) {
        return
      }

      const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      console.error(`[Chat] Send failed (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, errMsg, error)

      store.getState().setAbortController(threadId, null)

      if (error instanceof Error && error.name === 'AbortError') {
        store.getState().finalizeMessage(threadId, assistantId)
        store.getState().setStreaming(threadId, false)
        // Stop button: queue stays (user wanted to stop). Do not drain.
        return
      }

      // Try to resume from the Clavus server-side event buffer first.
      const msgForResume = store.getState().getThreadState(threadId).messages.find(m => m.id === assistantId)
      const responseId = msgForResume?.hermesResponseId
      const fromSeq = typeof msgForResume?.lastEventSeq === 'number' ? msgForResume.lastEventSeq + 1 : 0

      // Re-arm streaming flag so UI shows the response is still progressing
      store.getState().setStreaming(threadId, true)
      const resumeController = new AbortController()
      store.getState().setAbortController(threadId, resumeController)
      setConnectionStatus('reconnecting')

      let resumed = false
      try {
        console.log('[Chat] Resuming from buffer', { responseId, fromSeq })
        await resumeChatStream(
          { responseId, threadId, fromSeq },
          streamCallbacks,
          resumeController.signal,
        )
        resumed = true
        setConnectionStatus('connected')
      } catch (resumeErr) {
        console.warn('[Chat] Resume failed:', resumeErr)
        // Resume itself failed — fall back to the legacy Hermes-store path
        // (good for old responses whose buffer is gone), then retry.
      }

      if (resumed) return

      store.getState().setAbortController(threadId, null)

      // Legacy fallback: maybe the response is already completed in Hermes' own store.
      const hermesState = await recoverResponse(threadId).catch(() => null)
      if (hermesState && (hermesState.status === 'completed' || hermesState.status === 'incomplete') && hermesState.text) {
        console.log('[Chat] Response already completed on Hermes, recovering text-only')
        store.getState().updateMessage(threadId, assistantId, hermesState.text)
        if (hermesState.model) store.getState().setMessageModel(threadId, assistantId, hermesState.model)
        if (hermesState.usage) store.getState().setMessageUsage(threadId, assistantId, hermesState.usage)
        if (hermesState.toolCalls && hermesState.toolCalls.length > 0) {
          store.getState().updateToolCalls(threadId, assistantId, hermesState.toolCalls)
        }
        store.getState().setHermesResponseId(threadId, assistantId, hermesState.responseId)
        store.getState().finalizeMessage(threadId, assistantId)
        store.getState().setStreaming(threadId, false)
        setConnectionStatus('connected')
        return
      }

      // Genuine failure — show error
      store.getState().finalizeMessage(threadId, assistantId)
      store.getState().setStreaming(threadId, false)

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
  }, [setConnectionStatus, store])

  useEffect(() => {
    sendRef.current = send
  }, [send])

  const abort = useCallback((threadId: string) => {
    const ts = store.getState().getThreadState(threadId)
    ts.abortController?.abort()
    store.getState().setStreaming(threadId, false)
    store.getState().setAbortController(threadId, null)
  }, [store])

  /** Drain a queued message after a stream completes normally. */
  const drainQueueIfAny = useCallback((threadId: string) => {
    const ts = store.getState().getThreadState(threadId)
    if (!ts.queuedMessage || ts.isStreaming) return
    const queued = ts.queuedMessage
    store.getState().clearQueuedMessage(threadId)
    const composed = composeMessageText(queued.content, queued.files)
    sendRef.current?.(threadId, composed, queued.images)
  }, [store])

  // Wire the drain helper into the closure used by streamCallbacks above.
  // (The `send` callback captures `drainQueueIfAny` by reference via this ref
  // pattern to avoid a circular dependency in the useCallback deps.)
  drainQueueIfAnyRef.current = drainQueueIfAny

  /** Abort the current stream and immediately send the queued message.
   *  The catch block's ownership guard prevents the aborted stream from
   *  clobbering the newer one's state. */
  const sendNow = useCallback((threadId: string) => {
    const queued = store.getState().pullQueuedMessage(threadId)
    if (!queued) return
    const ts = store.getState().getThreadState(threadId)
    ts.abortController?.abort()
    store.getState().setStreaming(threadId, false)
    store.getState().setAbortController(threadId, null)
    const composed = composeMessageText(queued.content, queued.files)
    sendRef.current?.(threadId, composed, queued.images)
  }, [store])

  return { send, abort, sendNow }
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
