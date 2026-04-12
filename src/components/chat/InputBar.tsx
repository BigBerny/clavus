import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'

interface Props {
  onSend: (message: string, images?: string[]) => void
  onAbort: () => void
  isStreaming: boolean
  onRecordingChange?: (recording: boolean, duration: string, cancel: () => void) => void
  isHome?: boolean
  onClear?: () => void
  talkMode?: { active: boolean; phase: string; toggle: () => void; endListening: () => void }
}

interface SlashCommand {
  command: string
  description: string
  local?: boolean
}

const MAX_IMAGES = 4
const MAX_IMAGE_SIZE = 4 * 1024 * 1024 // 4MB per image

const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/tasks', description: 'Show tasks' },
  { command: '/tasks list', description: 'List all tasks' },
  { command: '/status', description: 'Show status' },
  { command: '/model', description: 'Show/change model' },
  { command: '/clear', description: 'Clear chat', local: true },
  { command: '/help', description: 'Show help' },
]

export function InputBar({ onSend, onAbort, isStreaming, onRecordingChange, isHome, onClear, talkMode }: Props) {
  const [value, setValue] = useState('')
  const [sendAnim, setSendAnim] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [slashIndex, setSlashIndex] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const voice = useVoiceRecorder({
    onTranscription: (text) => {
      // If input already has text, append transcription to it
      const current = value.trim()
      if (current) {
        const combined = current + ' ' + text
        onSend(combined.slice(0, 10000))
        setValue('')
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
      } else {
        // Auto-send voice transcription directly
        onSend(text.slice(0, 10000))
      }
      navigator.vibrate?.(10)
    },
    onInsertTranscription: (text) => {
      // Insert text into textarea without sending
      const current = value.trim()
      const newValue = current ? current + ' ' + text : text
      setValue(newValue.slice(0, 10000))
      navigator.vibrate?.(10)
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
    const h = Math.min(el.scrollHeight, 160)
    el.style.height = `${h}px`
    // Only show scrollbar when content exceeds max height
    el.style.overflowY = el.scrollHeight > 160 ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    adjustHeight()
  }, [value, adjustHeight])

  // Image paste handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file || file.size > MAX_IMAGE_SIZE) continue
        if (pendingImages.length >= MAX_IMAGES) continue

        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          setPendingImages((prev) => {
            if (prev.length >= MAX_IMAGES) return prev
            return [...prev, dataUrl]
          })
        }
        reader.readAsDataURL(file)
        return // Only handle the first image
      }
    }
  }, [pendingImages.length])

  // Slash command filtering
  const showSlashPalette = value.startsWith('/') && !isStreaming
  const filteredCommands = useMemo(() => {
    if (!showSlashPalette) return []
    const query = value.toLowerCase()
    return SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(query))
  }, [showSlashPalette, value])

  // Reset slash index when filtered list changes
  useEffect(() => {
    setSlashIndex(0)
  }, [filteredCommands.length])

  const selectSlashCommand = useCallback((cmd: SlashCommand) => {
    if (cmd.local) {
      // Execute locally
      onClear?.()
      setValue('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } else {
      // Put command in input for user to send
      setValue(cmd.command)
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [onClear])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed && pendingImages.length === 0) return

    // Handle slash commands
    if (showSlashPalette && filteredCommands.length > 0) {
      const exact = filteredCommands.find((c) => c.command === trimmed)
      if (exact) {
        if (exact.local) {
          onClear?.()
          setValue('')
          if (textareaRef.current) textareaRef.current.style.height = 'auto'
          return
        }
        // Send as message to gateway
      }
    }

    // If streaming, abort first then send
    if (isStreaming) {
      onAbort()
    }

    setSendAnim(true)
    setTimeout(() => setSendAnim(false), 300)
    navigator.vibrate?.(10)
    onSend(trimmed.slice(0, 10000), pendingImages.length > 0 ? pendingImages : undefined)
    setValue('')
    setPendingImages([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [value, isStreaming, onSend, onAbort, pendingImages, showSlashPalette, filteredCommands, onClear])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSlashPalette && filteredCommands.length > 0) {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setSlashIndex((i) => (i > 0 ? i - 1 : filteredCommands.length - 1))
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setSlashIndex((i) => (i < filteredCommands.length - 1 ? i + 1 : 0))
          return
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault()
          selectSlashCommand(filteredCommands[slashIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setValue('')
          return
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit, showSlashPalette, filteredCommands, slashIndex, selectSlashCommand],
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
  // Drag & drop handlers (must be before any early returns to avoid hooks mismatch)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])
  const handleDragLeave = useCallback(() => setDragOver(false), [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (!files.length) return
    const remaining = MAX_IMAGES - pendingImages.length
    const toProcess = Array.from(files).slice(0, remaining)
    for (const file of toProcess) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_IMAGE_SIZE) continue
      const reader = new FileReader()
      reader.onload = () => {
        setPendingImages(prev => prev.length >= MAX_IMAGES ? prev : [...prev, reader.result as string])
      }
      reader.readAsDataURL(file)
    }
  }, [pendingImages.length])

  const hasText = value.trim().length > 0
  const hasContent = hasText || pendingImages.length > 0

  // Talk Mode: full-width overlay when active
  if (talkMode?.active) {
    const phaseLabels: Record<string, string> = {
      listening: 'Listening...',
      transcribing: 'Transcribing...',
      waiting: 'Jane is responding...',
      speaking: 'Jane is speaking...',
    }
    const phaseColors: Record<string, string> = {
      listening: 'bg-red-500',
      transcribing: 'bg-amber-500',
      waiting: 'bg-accent',
      speaking: 'bg-emerald-500',
    }
    return (
      <div className="bg-surface-light dark:bg-[#111318] border-t border-white/5 safe-area-bottom">
        <div className="max-w-[900px] mx-auto p-3">
          <div className="flex flex-col items-center gap-3 py-4">
            {/* Pulsing indicator */}
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${phaseColors[talkMode.phase] || 'bg-accent'} ${talkMode.phase === 'listening' ? 'animate-pulse' : ''}`}>
              {talkMode.phase === 'listening' && (
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              )}
              {talkMode.phase === 'transcribing' && (
                <div className="voice-spinner" style={{ width: 24, height: 24, borderWidth: 2, borderColor: 'white', borderTopColor: 'transparent' }} />
              )}
              {talkMode.phase === 'waiting' && (
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: '0s' }} />
                  <span className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: '0.2s' }} />
                  <span className="w-2 h-2 rounded-full bg-white animate-bounce" style={{ animationDelay: '0.4s' }} />
                </div>
              )}
              {talkMode.phase === 'speaking' && (
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
              )}
            </div>
            <span className="text-sm text-text-light-muted dark:text-text-dark-muted">
              {phaseLabels[talkMode.phase] || 'Talk Mode'}
            </span>
            <div className="flex gap-2">
              {talkMode.phase === 'listening' && (
                <button
                  onClick={talkMode.endListening}
                  className="inline-btn px-4 py-2 rounded-full bg-surface-light-2 dark:bg-surface-dark-2 text-sm text-text-light dark:text-text-dark active:scale-95 transition-transform"
                >
                  Done speaking
                </button>
              )}
              <button
                onClick={talkMode.toggle}
                className="inline-btn px-4 py-2 rounded-full bg-red-500/10 text-sm text-red-500 active:scale-95 transition-transform"
              >
                End Talk Mode
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`bg-surface-light dark:bg-[#111318] border-t border-white/5 safe-area-bottom relative ${dragOver ? 'ring-2 ring-accent ring-inset' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 bg-accent/10 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-sm text-accent font-medium">Drop files here</span>
        </div>
      )}
      <div className="max-w-[900px] mx-auto p-3">

        {/* Slash command palette */}
        {showSlashPalette && filteredCommands.length > 0 && (
          <div className="mb-2 rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 border border-surface-light-3/30 dark:border-surface-dark-3/30 overflow-hidden animate-[fadeSlideIn_0.2s_ease-out]" role="listbox">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.command}
                role="option"
                aria-selected={i === slashIndex}
                onClick={() => selectSlashCommand(cmd)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  i === slashIndex
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-light dark:text-text-dark hover:bg-surface-light-3/50 dark:hover:bg-surface-dark-3/50'
                }`}
              >
                <span className="text-sm font-mono font-medium">{cmd.command}</span>
                <span className="text-xs text-text-light-muted dark:text-text-dark-muted">{cmd.description}</span>
                {cmd.local && (
                  <span className="ml-auto text-[10px] text-text-light-muted/50 dark:text-text-dark-muted/50 uppercase tracking-wide">local</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Voice error */}
        {voice.error && (
          <div className="flex items-center justify-center gap-2 text-red-400 text-xs mb-2 animate-[fadeSlideIn_0.2s_ease-out] px-3 py-1.5 rounded-lg bg-red-500/8" role="alert">
            <span className="text-center">{voice.error}</span>
          </div>
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

        <div className="flex items-center gap-2">
          {/* Attachment button */}
          <button
            onClick={handleAttachClick}
            disabled={pendingImages.length >= MAX_IMAGES || isTranscribing}
            className="inline-btn flex-none w-11 h-11 flex items-center justify-center rounded-full text-text-light-muted dark:text-text-dark-muted hover:text-accent active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Attach image"
            title="Attach image"
          >
            <PaperclipIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,audio/*,video/*,.txt,.md,.json,.csv,.xml,.html"
            multiple
            onChange={handleFileChange}
            className="hidden"
            aria-hidden="true"
          />

          {isRecording ? (
            <div className="flex-1 flex items-center gap-2 rounded-2xl px-4 py-2.5 bg-surface-light-2 dark:bg-surface-dark-2 border border-red-500/30 h-[44px]">
              <div className="w-2 h-2 rounded-full bg-red-500 recording-pulse flex-shrink-0" />
              <div className="flex items-center justify-center gap-[3px] h-7 flex-1">
                {/* Interpolate 8 levels to ~20 bars for richer waveform */}
                {Array.from({ length: 20 }, (_, i) => {
                  const idx = (i / 20) * (voice.levels.length - 1)
                  const lo = Math.floor(idx)
                  const hi = Math.min(lo + 1, voice.levels.length - 1)
                  const frac = idx - lo
                  const val = (voice.levels[lo] || 0) * (1 - frac) + (voice.levels[hi] || 0) * frac
                  return (
                    <div
                      key={i}
                      className="w-[3px] rounded-full bg-red-400/80 transition-all duration-75 ease-out"
                      style={{ height: `${Math.max(3, val * 28)}px` }}
                    />
                  )
                })}
              </div>
              <span className="text-[12px] text-text-light-muted dark:text-text-dark-muted font-mono tabular-nums flex-shrink-0">
                {voice.formattedDuration}
              </span>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => {
                // Only scroll into view when inside a chat panel, not on home
                if (!isHome) {
                  setTimeout(() => {
                    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
                  }, 300)
                }
              }}
              placeholder={isHome ? "Start a new conversation..." : "Message..."}
              rows={1}
              disabled={isTranscribing}
              aria-label="Chat message input"
              maxLength={10000}
              className="flex-1 resize-none rounded-2xl px-4 py-2.5 bg-surface-light-2/80 dark:bg-surface-dark-2/80 border border-surface-light-3/30 dark:border-surface-dark-3/30 text-text-light dark:text-text-dark placeholder:text-text-light-muted/55 dark:placeholder:text-text-dark-muted/55 text-[16px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent/15 focus:bg-surface-light-2 dark:focus:bg-surface-dark-2 disabled:opacity-50 transition-all overflow-hidden"
            />
          )}

          {/* Character count near limit */}
          {value.length > 9000 && (
            <span className={`self-center text-[11px] font-mono tabular-nums ${
              value.length > 9800 ? 'text-red-400' : 'text-text-light-muted/60 dark:text-text-dark-muted/60'
            }`}>
              {value.length.toLocaleString()}/10,000
            </span>
          )}

          {isRecording ? (
            /* Two-button flow when recording: Insert + Send */
            <div className="flex items-center gap-1.5 flex-none">
              <button
                onClick={voice.stopAndInsert}
                className="w-11 h-11 flex items-center justify-center rounded-full bg-surface-light-3 dark:bg-surface-dark-3 text-text-light dark:text-text-dark hover:bg-surface-light-3/80 dark:hover:bg-surface-dark-3/80 active:scale-95 transition-all animate-[btnFadeIn_0.15s_ease-out]"
                aria-label="Stop and insert text"
                title="Insert text"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              </button>
              <button
                onClick={voice.stop}
                onPointerUp={handleMicPointerUp}
                className="w-11 h-11 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all voice-pulse animate-[btnFadeIn_0.15s_ease-out] touch-none"
                aria-label="Stop and send"
                title="Send"
              >
                <ArrowUpIcon />
              </button>
            </div>
          ) : (
          <div className="flex-none flex items-center gap-1.5">
            {isStreaming && hasContent ? (
              /* Streaming + user typed text: show stop + send */
              <>
                <button
                  onClick={onAbort}
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 active:scale-95 transition-all animate-[btnFadeIn_0.15s_ease-out]"
                  aria-label="Stop generating"
                  title="Stop"
                >
                  <StopIcon />
                </button>
                <button
                  onClick={handleSubmit}
                  className={`w-11 h-11 flex items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover active:scale-95 transition-all shadow-lg shadow-accent/25 animate-[btnFadeIn_0.15s_ease-out] ${sendAnim ? 'animate-[sendPulse_0.3s_ease-out]' : ''}`}
                  aria-label="Send message"
                  title="Send"
                >
                  <ArrowUpIcon />
                </button>
              </>
            ) : isTranscribing ? (
              <button
                disabled
                className="w-11 h-11 flex items-center justify-center rounded-full bg-surface-light-3 dark:bg-surface-dark-3 text-text-light-muted dark:text-text-dark-muted opacity-50 cursor-not-allowed"
                aria-label="Transcribing audio"
                title="Transcribing"
              >
                <MicIcon />
              </button>
            ) : hasContent ? (
              <button
                onClick={handleSubmit}
                className={`w-11 h-11 flex items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover active:scale-95 transition-all shadow-lg shadow-accent/25 animate-[btnFadeIn_0.15s_ease-out] ${sendAnim ? 'animate-[sendPulse_0.3s_ease-out]' : ''}`}
                aria-label="Send message"
                title="Send"
              >
                <ArrowUpIcon />
              </button>
            ) : isStreaming ? (
              /* Streaming with no text: show stop button in place of mic */
              <button
                onClick={onAbort}
                className="w-11 h-11 flex items-center justify-center rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 active:scale-95 transition-all animate-[btnFadeIn_0.15s_ease-out]"
                aria-label="Stop generating"
                title="Stop"
              >
                <StopIcon />
              </button>
            ) : (
              <div className="flex items-center gap-1">
                {talkMode && (
                  <button
                    onClick={talkMode.toggle}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-text-light-muted/40 dark:text-text-dark-muted/40 hover:text-accent active:scale-95 transition-all"
                    aria-label="Start Talk Mode"
                    title="Talk Mode (continuous voice conversation)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 18.5a6 6 0 0 0 6-6v-2"/><path d="M12 18.5a6 6 0 0 1-6-6v-2"/><path d="M12 18.5V22"/><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M2 10h2"/><path d="M20 10h2"/></svg>
                  </button>
                )}
                <button
                  onClick={handleMicClick}
                  onPointerDown={handleMicPointerDown}
                  onPointerUp={handleMicPointerUp}
                  onPointerLeave={handleMicPointerUp}
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-accent/15 dark:bg-accent/20 text-accent hover:bg-accent hover:text-white active:scale-95 transition-all animate-[btnFadeIn_0.15s_ease-out] touch-none"
                  aria-label="Hold to record, tap to toggle"
                  title="Voice input (tap or hold)"
                >
                  <MicIcon />
                </button>
              </div>
            )}
          </div>
          )}
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
