import { useState, useRef, useCallback, useEffect } from 'react'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'

interface Props {
  onSend: (message: string, images?: string[]) => void
  onAbort: () => void
  isStreaming: boolean
  onRecordingChange?: (recording: boolean, duration: string, cancel: () => void) => void
}

const MAX_IMAGES = 4
const MAX_IMAGE_SIZE = 4 * 1024 * 1024 // 4MB per image

export function InputBar({ onSend, onAbort, isStreaming, onRecordingChange }: Props) {
  const [value, setValue] = useState('')
  const [sendAnim, setSendAnim] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    if (!trimmed && pendingImages.length === 0) return
    if (isStreaming) return
    setSendAnim(true)
    setTimeout(() => setSendAnim(false), 300)
    // Haptic feedback on send
    navigator.vibrate?.(10)
    onSend(trimmed.slice(0, 10000), pendingImages.length > 0 ? pendingImages : undefined)
    setValue('')
    setPendingImages([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [value, isStreaming, onSend, pendingImages])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  // Hold-to-record + tap-to-toggle hybrid
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isHoldRecording = useRef(false)

  const handleMicPointerDown = useCallback(() => {
    if (voice.state === 'recording') return // already recording (tap-toggle mode)
    if (voice.state !== 'idle') return
    isHoldRecording.current = false
    holdTimerRef.current = setTimeout(() => {
      // Long press: start hold-to-record
      isHoldRecording.current = true
      navigator.vibrate?.(20)
      voice.start()
    }, 300)
  }, [voice])

  const handleMicPointerUp = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (isHoldRecording.current && voice.state === 'recording') {
      // Release after hold → stop and transcribe
      isHoldRecording.current = false
      voice.stop()
    }
  }, [voice])

  const handleMicClick = useCallback(() => {
    if (isHoldRecording.current) return // was a hold gesture, not a tap
    navigator.vibrate?.(10)
    if (voice.state === 'recording') {
      voice.stop()
    } else if (voice.state === 'idle') {
      voice.start()
    }
  }, [voice])

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const remaining = MAX_IMAGES - pendingImages.length
    const toProcess = Array.from(files).slice(0, remaining)

    for (const file of toProcess) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_IMAGE_SIZE) continue

      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setPendingImages((prev) => {
          if (prev.length >= MAX_IMAGES) return prev
          return [...prev, dataUrl]
        })
      }
      reader.readAsDataURL(file)
    }

    // Reset input so same file can be re-selected
    e.target.value = ''
  }, [pendingImages.length])

  const removeImage = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const isRecording = voice.state === 'recording'
  const isTranscribing = voice.state === 'transcribing'
  const hasText = value.trim().length > 0
  const hasContent = hasText || pendingImages.length > 0

  return (
    <div className="border-t border-surface-light-3/40 dark:border-surface-dark-3/40 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_-2px_8px_rgba(0,0,0,0.15)] bg-surface-light/98 dark:bg-surface-dark/98 backdrop-blur-xl safe-area-bottom">
      <div className="max-w-3xl mx-auto px-3 py-2">
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

        {/* Image preview strip */}
        {pendingImages.length > 0 && (
          <div className="image-preview-strip mb-2 animate-[fadeSlideIn_0.2s_ease-out]">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-surface-light-3 dark:border-surface-dark-3">
                <img src={img} alt={`Attachment ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeImage(i)}
                  className="inline-btn absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-surface-dark/80 dark:bg-surface-dark-3/90 text-white flex items-center justify-center text-xs backdrop-blur-sm"
                  aria-label={`Remove image ${i + 1}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Attachment button */}
          <button
            onClick={handleAttachClick}
            disabled={pendingImages.length >= MAX_IMAGES || isTranscribing}
            className="inline-btn flex-none w-10 h-10 flex items-center justify-center rounded-full text-text-light-muted dark:text-text-dark-muted hover:text-accent active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Attach image"
            title="Attach image"
          >
            <PaperclipIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={handleFileChange}
            className="hidden"
            aria-hidden="true"
          />

          {isRecording ? (
            <div className="flex-1 flex items-center gap-1.5 rounded-2xl px-4 py-2.5 bg-surface-light-2 dark:bg-surface-dark-2 border border-red-500/30 h-[42px]">
              <div className="w-2 h-2 rounded-full bg-red-500 recording-pulse flex-shrink-0" />
              <div className="flex items-center gap-[2px] h-5 flex-1">
                {voice.levels.map((level, i) => (
                  <div
                    key={i}
                    className="w-[3px] rounded-full bg-red-400/80 transition-all duration-100 ease-out"
                    style={{ height: `${Math.max(3, level * 20)}px` }}
                  />
                ))}
              </div>
              <span className="text-[11px] text-text-light-muted dark:text-text-dark-muted font-mono tabular-nums flex-shrink-0">
                {voice.formattedDuration}
              </span>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              rows={1}
              disabled={isTranscribing}
              aria-label="Chat message input"
              maxLength={10000}
              className="flex-1 resize-none rounded-2xl px-4 py-2.5 bg-surface-light-2/80 dark:bg-surface-dark-2/80 border border-surface-light-3/30 dark:border-surface-dark-3/30 text-text-light dark:text-text-dark placeholder:text-text-light-muted/40 dark:placeholder:text-text-dark-muted/40 text-[15px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent/15 focus:bg-surface-light-2 dark:focus:bg-surface-dark-2 disabled:opacity-50 transition-all"
            />
          )}

          {/* Character count near limit */}
          {value.length > 9000 && (
            <span className={`self-center text-[10px] font-mono tabular-nums ${
              value.length > 9800 ? 'text-red-400' : 'text-text-light-muted/60 dark:text-text-dark-muted/60'
            }`}>
              {value.length.toLocaleString()}/10,000
            </span>
          )}

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
                onPointerUp={handleMicPointerUp}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all voice-pulse animate-[btnFadeIn_0.15s_ease-out] touch-none"
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
            ) : hasContent ? (
              <button
                onClick={handleSubmit}
                className={`absolute inset-0 flex items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover active:scale-95 transition-all shadow-lg shadow-accent/25 animate-[btnFadeIn_0.15s_ease-out] ${sendAnim ? 'animate-[sendPulse_0.3s_ease-out]' : ''}`}
                aria-label="Send message"
                title="Send"
              >
                <ArrowUpIcon />
              </button>
            ) : (
              <button
                onClick={handleMicClick}
                onPointerDown={handleMicPointerDown}
                onPointerUp={handleMicPointerUp}
                onPointerLeave={handleMicPointerUp}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-accent/15 dark:bg-accent/20 text-accent hover:bg-accent hover:text-white active:scale-95 transition-all animate-[btnFadeIn_0.15s_ease-out] touch-none"
                aria-label="Hold to record, tap to toggle"
                title="Voice input (tap or hold)"
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

function PaperclipIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
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

function ArrowUpIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5"/>
      <path d="m5 12 7-7 7 7"/>
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
