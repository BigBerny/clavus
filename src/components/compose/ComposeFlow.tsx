import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'
import { getConfig } from '../../gateway/config'
import { sendChatCompletion } from '../../gateway/chat'
import { useModelStore } from '../../state/preset'
import { MODEL_OPTIONS } from '../../gateway/presets'
import { haptic } from '../../lib/native'
import { useThreadsStore, loadThreadMessages } from '../../state/threads'

type ComposeChannel = 'messaging' | 'slack' | 'email'

interface Props {
  channel: ComposeChannel
  onClose: () => void
}

const CHANNEL_CONFIG: Record<ComposeChannel, { label: string; color: string; bgClass: string; prompt: string }> = {
  messaging: {
    label: 'Messaging',
    color: 'emerald',
    bgClass: 'from-emerald-500 to-green-600',
    prompt: `You are a message composer. The user dictated a voice message. Rewrite it as a casual WhatsApp/Telegram message. Rules:
- Keep it casual, conversational, friendly
- Use emojis where natural (don't overdo it)
- IMPORTANT: Write in the EXACT SAME language the user dictated in. If the user spoke German, write German. If English, write English. NEVER translate to a different language.
- Don't add greetings unless the user included one
- Output ONLY the message text, nothing else`,
  },
  slack: {
    label: 'Slack',
    color: 'purple',
    bgClass: 'from-purple-500 to-fuchsia-600',
    prompt: `You are a message composer. The user dictated a voice message. Rewrite it as a semi-professional Slack message. Rules:
- Semi-professional tone, friendly but work-appropriate
- Use Slack markdown formatting where helpful (*bold*, _italic_, \`code\`, bullet lists)
- IMPORTANT: Write in the EXACT SAME language the user dictated in. If the user spoke German, write German. If English, write English. NEVER translate to a different language.
- Output ONLY the message text, nothing else`,
  },
  email: {
    label: 'E-Mail',
    color: 'blue',
    bgClass: 'from-blue-500 to-cyan-600',
    prompt: `You are an email composer. The user dictated a voice message. Rewrite it as a proper, professional email. Rules:
- Professional but warm tone
- Proper email formatting (greeting, body, sign-off)
- IMPORTANT: Write in the EXACT SAME language the user dictated in. If the user spoke German, write German. If English, write English. NEVER translate to a different language.
- If the user mentioned a recipient name, use it in the greeting
- Output ONLY the email text, nothing else`,
  },
}

type ComposeState = 'recording' | 'transcribing' | 'composing' | 'done' | 'error'

export function ComposeFlow({ channel, onClose }: Props) {
  const config = CHANNEL_CONFIG[channel]
  const [composeState, setComposeState] = useState<ComposeState>('recording')
  const [transcription, setTranscription] = useState('')
  const [composedText, setComposedText] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [copied, setCopied] = useState(false)
  const [allTranscriptions, setAllTranscriptions] = useState<string[]>([])
  const closingRef = useRef(false)
  const startedRef = useRef(false)
  const transcriptionProcessedRef = useRef(false)

  // Gather recent messages (last 24h) across all threads for context picking
  const threads = useThreadsStore((s) => s.threads)
  const recentMessages = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    const recent: { threadTitle: string; content: string; timestamp: number }[] = []
    for (const thread of threads) {
      if (thread.updatedAt < cutoff) continue
      const msgs = loadThreadMessages(thread.id)
      for (const m of msgs) {
        if (m.timestamp >= cutoff && m.role === 'assistant' && m.content.length > 10) {
          recent.push({ threadTitle: thread.title, content: m.content, timestamp: m.timestamp })
        }
      }
    }
    return recent.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20)
  }, [threads])

  const voice = useVoiceRecorder({
    onTranscription: (text) => {
      console.log('[ComposeFlow] onTranscription called, text:', text?.slice(0, 50), 'alreadyProcessed:', transcriptionProcessedRef.current)
      // Prevent duplicate processing from StrictMode double-mount
      if (transcriptionProcessedRef.current) return
      transcriptionProcessedRef.current = true
      setAllTranscriptions(prev => [...prev, text])
      setTranscription(text)
      setComposeState('composing')
    },
  })

  // Auto-start recording on mount (guarded against StrictMode double-mount)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    voice.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track voice state — guard with transcriptionProcessedRef to avoid a race
  // where this effect's setComposeState('transcribing') overwrites the
  // 'composing' state set by onTranscription in the same React batch.
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    console.log('[ComposeFlow] voice.state:', voice.state, 'composeState:', composeState, 'transcription:', !!transcription, 'voice.error:', voice.error, 'processed:', transcriptionProcessedRef.current)
    if (voice.state === 'transcribing' && !transcriptionProcessedRef.current) {
      setComposeState('transcribing')
    }
    // If voice reports an error while we're still transcribing, show it immediately
    if (voice.error && (composeState === 'transcribing' || composeState === 'recording')) {
      setError(voice.error)
      setComposeState('error')
      return
    }
    // If voice goes idle while we're still in transcribing state, wait a bit
    // then check if transcription arrived (gives React time to batch updates)
    if (voice.state === 'idle' && composeState === 'transcribing') {
      if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current)
      stuckTimerRef.current = setTimeout(() => {
        if (!transcriptionProcessedRef.current) {
          setError('No speech detected. Try again.')
          setComposeState('error')
        }
      }, 2000)
    }
    return () => { if (stuckTimerRef.current) clearTimeout(stuckTimerRef.current) }
  }, [voice.state, voice.error, composeState, transcription])
  // Also clear stuck timer when we move past transcribing
  useEffect(() => {
    if (composeState !== 'transcribing' && stuckTimerRef.current) {
      clearTimeout(stuckTimerRef.current)
      stuckTimerRef.current = null
    }
  }, [composeState])

  // When transcription arrives, send to LLM for reformulation
  const reformulatingRef = useRef(false)
  useEffect(() => {
    if (composeState !== 'composing' || !transcription) return
    if (reformulatingRef.current) return
    reformulatingRef.current = true

    const abortController = new AbortController()
    
    async function reformulate() {
      try {
        const gwConfig = getConfig()
        // Apply selected model (same as useChat.ts). OpenClaw receives this as
        // x-openclaw-model while Hermes uses it as the request model.
        const selectedModelId = useModelStore.getState().selectedModelId
        const modelOption = MODEL_OPTIONS.find((m) => m.id === selectedModelId)
        gwConfig.model = modelOption?.model ?? MODEL_OPTIONS[0].model
        // Build messages: if there are multiple recordings, include previous
        // ones as context so the LLM can refine based on all input
        const userContent = allTranscriptions.length > 1
          ? allTranscriptions.map((t, i) =>
              i === 0 ? `Original message: ${t}` : `Additional context: ${t}`
            ).join('\n\n')
          : transcription
        const text = await sendChatCompletion(
          gwConfig,
          [
            { role: 'system', content: config.prompt },
            { role: 'user', content: userContent },
          ],
          abortController.signal,
        )
        if (text) {
          setComposedText(text)
          // Auto-copy to clipboard
          try {
            await navigator.clipboard.writeText(text)
            setToast('Copied to clipboard!')
          } catch {
            setToast('Ready — tap to copy')
          }
          setComposeState('done')
        } else {
          throw new Error('No text in response')
        }
      } catch (err) {
        if (abortController.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Composition failed')
        setComposeState('error')
      }
    }

    reformulate()
    return () => abortController.abort()
  }, [composeState, transcription, allTranscriptions, config.prompt])

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(timer)
  }, [toast])

  const handleCopy = useCallback(async () => {
    if (!composedText) return
    try {
      await navigator.clipboard.writeText(composedText)
      setCopied(true)
      haptic.tap()
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setToast('Copy failed')
    }
  }, [composedText])

  const handleAddContext = useCallback(() => {
    // Reset recording state to allow a new recording
    transcriptionProcessedRef.current = false
    reformulatingRef.current = false
    setComposeState('recording')
    setCopied(false)
    setTimeout(() => voice.start(), 50)
  }, [voice])

  const handleAddMessageContext = useCallback((msgContent: string) => {
    // Add an existing message as context and re-compose
    setAllTranscriptions(prev => [...prev, `Reference message:\n${msgContent}`])
    transcriptionProcessedRef.current = false
    reformulatingRef.current = false
    setComposeState('recording')
    setCopied(false)
    // Go straight to recording so the user can say what to do with this context
    setTimeout(() => voice.start(), 50)
  }, [voice])

  const handleClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    if (voice.state === 'recording') voice.cancel()
    onClose()
  }, [voice, onClose])

  const handleStopRecording = useCallback(() => {
    if (voice.state === 'recording') {
      voice.stop()
    }
  }, [voice])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40 backdrop-blur-xl animate-[fadeSlideIn_0.2s_ease-out]">
      {/* Header */}
      <div
        className="app-overlay-header flex items-center gap-3 px-4 py-3 shrink-0"
      >
        <button
          onClick={handleClose}
          aria-label="Close"
          className="inline-btn -ml-1 w-9 h-9 rounded-full flex items-center justify-center text-text-dark-muted hover:bg-white/10 hover:text-text-dark transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <div className="w-6 h-6 rounded-md bg-surface-dark-3 flex items-center justify-center text-text-dark-muted shrink-0">
          {channel === 'messaging' && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
          {channel === 'slack' && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="3" height="8" x="13" y="2" rx="1.5"/><path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5"/></svg>}
          {channel === 'email' && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>}
        </div>
        <span className="text-[15px] font-semibold text-text-dark">{config.label}</span>
        <div className="flex-1" />
      </div>

      {/* Content */}
      <div className={`flex-1 flex flex-col items-center px-6 ${composeState === 'done' ? 'justify-start pt-8 overflow-y-auto' : 'justify-center'}`}>
        {composeState === 'recording' && (
          <div className="flex flex-col items-center gap-6 animate-[fadeSlideIn_0.3s_ease-out]">
            {/* Recording waveform */}
            <div className="flex items-center justify-center gap-[4px] h-16">
              {Array.from({ length: 20 }, (_, i) => {
                const idx = (i / 20) * (voice.levels.length - 1)
                const lo = Math.floor(idx)
                const hi = Math.min(lo + 1, voice.levels.length - 1)
                const frac = idx - lo
                const val = (voice.levels[lo] || 0) * (1 - frac) + (voice.levels[hi] || 0) * frac
                return (
                  <div
                    key={i}
                    className="w-[4px] rounded-full bg-accent transition-all duration-75 ease-out"
                    style={{ height: `${Math.max(4, val * 60)}px`, opacity: 0.6 + val * 0.4 }}
                  />
                )
              })}
            </div>
            <p className="text-sm text-text-dark-muted">
              {allTranscriptions.length > 0 ? 'Add more context...' : 'Speak your message...'}
            </p>
            <span className="text-xs font-mono tabular-nums text-text-dark-muted/60">{voice.formattedDuration}</span>
            
            {/* Stop button */}
            <button
              onClick={handleStopRecording}
              className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-500/30 hover:bg-red-600 active:scale-95 transition-all voice-pulse"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            </button>
          </div>
        )}

        {composeState === 'transcribing' && (
          <div className="flex flex-col items-center gap-4 animate-[fadeSlideIn_0.3s_ease-out]">
            <div className="voice-spinner" style={{ width: 32, height: 32, borderWidth: 2.5 }} />
            <p className="text-sm text-text-dark-muted">Transcribing...</p>
            {voice.error && (
              <p className="text-xs text-red-400 text-center max-w-[280px]">{voice.error}</p>
            )}
          </div>
        )}

        {composeState === 'composing' && (
          <div className="flex flex-col items-center gap-4 animate-[fadeSlideIn_0.3s_ease-out]">
            <div className="voice-spinner" style={{ width: 32, height: 32, borderWidth: 2.5 }} />
            <p className="text-sm text-text-dark-muted">Composing {config.label.toLowerCase()}...</p>
            {transcription && (
              <p className="text-xs text-text-dark-muted/40 text-center max-w-[280px] line-clamp-2">&ldquo;{transcription}&rdquo;</p>
            )}
          </div>
        )}

        {composeState === 'done' && composedText && (
          <div className="w-full max-w-md animate-[fadeSlideIn_0.3s_ease-out]">
            <div className="rounded-[var(--glass-radius-lg)] glass-heavy p-4">
              <p className="text-sm text-text-dark whitespace-pre-wrap leading-relaxed select-text">{composedText}</p>
            </div>
            <div className="flex items-center justify-center gap-2 mt-4">
              {/* Copy */}
              <button
                onClick={handleCopy}
                className={`inline-btn w-11 h-11 flex items-center justify-center rounded-full active:scale-95 transition-all ${
                  copied
                    ? 'text-emerald-400 bg-emerald-500/15'
                    : 'text-text-dark-muted hover:text-accent hover:bg-accent/10'
                }`}
                title="Copy"
              >
                {copied ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                )}
              </button>
              {/* Add context */}
              <button
                onClick={handleAddContext}
                className="inline-btn w-11 h-11 flex items-center justify-center rounded-full text-text-dark-muted hover:text-accent hover:bg-accent/10 active:scale-95 transition-all"
                title="Add context"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              </button>
              {/* Done */}
              <button
                onClick={handleClose}
                className="inline-btn w-11 h-11 flex items-center justify-center rounded-full text-text-dark-muted hover:text-emerald-400 hover:bg-emerald-500/10 active:scale-95 transition-all"
                title="Done"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </div>
          </div>
        )}

        {composeState === 'done' && recentMessages.length > 0 && (
          <div className="w-full max-w-md mt-6 animate-[fadeSlideIn_0.4s_ease-out]">
            <p className="text-xs text-text-dark-muted/50 mb-2 px-1">Add context from recent conversations</p>
            <div className="max-h-48 overflow-y-auto space-y-1.5 scrollbar-thin">
              {recentMessages.map((msg, i) => (
                <button
                  key={i}
                  onClick={() => handleAddMessageContext(msg.content)}
                  className="inline-btn w-full text-left rounded-xl bg-surface-dark-2/60 border border-surface-dark-3/30 px-3 py-2.5 hover:bg-surface-dark-2 active:scale-[0.98] transition-all"
                >
                  <p className="text-[11px] text-text-dark-muted/40 mb-0.5 truncate">{msg.threadTitle}</p>
                  <p className="text-xs text-text-dark-muted line-clamp-2 leading-relaxed">{msg.content}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {composeState === 'error' && (
          <div className="flex flex-col items-center gap-4 animate-[fadeSlideIn_0.3s_ease-out]">
            <p className="text-sm text-red-400 text-center max-w-[280px]">{error}</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setError('')
                  setComposeState('recording')
                  transcriptionProcessedRef.current = false
                  reformulatingRef.current = false
                  startedRef.current = false
                  // Re-trigger start
                  setTimeout(() => { startedRef.current = true; voice.start() }, 50)
                }}
                className="inline-btn px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover active:scale-95 transition-all"
              >
                Try again
              </button>
              <button
                onClick={handleClose}
                className="inline-btn px-4 py-2 rounded-xl text-text-dark-muted text-sm hover:text-text-dark transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl bg-surface-dark-2 border border-surface-dark-3/50 text-sm text-text-dark animate-[fadeSlideIn_0.2s_ease-out]">
          {toast}
        </div>
      )}
    </div>
  )
}
