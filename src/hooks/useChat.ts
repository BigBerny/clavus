import { useCallback, useEffect, useRef } from 'react'
import { useChatStore, composeMessageText, type Message } from '../state/chat.ts'
import { useUIStore } from '../state/ui.ts'
import { sendChatStream, resumeChatStream, generateTitleViaOpenRouter, recoverResponse, cancelActiveResponse, isTransientLockError } from '../gateway/chat.ts'
import { useThreadsStore, MAIN_THREAD_ID } from '../state/threads.ts'
import { pushHash } from '../state/router.ts'
import { getConfig } from '../gateway/config.ts'
import { useModelStore } from '../state/preset.ts'
import { useChatSettingsStore } from '../state/chatSettings.ts'
import { useAutoClassifyStore } from '../state/autoClassify.ts'
import { classifyMessage } from '../gateway/classify.ts'
import { resolveChatRoutingSelection } from '../lib/chatRouting.ts'
import type { ChatCompletionMessage, RouteContextMessage, ClientMeta } from '../gateway/chat.ts'
import { buildWorkspaceMediaUrl, mediaTypeFromPath } from '../lib/media.ts'
import { normalizeToolCalls } from '../lib/toolCalls.ts'
import { markStreamActivity } from '../lib/streamActivity.ts'

const MAX_RETRIES = 2
const RETRY_DELAY = 1500
// Session-write-lock contention is transient but can persist for tens of
// seconds (a held lock is only reclaimed by the gateway's watchdog). Retry on
// the SAME idempotency key with exponential backoff before giving up.
const LOCK_MAX_RETRIES = 4
const LOCK_RETRY_BASE = 2000
const LOCK_RETRY_MAX = 15000
const MEDIA_RE = /\bMEDIA:\s*`?([^\n`]+)`?/g
const ROUTE_CONTEXT_LIMIT = 8
// Fork-rewind seed: how many recent turns of surviving history to carry into a
// forked branch's empty gateway session. Larger than ROUTE_CONTEXT_LIMIT since
// this is a full-history rewind, not a routing hint. Server caps to match.
const SEED_CONTEXT_LIMIT = 24

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

function quoteForRoutingCard(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''
  return trimmed.length > 700 ? `${trimmed.slice(0, 700).trim()}...` : trimmed
}

function buildBranchContextCard(messages: Message[], currentUserId?: string): string {
  const history = messages
    .filter((m) => m.role !== 'system' && m.id !== currentUserId && m.content.trim())
    .slice(-ROUTE_CONTEXT_LIMIT)
  if (history.length === 0) return ''
  const lines = history.map((m) => `${m.role === 'user' ? 'You' : 'Jane'}: ${quoteForRoutingCard(m.content)}`)
  return ['Context from Jane before this new conversation:', ...lines].join('\n\n')
}

export function useChat() {
  const store = useChatStore
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)
  const offlineQueueRef = useRef<{ threadId: string; content: string; images?: string[]; files?: import('../state/chat').PendingFile[] }[]>([])
  const sendRef = useRef<((threadId: string, content: string, images?: string[], files?: import('../state/chat').PendingFile[], retryCount?: number, idempotencyKey?: string, seedContext?: RouteContextMessage[], clientMeta?: ClientMeta) => Promise<void>) | undefined>(undefined)
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
        for (const { threadId, content, images, files } of queued) {
          sendRef.current?.(threadId, content, images, files)
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

  const send = useCallback(async (inputThreadId: string, content: string, images?: string[], files?: import('../state/chat').PendingFile[], retryCount = 0, idempotencyKey?: string, seedContext?: RouteContextMessage[], clientMeta?: ClientMeta) => {
    if (!content.trim() && (!images || images.length === 0) && (!files || files.length === 0)) return

    // Mutable: Jane's server-side router may refile this turn into a different
    // thread mid-send (see onRouted). Everything after the routing point — token
    // appends, completion, error/resume handling, retries — must target the
    // resolved thread, so the rest of this function reads `threadId`, not the arg.
    let threadId = inputThreadId
    let userMsgId: string | undefined

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
      // Logged because users have reported the UI saying not-streaming (Send
      // button visible) while this branch still fires — symptom of a desynced
      // selector vs. live store read, which we want to spot if it happens again.
      console.log('[Chat] send queued — thread already streaming', {
        threadId,
        hasAbort: !!threadState.abortController,
        messageCount: threadState.messages.length,
      })
      store.getState().enqueueOrAppend(threadId, { content: content.trim(), images, files })
      return
    }

    ensureThread(threadId)

    // If offline, queue
    if (!navigator.onLine) {
      addMessage(threadId, { role: 'user', content: content.trim(), images, attachments: files })
      addMessage(threadId, { role: 'system', content: 'You are offline. Message will be sent when connection is restored.' })
      offlineQueueRef.current.push({ threadId, content: content.trim(), images, files })
      return
    }

    if (retryCount === 0) {
      userMsgId = addMessage(threadId, { role: 'user', content: content.trim(), images, attachments: files, clientMeta })
      // Claim the streaming slot before any awaits so a concurrent recovery sweep
      // (or a second submit) doesn't see "last message is user, isStreaming=false"
      // and kick off a duplicate run. Auto-classify below can await up to 3s.
      setStreaming(threadId, true)
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
    // Apply selected model/reasoning (auto-classification overrides manual selection).
    const { autoEnabled, getClassification: getAutoClassification } = useAutoClassifyStore.getState()
    const autoClassification = autoEnabled ? getAutoClassification(threadId) : null
    const selectedModelId = useModelStore.getState().selectedModelId
    const settingsStore = useChatSettingsStore.getState()
    const { modelOption, reasoningEffort, shouldPinAutoReasoning } = resolveChatRoutingSelection({
      autoClassification,
      selectedModelId,
      manualReasoning: settingsStore.getEffectiveReasoning(threadId),
    })
    if (modelOption) {
      config.model = modelOption.model
    }

    // Auto is a Home-level default. Once a thread sends a message, pin the
    // resolved concrete model + reasoning onto the thread so later renders and
    // thread switches show the actual routing choice that was sent.
    const threadRecord = useThreadsStore.getState().threads.find((t) => t.id === threadId)
    if (modelOption && (!threadRecord?.modelId || threadRecord.modelId === 'auto')) {
      useThreadsStore.getState().updateThreadModel(threadId, modelOption.id)
      if (useModelStore.getState().selectedModelId !== modelOption.id) {
        useModelStore.getState().setSelectedModelId(modelOption.id)
      }
    }
    if (shouldPinAutoReasoning && reasoningEffort) {
      settingsStore.setReasoningOverride(threadId, reasoningEffort)
      useThreadsStore.getState().updateThreadReasoning(threadId, reasoningEffort)
    }

    const apiMessages: ChatCompletionMessage[] = store
      .getState()
      .getThreadState(threadId)
      .messages.filter((m) => m.role !== 'system' && !(m.role === 'assistant' && m.streaming && !m.content))
      .map((m) => {
        // Compose file attachment references into the text sent to the gateway
        const text = m.attachments && m.attachments.length > 0
          ? composeMessageText(m.content, m.attachments)
          : m.content
        if (m.images && m.images.length > 0) {
          const parts: ChatCompletionMessage['content'] = []
          if (text) parts.push({ type: 'text' as const, text })
          for (const img of m.images) {
            parts.push({ type: 'image_url' as const, image_url: { url: img } })
          }
          return { role: m.role, content: parts }
        }
        return { role: m.role, content: text }
      })

    // Stable per-logical-send key: generated on the first attempt, reused on
    // every retry so the gateway dedupes instead of starting a duplicate run.
    const idemKey = idempotencyKey ?? crypto.randomUUID()

    const controller = new AbortController()
    setAbortController(threadId, controller)

    const handleToolCall = (tc: import('../gateway/chat.ts').ToolCallEvent) => {
      const msg = store.getState().getThreadState(threadId).messages.find(m => m.id === assistantId)
      const existing = msg?.toolCalls || []
      const idx = existing.findIndex(t => t.id === tc.id)
      const updated = idx >= 0
        ? existing.map((t, i) => i === idx ? tc : t)
        : [...existing, tc]
      store.getState().updateToolCalls(threadId, assistantId, normalizeToolCalls(updated))
      if (tc.status === 'completed' && tc.result) {
        const media = extractMediaFromToolResult(tc.result)
        if (media.length > 0) {
          store.getState().addMedia(threadId, assistantId, media)
        }
      }
    }

    // Tell the other surface (window vs overlay share localStorage) that this
    // thread is actively streaming HERE, so its recovery sweep stands down.
    markStreamActivity(threadId)
    let lastActivityMark = Date.now()
    const markThrottled = () => {
      const now = Date.now()
      if (now - lastActivityMark > 2000) {
        lastActivityMark = now
        markStreamActivity(threadId)
      }
    }

    const streamCallbacks = {
      onThinking: (token: string) => { markThrottled(); store.getState().appendThinking(threadId, assistantId, token) },
      onThinkingDone: () => store.getState().setThinkingDone(threadId, assistantId),
      onToken: (token: string) => { markThrottled(); store.getState().appendToMessage(threadId, assistantId, token) },
      onToolCall: handleToolCall,
      onWorkspaceContext: (files: import('../gateway/chat.ts').WorkspaceFileEvent[]) => {
        // Trova ran the Mode 1 pre-pass for THIS turn — attach the matched notes to the
        // user message that triggered it (the most recent user message in the thread).
        // A turn can emit this more than once (a retry re-runs the pre-pass server-side,
        // but with an accumulating exclude set, so its result is a partial subset). Union
        // by path so the first full result is preserved and retries only add new notes.
        const msgs = store.getState().getThreadState(threadId).messages
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
        if (!lastUser) return
        const existing = lastUser.workspaceFiles ?? []
        const seen = new Set(existing.map((f) => f.path))
        const merged = [...existing, ...files.filter((f) => !seen.has(f.path))]
        store.getState().setWorkspaceFiles(threadId, lastUser.id, merged)
      },
      onRouted: ({ threadId: routed, target, title }: { threadId: string; target: string; title?: string; rationale?: string }) => {
        // Jane filed this turn into a different conversation. The user's message
        // STAYS in Main (Jane's home keeps everything addressed to her, so the
        // user can always navigate back); only the streaming answer moves into the
        // target, and Main gets a tappable breadcrumb pointing to where it landed.
        if (!routed || routed === threadId) return
        const sourceThreadId = threadId
        const sourceMessages = store.getState().getThreadState(sourceThreadId).messages
        const userContent = (userMsgId
          ? sourceMessages.find((m) => m.id === userMsgId)?.content
          : '') || content
        const threads = useThreadsStore.getState()
        if (target === 'new-branch') threads.ensureBranchThread(routed, title || 'New conversation')
        // Seed the branch so it reads coherently on its own: prior Jane context
        // (new branch only), then the user's question, then the answer (relocated
        // below). The user's question is copied — not moved — so it remains in Main.
        if (target === 'new-branch') {
          const contextCard = buildBranchContextCard(sourceMessages, userMsgId)
          if (contextCard) {
            store.getState().addMessage(routed, {
              role: 'system',
              content: contextCard,
              meta: 'branch-context',
            })
          }
        }
        if (userContent.trim()) {
          store.getState().addMessage(routed, { role: 'user', content: userContent })
        }
        store.getState().relocateMessages(sourceThreadId, routed, [assistantId].filter((x): x is string => !!x))
        store.getState().addMessage(sourceThreadId, {
          role: 'assistant',
          meta: 'routing',
          content: `Jane answered this in [${title || 'another conversation'}](clavus://thread/${routed})`,
        })
        // Hand the streaming slot from the source thread to the routed one.
        store.getState().setStreaming(sourceThreadId, false)
        store.getState().setAbortController(sourceThreadId, null)
        store.getState().setStreaming(routed, true)
        store.getState().setAbortController(routed, controller)
        markStreamActivity(routed)
        pushHash({ kind: 'chat', threadId: routed })
        threadId = routed
      },
      onResponseId: (responseId: string) => {
        store.getState().setBackendResponseId(threadId, assistantId, responseId)
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
        markStreamActivity(threadId)
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
          const content = isTransientLockError(error)
            ? 'Die Sitzung war kurz belegt. Bitte sende die Nachricht erneut.'
            : `Error: ${error.message}`
          store.getState().addMessage(threadId, { role: 'system', content })
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
          // The gateway's thinking level for "no reasoning" is "off"; our UI
          // calls it "none", which the gateway doesn't recognize (it would
          // silently fall back to the default level).
          reasoningEffort: reasoningEffort === 'none' ? 'off' : reasoningEffort,
          idempotencyKey: idemKey,
          // Opt typed Main sends into Jane's server-side router (first attempt
          // only; retries target whatever thread we already resolved to).
          route: retryCount === 0 && inputThreadId === MAIN_THREAD_ID,
          // Fork-rewind: seed a freshly forked branch's empty gateway session
          // with the prior transcript. Carried across retries via the param.
          seedContext,
          // Per-message client metadata (typed/dictated, app, dictation info).
          clientMeta,
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

      // Session-write-lock timeout: the gateway never started the turn, so
      // there's nothing to resume or recover — just re-send. Safe because the
      // stable idempotency key lets the gateway dedupe if an earlier attempt
      // did slip through. Back off so we don't hammer a still-held lock.
      if (isTransientLockError(error)) {
        store.getState().finalizeMessage(threadId, assistantId)
        store.getState().setStreaming(threadId, false)
        const lockMsg = store.getState().getThreadState(threadId).messages.find((m) => m.id === assistantId)
        if (lockMsg && !lockMsg.content) store.getState().removeMessage(threadId, assistantId)
        if (retryCount < LOCK_MAX_RETRIES) {
          setConnectionStatus('reconnecting')
          // Keep the recovery sweep from also re-sending this thread while we back off.
          markStreamActivity(threadId)
          await delay(Math.min(LOCK_RETRY_BASE * 2 ** retryCount, LOCK_RETRY_MAX))
          return sendRef.current?.(threadId, content, images, files, retryCount + 1, idemKey, seedContext, clientMeta)
        }
        setConnectionStatus('connected')
        store.getState().addMessage(threadId, {
          role: 'system',
          content: 'Die Sitzung war kurz belegt. Bitte sende die Nachricht erneut.',
        })
        return
      }

      // Try to resume from the Clavus server-side event buffer first.
      const msgForResume = store.getState().getThreadState(threadId).messages.find(m => m.id === assistantId)
      const responseId = msgForResume?.backendResponseId ?? msgForResume?.hermesResponseId
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
        // Resume itself failed — fall back to any backend-specific store path
        // (good for old responses whose buffer is gone), then retry.
      }

      if (resumed) return

      store.getState().setAbortController(threadId, null)

      // Legacy fallback: maybe the response is already completed in the backend's own store.
      const hermesState = await recoverResponse(threadId, config).catch(() => null)
      if (hermesState && (hermesState.status === 'completed' || hermesState.status === 'incomplete') && hermesState.text) {
        console.log('[Chat] Response already completed on backend, recovering text-only')
        store.getState().updateMessage(threadId, assistantId, hermesState.text)
        if (hermesState.model) store.getState().setMessageModel(threadId, assistantId, hermesState.model)
        if (hermesState.usage) store.getState().setMessageUsage(threadId, assistantId, hermesState.usage)
        if (hermesState.toolCalls && hermesState.toolCalls.length > 0) {
          store.getState().updateToolCalls(threadId, assistantId, hermesState.toolCalls)
        }
        store.getState().setBackendResponseId(threadId, assistantId, hermesState.responseId)
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
        return sendRef.current?.(threadId, content, images, files, retryCount + 1, idemKey)
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

  /** Stop the local stream AND the server-side gateway run. The proxy keeps a
   *  run alive when the client detaches (that's what recovery relies on), so
   *  only aborting the fetch leaves the agent generating — and its session
   *  context then contains an answer the user never saw. The by-thread cancel
   *  also catches orphaned runs from before a reload, when this client never
   *  learned the responseId. */
  const stopActiveRun = useCallback((threadId: string) => {
    const ts = store.getState().getThreadState(threadId)
    ts.abortController?.abort()
    store.getState().setStreaming(threadId, false)
    store.getState().setAbortController(threadId, null)
    cancelActiveResponse({ threadId })
  }, [store])

  const abort = useCallback((threadId: string) => {
    stopActiveRun(threadId)
  }, [stopActiveRun])

  /** Drain a queued message after a stream completes normally. */
  const drainQueueIfAny = useCallback((threadId: string) => {
    const ts = store.getState().getThreadState(threadId)
    if (!ts.queuedMessage || ts.isStreaming) return
    const queued = ts.queuedMessage
    store.getState().clearQueuedMessage(threadId)
    sendRef.current?.(threadId, queued.content, queued.images, queued.files)
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
    stopActiveRun(threadId)
    sendRef.current?.(threadId, queued.content, queued.images, queued.files)
  }, [store, stopActiveRun])

  /** Fork-rewind primitive — the only way to truly "go back" given the gateway
   *  keeps an append-only session server-side (it only ever receives the latest
   *  user turn and accumulates its own history; there is no truncate RPC). So a
   *  rewind spins off a fresh BRANCH thread: new threadId ⇒ new sessionKey ⇒
   *  empty gateway session, which means the dropped tail is genuinely gone
   *  model-side, not just hidden in the UI.
   *
   *  Clones the history strictly BEFORE `forkBeforeMessageId` for display, seeds
   *  the new session with that history (so it isn't cold), archives the original
   *  (except Main — the non-archivable home), and sends `newContent` as the
   *  first real turn. Returns the new threadId so the caller can switch the UI
   *  to it (null if the fork point vanished).
   *
   *  Powers edit ("rewind to this message, send edited"), regenerate ("rewind to
   *  the question, ask again"), and "ignore last". */
  const forkRewindAndSend = useCallback((
    sourceThreadId: string,
    forkBeforeMessageId: string,
    newContent: string,
    images?: string[],
    files?: import('../state/chat').PendingFile[],
  ): string | null => {
    const sourceState = store.getState().getThreadState(sourceThreadId)
    const idx = sourceState.messages.findIndex((m) => m.id === forkBeforeMessageId)
    if (idx < 0) return null

    // Everything strictly before the fork point survives as the branch's visible
    // history + gateway seed. The fork-point message and the whole tail are dropped.
    const kept = sourceState.messages.slice(0, idx)

    // Kill any in-flight run on the source first — a live stream would keep
    // writing into the now-abandoned source session.
    stopActiveRun(sourceThreadId)

    const threadsApi = useThreadsStore.getState()
    const sourceThread = threadsApi.threads.find((t) => t.id === sourceThreadId)
    const newThreadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    threadsApi.ensureBranchThread(newThreadId, sourceThread?.title || 'Conversation', sourceThreadId)

    // Clone surviving history for display (fresh ids so the threads don't share
    // message objects; index in the id avoids same-millisecond collisions).
    const stamp = Date.now()
    const clonedHistory: Message[] = kept.map((m, i) => ({
      ...m,
      id: `msg-${stamp}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      streaming: false,
    }))
    store.getState().setThreadMessages(newThreadId, clonedHistory)

    // Seed the empty gateway session with the surviving transcript (text only).
    const seedContext: RouteContextMessage[] = kept
      .filter((m): m is Message & { role: 'user' | 'assistant' } =>
        (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
      .slice(-SEED_CONTEXT_LIMIT)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2500) }))

    // Archive the original so the rewind "replaces" it. Never Main — it's the
    // persistent home thread and not archivable.
    if (sourceThreadId !== MAIN_THREAD_ID) threadsApi.archiveThread(sourceThreadId)

    sendRef.current?.(newThreadId, newContent, images, files, 0, undefined, seedContext)
    return newThreadId
  }, [store, stopActiveRun])

  /** Regenerate: rewind to the question that produced `assistantMessageId` and
   *  ask it again in a fresh branch session. Returns the new threadId. */
  const regenerate = useCallback((threadId: string, assistantMessageId: string): string | null => {
    const messages = store.getState().getThreadState(threadId).messages
    const targetIdx = messages.findIndex((m) => m.id === assistantMessageId)
    if (targetIdx < 0) return null

    let userMsg: Message | null = null
    for (let i = targetIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { userMsg = messages[i]; break }
    }
    if (!userMsg) return null

    return forkRewindAndSend(threadId, userMsg.id, userMsg.content, userMsg.images, userMsg.attachments)
  }, [store, forkRewindAndSend])

  /** Edit a user message: rewind to it and send the edited text with the
   *  original attachments as the first turn of a fresh branch session (so the
   *  model never sees the original text). Returns the new threadId. */
  const editAndResend = useCallback((threadId: string, messageId: string, newContent: string): string | null => {
    const original = store.getState().getThreadState(threadId).messages.find((m) => m.id === messageId)
    return forkRewindAndSend(threadId, messageId, newContent, original?.images, original?.attachments)
  }, [store, forkRewindAndSend])

  return { send, abort, sendNow, regenerate, editAndResend, forkRewindAndSend }
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
