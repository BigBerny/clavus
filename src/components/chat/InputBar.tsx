import { useState, useRef, useCallback, useEffect } from 'react'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder.ts'

interface Props {
  onSend: (message: string) => void
  onAbort: () => void
  isStreaming: boolean
}

export function InputBar({ onSend, onAbort, isStreaming }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const voice = useVoiceRecorder({
    onTranscription: (text) => {
      onSend(text)
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
    if (!value.trim() || isStreaming) return
    onSend(value)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
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
    <div className="border-t border-surface-light-3 dark:border-surface-dark-3 bg-surface-light dark:bg-surface-dark p-3 safe-area-bottom">
      <div className="max-w-3xl mx-auto">
        {/* Voice error */}
        {voice.error && (
          <div className="text-red-400 text-xs mb-2 text-center">{voice.error}</div>
        )}

        {/* Recording overlay */}
        {isRecording && (
          <div className="flex items-center justify-between mb-2 px-2">
            <button
              onClick={voice.cancel}
              className="text-red-400 hover:text-red-300 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <div className="flex items-center gap-2">
              <WaveformDisplay levels={voice.levels} />
              <span className={`text-xs font-mono tabular-nums ${voice.warning ? 'text-red-400' : 'text-text-dark-muted dark:text-text-dark-muted'}`}>
                {voice.formattedDuration}
              </span>
            </div>
            <div className="w-[3.5rem]" /> {/* spacer to balance cancel button */}
          </div>
        )}

        {/* Transcribing state */}
        {isTranscribing && (
          <div className="flex items-center justify-center mb-2 gap-2">
            <div className="voice-spinner" />
            <span className="text-xs text-text-dark-muted">Transcribing...</span>
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
            className={`flex-1 resize-none rounded-xl px-4 py-2.5 bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted dark:placeholder:text-text-dark-muted text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 transition-all ${
              isRecording ? 'ring-2 ring-red-500/50' : ''
            }`}
          />

          {isStreaming ? (
            <button
              onClick={onAbort}
              className="flex-none p-2.5 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors"
              title="Stop"
            >
              <StopIcon />
            </button>
          ) : isRecording ? (
            <button
              onClick={voice.stop}
              className="flex-none p-2.5 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors voice-pulse"
              title="Stop recording"
            >
              <StopIcon />
            </button>
          ) : isTranscribing ? (
            <button
              disabled
              className="flex-none p-2.5 rounded-xl bg-surface-light-3 dark:bg-surface-dark-3 text-text-light-muted dark:text-text-dark-muted opacity-50 cursor-not-allowed"
              title="Transcribing"
            >
              <MicIcon />
            </button>
          ) : hasText ? (
            <button
              onClick={handleSubmit}
              disabled={!value.trim()}
              className="flex-none p-2.5 rounded-xl bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Send"
            >
              <SendIcon />
            </button>
          ) : (
            <button
              onClick={handleMicClick}
              className="flex-none p-2.5 rounded-xl bg-surface-light-3 dark:bg-surface-dark-3 text-text-light dark:text-text-dark hover:bg-accent hover:text-white transition-colors"
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
    <div className="flex items-center gap-0.5 h-5">
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
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
  )
}

function SendIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  )
}

function StopIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  )
}
