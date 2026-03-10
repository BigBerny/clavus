import { useState, useRef, useCallback, useEffect } from 'react'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'

interface Props {
  onSend: (message: string) => void
  onAbort: () => void
  isStreaming: boolean
  onRecordingChange?: (recording: boolean, duration: string, cancel: () => void) => void
}

export function InputBar({ onSend, onAbort, isStreaming, onRecordingChange }: Props) {
  const [value, setValue] = useState('')
  const [sendAnim, setSendAnim] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const voice = useVoiceRecorder({
    onTranscription: (text) => {
      setValue((prev) => (prev ? prev + ' ' + text : text))
      setTimeout(() => textareaRef.current?.focus(), 50)
    },
  })

  // Report recording state changes to parent (for header recording bar)
  useEffect(() => {
    onRecordingChange?.(voice.state === 'recording', voice.formattedDuration, voice.cancel)
  }, [voice.state, voice.formattedDuration, voice.cancel, onRecordingChange])

  // Listen for suggestion clicks from empty state
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail
      if (text && typeof text === 'string') {
        onSend(text)
      }
    }
    window.addEventListener('clavus:send', handler)
    return () => window.removeEventListener('clavus:send', handler)
  }, [onSend])

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [])

  useEffect(() => {
    adjustHeight()
  }, [value, adjustHeight])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    setSendAnim(true)
    setTimeout(() => setSendAnim(false), 300)
    onSend(trimmed.slice(0, 10000))
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [value, isStreaming, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  // Tap-to-toggle: simple tap to start/stop recording
  const handleMicClick = useCallback(() => {
    if (voice.state === 'recording') {
      voice.stop()
    } else if (voice.state === 'idle') {
      voice.start()
    }
  }, [voice])

  const isRecording = voice.state === 'recording'
  const isTranscribing = voice.state === 'transcribing'
  const hasText = value.trim().length > 0

  return (
    <div className="border-t border-surface-light-3/50 dark:border-surface-dark-3/50 shadow-[0_-1px_3px_rgba(0,0,0,0.05)] dark:shadow-[0_-1px_3px_rgba(0,0,0,0.2)] bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur-xl safe-area-bottom">
      <div className="max-w-3xl mx-auto px-3 py-2.5">
        {/* Voice error */}
        {voice.error && (
          <div className="text-red-400 text-xs mb-2 text-center animate-[fadeSlideIn_0.2s_ease-out]" role="alert">{voice.error}</div>
        )}

        {/* Transcribing state */}
        {isTranscribing && (
          <div className="flex items-center justify-center mb-2 gap-2 animate-[fadeSlideIn_0.2s_ease-out]" role="status">
            <div className="voice-spinner" />
            <span className="text-xs text-text-light-muted dark:text-text-dark-muted">Transcribing...</span>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isRecording ? 'Recording... tap mic to stop' : 'Message...'}
            rows={1}
            disabled={isTranscribing}
            aria-label="Chat message input"
            maxLength={10000}
            className={`flex-1 resize-none rounded-2xl px-4 py-2.5 bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted/60 dark:placeholder:text-text-dark-muted/60 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50 transition-all ${
              isRecording ? 'ring-2 ring-red-500/40' : ''
            }`}
          />

          <div className="relative flex-none w-10 h-10">
            {isStreaming ? (
              <button
                onClick={onAbort}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all shadow-lg shadow-red-500/25 animate-[btnFadeIn_0.15s_ease-out]"
                aria-label="Stop generating"
                title="Stop"
              >
                <StopIcon />
              </button>
            ) : isRecording ? (
              <button
                onClick={voice.stop}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all voice-pulse animate-[btnFadeIn_0.15s_ease-out]"
                aria-label="Stop recording and transcribe"
                title="Stop recording"
              >
                <MicIcon />
              </button>
            ) : isTranscribing ? (
              <button
                disabled
                className="absolute inset-0 flex items-center justify-center rounded-full bg-surface-light-3 dark:bg-surface-dark-3 text-text-light-muted dark:text-text-dark-muted opacity-50 cursor-not-allowed"
                aria-label="Transcribing audio"
                title="Transcribing"
              >
                <MicIcon />
              </button>
            ) : hasText ? (
              <button
                onClick={handleSubmit}
                disabled={!value.trim()}
                className={`absolute inset-0 flex items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-accent/25 animate-[btnFadeIn_0.15s_ease-out] ${sendAnim ? 'animate-[sendPulse_0.3s_ease-out]' : ''}`}
                aria-label="Send message"
                title="Send"
              >
                <SendIcon />
              </button>
            ) : (
              <button
                onClick={handleMicClick}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-surface-light-2 dark:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted hover:bg-accent hover:text-white active:scale-95 transition-all animate-[btnFadeIn_0.15s_ease-out]"
                aria-label="Start voice input (tap to toggle)"
                title="Voice input"
              >
                <MicIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MicIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
  )
}

function SendIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14"/>
      <path d="m12 5 7 7-7 7"/>
    </svg>
  )
}

function StopIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  )
}
