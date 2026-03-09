import { useState, useRef, useCallback, useEffect } from 'react'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'

interface Props {
  onSend: (message: string) => void
  onAbort: () => void
  isStreaming: boolean
}

const HOLD_THRESHOLD_MS = 300

export function InputBar({ onSend, onAbort, isStreaming }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isHoldingRef = useRef(false)

  const voice = useVoiceRecorder({
    onTranscription: (text) => {
      setValue((prev) => (prev ? prev + ' ' + text : text))
      setTimeout(() => textareaRef.current?.focus(), 50)
    },
  })

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

  // Hold-to-record: pointer down starts timer, if held long enough it's hold mode
  const handleMicPointerDown = useCallback(() => {
    if (voice.state !== 'idle') return
    isHoldingRef.current = false
    holdTimerRef.current = setTimeout(() => {
      isHoldingRef.current = true
      voice.start()
    }, HOLD_THRESHOLD_MS)
  }, [voice])

  const handleMicPointerUp = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (isHoldingRef.current && voice.state === 'recording') {
      // Release after hold -> stop & transcribe
      voice.stop()
      isHoldingRef.current = false
    }
  }, [voice])

  // Tap-to-toggle: quick tap (no hold)
  const handleMicClick = useCallback(() => {
    if (isHoldingRef.current) return // was a hold, not a tap
    if (voice.state === 'recording') {
      voice.stop()
    } else if (voice.state === 'idle') {
      voice.start()
    }
  }, [voice])

  // Cleanup hold timer on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    }
  }, [])

  const isRecording = voice.state === 'recording'
  const isTranscribing = voice.state === 'transcribing'
  const hasText = value.trim().length > 0

  return (
    <div className="border-t border-surface-light-3/50 dark:border-surface-dark-3/50 bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur-xl safe-area-bottom">
      <div className="max-w-3xl mx-auto px-3 py-2.5">
        {/* Voice error */}
        {voice.error && (
          <div className="text-red-400 text-xs mb-2 text-center animate-[fadeSlideIn_0.2s_ease-out]" role="alert">{voice.error}</div>
        )}

        {/* Recording overlay */}
        {isRecording && (
          <div className="flex items-center justify-between mb-2 px-1 animate-[fadeSlideIn_0.2s_ease-out]">
            <button
              onClick={voice.cancel}
              className="inline-btn text-red-400 hover:text-red-300 text-xs font-medium transition-colors px-2 py-1"
              aria-label="Cancel recording"
            >
              Cancel
            </button>
            <div className="flex items-center gap-2">
              <div className="recording-dot w-2 h-2 rounded-full bg-red-500" />
              <WaveformDisplay levels={voice.levels} />
              <span className={`text-xs font-mono tabular-nums ${voice.warning ? 'text-red-400' : 'text-text-light-muted dark:text-text-dark-muted'}`}>
                {voice.formattedDuration}
              </span>
            </div>
            <div className="w-14" />
          </div>
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
            placeholder={isRecording ? 'Recording...' : 'Message...'}
            rows={1}
            disabled={isRecording || isTranscribing}
            aria-label="Chat message input"
            maxLength={10000}
            className={`flex-1 resize-none rounded-2xl px-4 py-2.5 bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted/60 dark:placeholder:text-text-dark-muted/60 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50 transition-all ${
              isRecording ? 'ring-2 ring-red-500/40' : ''
            }`}
          />

          {isStreaming ? (
            <button
              onClick={onAbort}
              className="flex-none w-10 h-10 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all shadow-lg shadow-red-500/25"
              aria-label="Stop generating"
              title="Stop"
            >
              <StopIcon />
            </button>
          ) : isRecording ? (
            <button
              onClick={voice.stop}
              className="flex-none w-10 h-10 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all voice-pulse"
              aria-label="Stop recording"
              title="Stop recording"
            >
              <StopIcon />
            </button>
          ) : isTranscribing ? (
            <button
              disabled
              className="flex-none w-10 h-10 flex items-center justify-center rounded-full bg-surface-light-3 dark:bg-surface-dark-3 text-text-light-muted dark:text-text-dark-muted opacity-50 cursor-not-allowed"
              aria-label="Transcribing audio"
              title="Transcribing"
            >
              <MicIcon />
            </button>
          ) : hasText ? (
            <button
              onClick={handleSubmit}
              disabled={!value.trim()}
              className="flex-none w-10 h-10 flex items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-accent/25"
              aria-label="Send message"
              title="Send"
            >
              <SendIcon />
            </button>
          ) : (
            <button
              onClick={handleMicClick}
              onPointerDown={handleMicPointerDown}
              onPointerUp={handleMicPointerUp}
              onPointerLeave={handleMicPointerUp}
              className="flex-none w-10 h-10 flex items-center justify-center rounded-full bg-surface-light-2 dark:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted hover:bg-accent hover:text-white active:scale-95 transition-all"
              aria-label="Start voice input (tap or hold)"
              title="Voice input"
            >
              <MicIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function WaveformDisplay({ levels }: { levels: number[] }) {
  return (
    <div className="flex items-center gap-0.5 h-5" aria-hidden="true">
      {levels.map((level, i) => (
        <div
          key={i}
          className="w-0.5 bg-red-400 rounded-full transition-all duration-75"
          style={{ height: `${Math.max(4, level * 20)}px` }}
        />
      ))}
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
