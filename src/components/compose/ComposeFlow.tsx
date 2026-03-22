import { useState, useEffect, useCallback, useRef } from 'react'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'
import { getConfig } from '../../gateway/config'

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
  const closingRef = useRef(false)
  const startedRef = useRef(false)
  const transcriptionProcessedRef = useRef(false)

  const voice = useVoiceRecorder({
    onTranscription: (text) => {
      // Prevent duplicate processing from StrictMode double-mount
      if (transcriptionProcessedRef.current) return
      transcriptionProcessedRef.current = true
      setTranscription(text)
      setComposeState('composing')
    },
    silenceAutoStop: true,
  })

  // Auto-start recording on mount (guarded against StrictMode double-mount)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    voice.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track voice state
  useEffect(() => {
    if (voice.state === 'transcribing') {
      setComposeState('transcribing')
    }
  }, [voice.state])

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
        const res = await fetch(`${gwConfig.url}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${gwConfig.token}`,
            'x-openclaw-agent-id': gwConfig.agentId,
          },
          body: JSON.stringify({
            model: `openclaw:${gwConfig.agentId}`,
            stream: false,
            messages: [
              { role: 'system', content: config.prompt },
              { role: 'user', content: transcription },
            ],
            max_tokens: 2000,
          }),
          signal: abortController.signal,
        })

        if (!res.ok) throw new Error(`Failed: ${res.status}`)
        const data = await res.json()
        const text = data.choices?.[0]?.message?.content?.trim()
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
  }, [composeState, transcription, config.prompt])

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
      setToast('Copied!')
      navigator.vibrate?.(10)
    } catch {
      setToast('Copy failed')
    }
  }, [composedText])

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
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-dark/95 backdrop-blur-xl animate-[fadeSlideIn_0.2s_ease-out]">
      {/* Header */}
      <div className="safe-area-top bg-transparent" />
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={handleClose}
          className="inline-btn p-2 rounded-xl text-text-dark-muted hover:text-text-dark transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${config.bgClass} flex items-center justify-center`}>
            {channel === 'messaging' && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
            {channel === 'slack' && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="3" height="8" x="13" y="2" rx="1.5"/><path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5"/></svg>}
            {channel === 'email' && <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>}
          </div>
          <span className="text-sm font-medium text-text-dark">{config.label}</span>
        </div>
        <div className="w-10" /> {/* Spacer for centering */}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
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
                    className={`w-[4px] rounded-full bg-gradient-to-t ${config.bgClass} transition-all duration-75 ease-out`}
                    style={{ height: `${Math.max(4, val * 60)}px`, opacity: 0.6 + val * 0.4 }}
                  />
                )
              })}
            </div>
            <p className="text-sm text-text-dark-muted">Speak your message...</p>
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
            <div
              onClick={handleCopy}
              className="rounded-2xl bg-surface-dark-2 border border-surface-dark-3/50 p-4 cursor-pointer hover:bg-surface-dark-3/50 active:scale-[0.98] transition-all"
            >
              <p className="text-sm text-text-dark whitespace-pre-wrap leading-relaxed select-text">{composedText}</p>
            </div>
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={handleCopy}
                className="inline-btn flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover active:scale-95 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                Copy
              </button>
              <button
                onClick={handleClose}
                className="inline-btn px-4 py-2 rounded-xl text-text-dark-muted text-sm font-medium hover:text-text-dark hover:bg-surface-dark-2 transition-all"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {composeState === 'error' && (
          <div className="flex flex-col items-center gap-4 animate-[fadeSlideIn_0.3s_ease-out]">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={handleClose}
              className="inline-btn px-4 py-2 rounded-xl text-text-dark-muted text-sm hover:text-text-dark transition-colors"
            >
              Close
            </button>
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
