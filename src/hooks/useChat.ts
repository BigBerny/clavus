import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '../state/chat.ts'
import { useUIStore } from '../state/ui.ts'
import { sendChatStream, generateTitleViaOpenRouter, recoverResponse } from '../gateway/chat.ts'
import { useThreadsStore } from '../state/threads.ts'
import { getConfig } from '../gateway/config.ts'
import { usePresetStore } from '../state/preset.ts'
import { useChatSettingsStore } from '../state/chatSettings.ts'
import { MODEL_PRESETS } from '../gateway/presets.ts'
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
      // Fire title generation immediately (async, non-blocking)
      generateTitleIfNeeded(threadId)
    }

    const assistantId = store.getState().addMessage(threadId, {
      role: 'assistant',
      content: '',
      streaming: true,
    })

    setStreaming(threadId, true)
    setConnectionStatus('connected')

    const config = getConfig()
    // Apply selected model preset
    const selectedPresetId = usePresetStore.getState().selectedPresetId
    const preset = MODEL_PRESETS.find((p) => p.id === selectedPresetId)
    if (preset) {
      config.model = preset.model
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

    try {
      await sendChatStream(
        config,
        apiMessages,
        {
          onThinking: (token) => store.getState().appendThinking(threadId, assistantId, token),
          onThinkingDone: () => store.getState().setThinkingDone(threadId, assistantId),
          onToken: (token) => store.getState().appendToMessage(threadId, assistantId, token),
          onToolCall: handleToolCall,
          onResponseId: (responseId) => {
            store.getState().setHermesResponseId(threadId, assistantId, responseId)
          },
          onUsage: (usage) => {
            store.getState().setMessageUsage(threadId, assistantId, {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            })
            // Use model from response if available, fallback to preset
            const modelLabel = usage.model || preset?.shortLabel
            if (modelLabel) {
              store.getState().setMessageModel(threadId, assistantId, modelLabel)
            }
          },
          onDone: () => {
            store.getState().finalizeMessage(threadId, assistantId)
            // Fallback: set model from preset if onUsage didn't fire
            const msg = store.getState().getThreadState(threadId).messages.find(m => m.id === assistantId)
            if (!msg?.model && preset) {
              store.getState().setMessageModel(threadId, assistantId, preset.shortLabel)
            }
            store.getState().setStreaming(threadId, false)
            store.getState().setAbortController(threadId, null)
          },
          onError: (error) => {
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
        },
        controller.signal,
        {
          conversationId: threadId,
          reasoningEffort:
            useChatSettingsStore.getState().getReasoningOverride(threadId) ??
            preset?.reasoningEffort,
        },
      )
    } catch (error) {
      const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      console.error(`[Chat] Send failed (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, errMsg, error)

      store.getState().setAbortController(threadId, null)

      if (error instanceof Error && error.name === 'AbortError') {
        store.getState().finalizeMessage(threadId, assistantId)
        store.getState().setStreaming(threadId, false)
        return
      }

      // Check if Hermes is still processing server-side before showing an error
      const hermesState = await recoverResponse(threadId).catch(() => null)

      if (hermesState?.status === 'in_progress') {
        // Hermes is still working — keep the streaming bubble visible
        // Poll every 3s while visible, check immediately on foreground
        console.log('[Chat] Connection lost but Hermes still processing, polling...')
        setConnectionStatus('reconnecting')

        let stopped = false

        const finishWith = (result: NonNullable<Awaited<ReturnType<typeof recoverResponse>>>) => {
          stopped = true
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('clavus:app-resume', onVisible)
          store.getState().updateMessage(threadId, assistantId, result.text)
          if (result.model) store.getState().setMessageModel(threadId, assistantId, result.model)
          if (result.usage) store.getState().setMessageUsage(threadId, assistantId, result.usage)
          store.getState().setHermesResponseId(threadId, assistantId, result.responseId)
          store.getState().finalizeMessage(threadId, assistantId)
          store.getState().setStreaming(threadId, false)
          setConnectionStatus('connected')
          console.log('[Chat] Response recovered via polling', result.responseId)
        }

        const poll = async () => {
          if (stopped) return
          const result = await recoverResponse(threadId).catch(() => null)
          if (stopped) return
          if (result?.text && (result.status === 'completed' || result.status === 'incomplete' || result.status === 'failed')) {
            finishWith(result)
          } else if (!result || result.status !== 'in_progress') {
            // Genuinely failed with no text
            stopped = true
            document.removeEventListener('visibilitychange', onVisible)
            window.removeEventListener('clavus:app-resume', onVisible)
            store.getState().finalizeMessage(threadId, assistantId)
            store.getState().setStreaming(threadId, false)
            setConnectionStatus('disconnected')
          } else if (document.visibilityState === 'visible') {
            setTimeout(poll, 3000)
          }
        }

        const onVisible = () => {
          if (document.visibilityState === 'visible' && !stopped) poll()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('clavus:app-resume', onVisible)
        poll()
        return
      }

      if (hermesState?.status === 'completed' && hermesState.text) {
        // Already completed — just use it
        console.log('[Chat] Response already completed on Hermes, recovering')
        store.getState().updateMessage(threadId, assistantId, hermesState.text)
        if (hermesState.model) store.getState().setMessageModel(threadId, assistantId, hermesState.model)
        if (hermesState.usage) store.getState().setMessageUsage(threadId, assistantId, hermesState.usage)
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
