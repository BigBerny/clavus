import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import mammoth from 'mammoth'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'
import { haptic, isNative } from '../../lib/native'
import { useModelStore } from '../../state/preset'
import { useChatSettingsStore } from '../../state/chatSettings'
import { useAutoClassifyStore } from '../../state/autoClassify'
import { MODEL_OPTIONS } from '../../gateway/presets'
import { listAllWorkspaceFiles, searchWorkspaceFiles } from '../../lib/workspaceApi'
import { useThreadsStore } from '../../state/threads'
import { useDraftsStore } from '../../state/drafts'
import { VoiceInputPill } from '../voice/VoiceInputPill'
import StatusModal from './StatusModal'
import {
  SLASH_COMMANDS,
  filterSlashCommands,
  tryRunSlashCommand,
  syncReasoningToHermes,
  type SlashCommand,
} from '../../lib/slashCommands'

interface Props {
  onSend: (message: string, images?: string[]) => void
  onAbort: () => void
  isStreaming: boolean
  onRecordingChange?: (recording: boolean, duration: string, cancel: () => void) => void
  isHome?: boolean
  onFocusInput?: () => void
  onClear?: () => void
  /** Currently visible thread id, or null when on the home screen. */
  threadId?: string | null
  /** Resend the last user message in this thread (used by /retry). */
  onRetry?: () => void
  talkMode?: { active: boolean; phase: string; toggle: () => void; endListening: () => void; interrupt: () => void }
  /** Stable key for draft persistence — e.g. 'home', a thread id, or a doc path. */
  draftKey?: string
}

const MAX_IMAGES = 4
const MAX_IMAGE_SIZE = 4 * 1024 * 1024 // 4MB per image
const MAX_FILES = 5
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB per file

interface PendingFile {
  name: string
  content: string
  size: number
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv', '.xml', '.html', '.js', '.ts', '.jsx', '.tsx', '.py', '.css', '.yml', '.yaml', '.toml', '.svg', '.sh', '.env', '.log'])

function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  if (file.type === 'application/json' || file.type === 'application/xml') return true
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

function isDocxFile(file: File): boolean {
  return file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.toLowerCase().endsWith('.docx')
}

export function InputBar({ onSend, onAbort, isStreaming, onRecordingChange, isHome, onFocusInput, onClear, threadId, onRetry, talkMode, draftKey }: Props) {
  // Initialize with the persisted draft for this column (or empty if none).
  const [value, setValue] = useState(() => (draftKey ? useDraftsStore.getState().getDraft(draftKey) : ''))

  // When the column (draftKey) changes — e.g. user swipes between conversations —
  // first flush whatever is currently in the textarea to the OLD draft key, then
  // swap the textarea's content to the NEW key's draft. This way each column
  // truly behaves like its own input field.
  const lastDraftKey = useRef<string | undefined>(draftKey)
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])
  useEffect(() => {
    if (lastDraftKey.current === draftKey) return
    // Flush the in-flight edit to the previous key before swapping.
    if (lastDraftKey.current !== undefined) {
      useDraftsStore.getState().setDraft(lastDraftKey.current, valueRef.current)
    }
    lastDraftKey.current = draftKey
    setValue(draftKey ? useDraftsStore.getState().getDraft(draftKey) : '')
  }, [draftKey])

  // Persist edits whenever the draftKey is set (debounced inside the store)
  useEffect(() => {
    if (!draftKey) return
    useDraftsStore.getState().setDraft(draftKey, value)
  }, [value, draftKey])
  const [sendAnim, setSendAnim] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [slashIndex, setSlashIndex] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [menuState, setMenuState] = useState<'closed' | 'open' | 'closing'>('closed')
  // @-mention palette state
  const [atQuery, setAtQuery] = useState<string | null>(null) // null = closed
  const [atIndex, setAtIndex] = useState(0)
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([])

  // Lazy-load workspace file index when the user first types @
  useEffect(() => {
    if (atQuery !== null && workspaceFiles.length === 0) {
      listAllWorkspaceFiles().then(setWorkspaceFiles)
    }
  }, [atQuery, workspaceFiles.length])

  const atMatches = useMemo(() => {
    if (atQuery === null) return []
    return searchWorkspaceFiles(atQuery, workspaceFiles)
  }, [atQuery, workspaceFiles])

  const detectAtTrigger = useCallback((text: string, caret: number) => {
    const before = text.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at === -1) { setAtQuery(null); return }
    const segment = before.slice(at + 1)
    if (/[\s\n]/.test(segment)) { setAtQuery(null); return }
    const charBefore = at === 0 ? ' ' : before[at - 1]
    if (!/\s/.test(charBefore)) { setAtQuery(null); return }
    setAtQuery(segment)
    setAtIndex(0)
  }, [])

  const insertAtMention = useCallback((path: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const caret = ta.selectionStart
    const before = value.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at === -1) return
    // Insert as a markdown link the RichMessageRenderer will detect as a FileLinkCard.
    // Uses the unified `#/file/<encodedPath>` deep-link format so the same URL
    // works inside Clavus (renders as a card, opens a column) and outside (in
    // Telegram, email, bookmarks — opens Clavus and lands on the file).
    const filename = path.split('/').pop() || path
    const trimmed = path.startsWith('/') ? path.slice(1) : path
    const link = `[${filename}](${window.location.origin}/#/file/${encodeURIComponent(trimmed)}) `
    const next = value.slice(0, at) + link + value.slice(caret)
    setValue(next.slice(0, 10000))
    setAtQuery(null)
    // Record the linked doc on the active thread immediately
    if (threadId) {
      useThreadsStore.getState().addLinkedDoc(threadId, { path, title: filename })
    }
    requestAnimationFrame(() => {
      ta.focus()
      const pos = at + link.length
      ta.setSelectionRange(pos, pos)
    })
  }, [value, threadId])
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)

  const toggleMenu = useCallback(() => {
    setMenuState((s) => s === 'open' ? 'closing' : 'open')
  }, [])

  const closeMenu = useCallback(() => {
    setMenuState('closing')
  }, [])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // Publish InputBar height as a CSS variable so scroll containers can add
  // matching bottom padding (the bar now floats over content).
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      document.documentElement.style.setProperty('--input-bar-h', `${h}px`)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--input-bar-h')
    }
  }, [])

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
      haptic.tap()
    },
    onInsertTranscription: (text) => {
      // Insert text into textarea without sending
      const current = value.trim()
      const newValue = current ? current + ' ' + text : text
      setValue(newValue.slice(0, 10000))
      haptic.tap()
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

  // Toast (slash command feedback)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2500)
  }, [])

  // Help overlay
  const [helpOpen, setHelpOpen] = useState(false)
  // Status modal
  const [statusOpen, setStatusOpen] = useState(false)

  // Slash command palette
  const showSlashPalette = value.startsWith('/') && !isStreaming
  const filteredCommands = useMemo(() => {
    if (!showSlashPalette) return []
    return filterSlashCommands(value.toLowerCase())
  }, [showSlashPalette, value])

  // Reset slash index when filtered list changes
  useEffect(() => {
    setSlashIndex(0)
  }, [filteredCommands.length])

  const selectSlashCommand = useCallback((cmd: SlashCommand) => {
    // Tab-complete: put the command into the input so the user can append args.
    // For commands that take args, append a trailing space.
    const needsArgs = !!cmd.arg
    setValue(needsArgs ? `${cmd.command} ` : cmd.command)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [])

  /** Execute a slash command via the interpreter. Returns true if handled. */
  const runSlash = useCallback(async (input: string): Promise<boolean> => {
    const result = await tryRunSlashCommand(input, {
      threadId: threadId ?? null,
      setReasoningOverride: (tid, level) => useChatSettingsStore.getState().setReasoningOverride(tid, level),
      getReasoningOverride: (tid) => useChatSettingsStore.getState().getReasoningOverride(tid),
      setModelId: (id) => useModelStore.getState().setSelectedModelId(id),
      getModelId: () => useModelStore.getState().selectedModelId,
      setGlobalReasoning: (level) => useChatSettingsStore.getState().setGlobalReasoning(level),
      clearChat: () => onClear?.(),
      regenerateLast: () => {
        if (onRetry) onRetry()
        else showToast('Retry is unavailable')
      },
      showHelp: () => setHelpOpen(true),
      showStatus: () => setStatusOpen(true),
      toast: showToast,
      syncReasoningToHermes,
    })
    return result.handled
  }, [threadId, onClear, onRetry, showToast])

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed && pendingImages.length === 0 && pendingFiles.length === 0) return

    // Try local slash command interpreter first
    if (trimmed.startsWith('/')) {
      const handled = await runSlash(trimmed)
      if (handled) {
        setValue('')
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
        return
      }
    }

    // During streaming, just queue the message (don't abort)

    // Build message text with file contents prepended
    let messageText = trimmed
    if (pendingFiles.length > 0) {
      const fileParts = pendingFiles.map(f => `<file name="${f.name}">\n${f.content}\n</file>`)
      messageText = fileParts.join('\n\n') + (trimmed ? '\n\n' + trimmed : '')
    }

    setSendAnim(true)
    setTimeout(() => setSendAnim(false), 300)
    haptic.tap()
    onSend(messageText.slice(0, 100000), pendingImages.length > 0 ? pendingImages : undefined)
    setValue('')
    setPendingImages([])
    setPendingFiles([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [value, onSend, pendingImages, pendingFiles, runSlash])

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
        if (e.key === 'Tab') {
          e.preventDefault()
          selectSlashCommand(filteredCommands[slashIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setValue('')
          return
        }
        // Enter falls through to submit — runSlash handles execution.
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
      haptic.medium()
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
    haptic.tap()
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

    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        if (pendingImages.length >= MAX_IMAGES) continue
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
      } else if (isDocxFile(file)) {
        if (pendingFiles.length >= MAX_FILES) continue
        if (file.size > MAX_FILE_SIZE) continue
        const reader = new FileReader()
        reader.onload = async () => {
          const arrayBuffer = reader.result as ArrayBuffer
          const { value: text } = await mammoth.extractRawText({ arrayBuffer })
          setPendingFiles((prev) => {
            if (prev.length >= MAX_FILES) return prev
            return [...prev, { name: file.name, content: text, size: file.size }]
          })
        }
        reader.readAsArrayBuffer(file)
      } else if (isTextFile(file)) {
        if (pendingFiles.length >= MAX_FILES) continue
        if (file.size > MAX_FILE_SIZE) continue
        const reader = new FileReader()
        reader.onload = () => {
          setPendingFiles((prev) => {
            if (prev.length >= MAX_FILES) return prev
            return [...prev, { name: file.name, content: reader.result as string, size: file.size }]
          })
        }
        reader.readAsText(file)
      }
    }

    // Reset input so same file can be re-selected
    e.target.value = ''
  }, [pendingImages.length, pendingFiles.length])

  const removeImage = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const removeFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
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
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        if (pendingImages.length >= MAX_IMAGES) continue
        if (file.size > MAX_IMAGE_SIZE) continue
        const reader = new FileReader()
        reader.onload = () => {
          setPendingImages(prev => prev.length >= MAX_IMAGES ? prev : [...prev, reader.result as string])
        }
        reader.readAsDataURL(file)
      } else if (isDocxFile(file)) {
        if (pendingFiles.length >= MAX_FILES) continue
        if (file.size > MAX_FILE_SIZE) continue
        const reader = new FileReader()
        reader.onload = async () => {
          const { value: text } = await mammoth.extractRawText({ arrayBuffer: reader.result as ArrayBuffer })
          setPendingFiles(prev => prev.length >= MAX_FILES ? prev : [...prev, { name: file.name, content: text, size: file.size }])
        }
        reader.readAsArrayBuffer(file)
      } else if (isTextFile(file)) {
        if (pendingFiles.length >= MAX_FILES) continue
        if (file.size > MAX_FILE_SIZE) continue
        const reader = new FileReader()
        reader.onload = () => {
          setPendingFiles(prev => prev.length >= MAX_FILES ? prev : [...prev, { name: file.name, content: reader.result as string, size: file.size }])
        }
        reader.readAsText(file)
      }
    }
  }, [pendingImages.length, pendingFiles.length])

  const { selectedModelId, setSelectedModelId } = useModelStore()
  const currentModel = MODEL_OPTIONS.find((m) => m.id === selectedModelId) || MODEL_OPTIONS[0]
  const autoEnabled = useAutoClassifyStore((s) => s.autoEnabled)
  const autoClassification = useAutoClassifyStore((s) => threadId ? s.classifications[threadId] ?? null : null)
  const autoPending = useAutoClassifyStore((s) => threadId ? s.pending[threadId] ?? false : false)

  const menuVisible = menuState !== 'closed'

  // Close menu on outside click
  useEffect(() => {
    if (menuState !== 'open') return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current && !menuRef.current.contains(t) && !menuBtnRef.current?.contains(t)) closeMenu()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuState, closeMenu])

  const hasText = value.trim().length > 0
  const hasContent = hasText || pendingImages.length > 0 || pendingFiles.length > 0

  // Talk Mode: full-width overlay when active.
  // Uses the shared VoiceInputPill for visual consistency with GPT Realtime.
  if (talkMode?.active) {
    const phaseLabels: Record<string, string> = {
      listening: 'Listening…',
      transcribing: 'Transcribing…',
      waiting: 'Jane is thinking…',
      speaking: 'Jane is speaking…',
    }
    // Map Talk Mode phase → VoiceInputPill mode.
    // - listening      → 'locked'  (active recording, green pill)
    // - transcribing   → 'locked'  (still processing user audio)
    // - waiting/speaking → 'idle'  (assistant has the floor, neutral pill)
    const pillMode = (talkMode.phase === 'listening' || talkMode.phase === 'transcribing')
      ? 'locked' as const
      : 'idle' as const
    return (
      <div className="bg-surface-light dark:bg-surface-dark border-t border-border-light dark:border-border-dark safe-area-bottom">
        <div className="max-w-[900px] mx-auto p-3">
          <div className="flex flex-col items-center gap-3 py-4">
            <VoiceInputPill
              size="medium"
              mode={pillMode}
              showLockTarget={false}
              showPauseButton={false}
            />
            <span className="text-[13px] text-text-light-muted dark:text-text-dark-muted">
              {phaseLabels[talkMode.phase] || 'Talk Mode'}
            </span>
            <div className="flex gap-2">
              {talkMode.phase === 'listening' && (
                <button
                  onClick={talkMode.endListening}
                  className="inline-btn px-4 h-9 rounded-md bg-surface-light-2 dark:bg-surface-dark-3 text-[13px] font-medium text-text-light dark:text-text-dark active:scale-95 transition-transform"
                >
                  Done speaking
                </button>
              )}
              {talkMode.phase === 'speaking' && (
                <button
                  onClick={talkMode.interrupt}
                  className="inline-btn px-4 h-9 rounded-md bg-surface-light-2 dark:bg-surface-dark-3 text-[13px] font-medium text-text-light dark:text-text-dark active:scale-95 transition-transform"
                >
                  Interrupt
                </button>
              )}
              <button
                onClick={talkMode.toggle}
                className="inline-btn px-4 h-9 rounded-md bg-red-500/10 text-[13px] font-medium text-red-500 active:scale-95 transition-transform"
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
      ref={barRef}
      className={`safe-area-bottom relative pointer-events-none ${dragOver ? 'ring-2 ring-primary ring-inset' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 bg-accent/10 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-sm text-accent font-medium">Drop files here</span>
        </div>
      )}
      <div className="max-w-[900px] mx-auto p-3 pointer-events-auto">

        {/* Slash command palette */}
        {/* Toast (slash command feedback) */}
        {toast && (
          <div className="mb-2 flex justify-center animate-[fadeSlideIn_0.2s_ease-out]" role="status" aria-live="polite">
            <div className="px-3 py-1.5 rounded-full bg-accent/12 text-accent text-xs font-medium">
              {toast}
            </div>
          </div>
        )}
        {/* @-mention file picker */}
        {atQuery !== null && (
          <div className="mb-2 rounded-[var(--glass-radius)] glass-heavy overflow-hidden animate-[fadeSlideIn_0.2s_ease-out]" role="listbox" aria-label="Mention a file">
            <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border flex items-center gap-1.5">
              <span>@ Attach file</span>
              {atQuery && <span className="opacity-70 normal-case tracking-normal">— "{atQuery}"</span>}
              <span className="ml-auto normal-case tracking-normal text-[10px] opacity-70">↑↓ · ↵ select · esc</span>
            </div>
            {atMatches.length === 0 ? (
              <div className="px-3 py-3 text-[12.5px] text-muted-foreground text-center">
                {workspaceFiles.length === 0 ? 'Loading workspace…' : `No files match "${atQuery}"`}
              </div>
            ) : (
              <div className="max-h-[260px] overflow-y-auto scrollbar-fine">
                {atMatches.map((f, i) => (
                  <button
                    key={f.path}
                    role="option"
                    aria-selected={i === atIndex}
                    onMouseEnter={() => setAtIndex(i)}
                    onClick={() => insertAtMention(f.path)}
                    className={`inline-btn w-full text-left px-3 py-2 flex items-start gap-2.5 text-[13px] transition-colors border-b border-border/40 last:border-0 ${
                      i === atIndex ? 'bg-accent-soft' : 'hover:bg-accent-soft/60'
                    }`}
                  >
                    <div
                      className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-px"
                      style={{ background: 'color-mix(in oklch, var(--color-cat-doc) 16%, transparent)' }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-cat-doc)' }}>
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-foreground">{f.title}</div>
                      <div className="text-[11.5px] text-muted-foreground/80 truncate">{f.folder} · {f.path}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {showSlashPalette && filteredCommands.length > 0 && (
          <div className="mb-2 rounded-[var(--glass-radius)] glass-heavy overflow-hidden animate-[fadeSlideIn_0.2s_ease-out]" role="listbox">
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
                <span className="text-xs text-text-light-muted dark:text-text-dark-muted truncate">{cmd.description}</span>
                {cmd.arg && (
                  <span className="text-[10px] font-mono text-text-light-muted/60 dark:text-text-dark-muted/60 truncate">{cmd.arg}</span>
                )}
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

        {/* Failed dictation retry prompt */}
        {voice.hasFailedAudio && voice.state === 'idle' && (
          <div className="flex items-center justify-between gap-2 mb-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 animate-[fadeSlideIn_0.2s_ease-out]" role="status">
            <span className="text-xs text-amber-300/90 flex-shrink-0">Last dictation failed</span>
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                onClick={() => voice.retryLastTranscription()}
                className="inline-btn px-2.5 py-1 rounded-full bg-accent/20 text-accent text-[11px] font-medium active:scale-95 transition-transform"
                aria-label="Retry transcription of previous audio"
              >
                Retry
              </button>
              <button
                onClick={() => voice.clearLastFailedAudio()}
                className="inline-btn px-2.5 py-1 rounded-full bg-surface-light-3/40 dark:bg-surface-dark-3/60 text-text-light-muted dark:text-text-dark-muted text-[11px] font-medium active:scale-95 transition-transform"
                aria-label="Discard previous audio"
              >
                Discard
              </button>
              <button
                onClick={() => { voice.clearLastFailedAudio(); voice.start() }}
                className="inline-btn px-2.5 py-1 rounded-full bg-surface-light-3/40 dark:bg-surface-dark-3/60 text-text-light-muted dark:text-text-dark-muted text-[11px] font-medium active:scale-95 transition-transform"
                aria-label="Record new audio"
              >
                Record new
              </button>
            </div>
          </div>
        )}

        {/* Transcribing state */}
        {isTranscribing && (
          <div className="flex items-center justify-center mb-2 gap-2 animate-[fadeSlideIn_0.2s_ease-out]" role="status">
            <div className="voice-spinner" />
            <span className="text-xs text-text-light-muted dark:text-text-dark-muted">Transcribing...</span>
          </div>
        )}

        {/* Attachment preview strip */}
        {(pendingImages.length > 0 || pendingFiles.length > 0) && (
          <div className="image-preview-strip mb-2 animate-[fadeSlideIn_0.2s_ease-out]">
            {pendingImages.map((img, i) => (
              <div key={`img-${i}`} className="relative flex-shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-surface-light-3 dark:border-surface-dark-3">
                <img src={img} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeImage(i)}
                  className="inline-btn absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-surface-dark/80 dark:bg-surface-dark-3/90 text-white flex items-center justify-center text-xs backdrop-blur-sm"
                  aria-label={`Remove image ${i + 1}`}
                >
                  &times;
                </button>
              </div>
            ))}
            {pendingFiles.map((file, i) => (
              <div key={`file-${i}`} className="relative flex-shrink-0 h-16 rounded-xl overflow-hidden border border-surface-light-3 dark:border-surface-dark-3 bg-surface-light-2 dark:bg-surface-dark-2 flex items-center gap-2 px-3 max-w-48">
                <svg className="w-4 h-4 flex-shrink-0 text-text-light-muted dark:text-text-dark-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate text-text-light dark:text-text-dark">{file.name}</div>
                  <div className="text-[10px] text-text-light-muted dark:text-text-dark-muted">{file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}</div>
                </div>
                <button
                  onClick={() => removeFile(i)}
                  className="inline-btn absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-surface-dark/80 dark:bg-surface-dark-3/90 text-white flex items-center justify-center text-xs backdrop-blur-sm"
                  aria-label={`Remove file ${file.name}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.txt,.md,.json,.csv,.xml,.html,.js,.ts,.jsx,.tsx,.py,.css,.yml,.yaml,.toml,.svg,.sh,.log,.docx"
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />

        {/* ─── Unified composer card ────────────────────────────────── */}
        <div className="relative rounded-3xl glass-heavy transition-shadow focus-within:shadow-md focus-within:border-[var(--glass-border-strong)]">
          {isRecording ? (
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="w-2 h-2 rounded-full bg-red-500 recording-pulse flex-shrink-0" />
              <span className="text-[13px] text-foreground/85">Recording</span>
              <div className="flex-1 flex items-center justify-center gap-[3px] h-5">
                {Array.from({ length: 32 }, (_, i) => {
                  const idx = (i / 32) * (voice.levels.length - 1)
                  const lo = Math.floor(idx)
                  const hi = Math.min(lo + 1, voice.levels.length - 1)
                  const frac = idx - lo
                  const val = (voice.levels[lo] || 0) * (1 - frac) + (voice.levels[hi] || 0) * frac
                  return (
                    <div
                      key={i}
                      className="w-[2px] rounded-full bg-red-400/80 transition-all duration-75 ease-out"
                      style={{ height: `${Math.max(3, val * 20)}px` }}
                    />
                  )
                })}
              </div>
              <span className="text-[12px] text-muted-foreground font-mono tabular-nums flex-shrink-0">
                {voice.formattedDuration}
              </span>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                detectAtTrigger(e.target.value, e.target.selectionStart)
              }}
              onKeyDown={(e) => {
                if (atQuery !== null && atMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setAtIndex((i) => (i + 1) % atMatches.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setAtIndex((i) => (i - 1 + atMatches.length) % atMatches.length)
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    insertAtMention(atMatches[atIndex].path)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setAtQuery(null)
                    return
                  }
                }
                handleKeyDown(e)
              }}
              onPaste={handlePaste}
              onFocus={() => { onFocusInput?.() }}
              placeholder={isHome ? 'Ask anything, or type / for commands…' : 'Message…'}
              rows={1}
              disabled={isTranscribing}
              aria-label="Chat message input"
              maxLength={10000}
              className="w-full bg-transparent resize-none focus:outline-none placeholder:text-muted-foreground/70 px-4 pt-3 pb-1 text-[15px] leading-[1.5] text-foreground"
            />
          )}

          {/* Toolbar row */}
          <div className="flex items-end justify-between gap-2 px-2 pb-2 pt-1">
            <div className="flex items-center gap-0.5 min-w-0">
              {/* Model picker */}
              <ModelPill
                modelId={selectedModelId}
                onChange={setSelectedModelId}
                threadId={threadId}
              />
              {/* Reasoning picker */}
              <ReasoningPill threadId={threadId ?? null} />
              <div className="w-px h-4 bg-border mx-1.5 hidden sm:block" />
              {/* Attach file */}
              <IconBtn
                title="Attach file"
                onClick={handleAttachClick}
                disabled={pendingImages.length >= MAX_IMAGES && pendingFiles.length >= MAX_FILES}
              >
                <PaperclipMini />
              </IconBtn>
              {/* @ mention trigger */}
              <IconBtn
                title="Mention a file (@)"
                onClick={() => {
                  const ta = textareaRef.current
                  if (!ta) return
                  ta.focus()
                  // Insert "@" so detectAtTrigger fires naturally
                  const caret = ta.selectionStart
                  const before = value.slice(0, caret)
                  const needsSpace = caret > 0 && !/\s/.test(value[caret - 1])
                  const ins = needsSpace ? ' @' : '@'
                  const next = before + ins + value.slice(caret)
                  setValue(next)
                  requestAnimationFrame(() => {
                    const pos = (before + ins).length
                    ta.setSelectionRange(pos, pos)
                    setAtQuery('')
                    setAtIndex(0)
                  })
                }}
              >
                <AtSignMini />
              </IconBtn>
            </div>

            <div className="flex items-center gap-1 flex-none">
              {isRecording ? (
                <>
                  <IconBtn title="Stop & insert" onClick={voice.stopAndInsert}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                  </IconBtn>
                  <SendBtn onClick={voice.stop} />
                </>
              ) : isStreaming && hasContent ? (
                <>
                  <IconBtn title="Stop generating" onClick={onAbort} variant="danger">
                    <StopMini />
                  </IconBtn>
                  <SendBtn onClick={handleSubmit} pulse={sendAnim} />
                </>
              ) : isStreaming ? (
                <IconBtn title="Stop generating" onClick={onAbort} variant="danger">
                  <StopMini />
                </IconBtn>
              ) : (
                <>
                  <IconBtn
                    title="Voice input (tap or hold)"
                    onClick={handleMicClick}
                    onPointerDown={handleMicPointerDown}
                    onPointerUp={handleMicPointerUp}
                    onPointerLeave={handleMicPointerUp}
                  >
                    <MicMini />
                  </IconBtn>
                  <SendBtn onClick={handleSubmit} disabled={!hasContent} pulse={sendAnim} />
                </>
              )}
            </div>
          </div>

          {/* Character count near limit (overlay top-right of toolbar) */}
          {value.length > 9000 && (
            <div className={`absolute right-3 -top-5 text-[11px] font-mono tabular-nums ${
              value.length > 9800 ? 'text-red-400' : 'text-muted-foreground/60'
            }`}>
              {value.length.toLocaleString()}/10,000
            </div>
          )}
        </div>

        {/* Hint row — desktop only (mouse + keyboard hints don't apply on touch) */}
        {!isRecording && !isTranscribing && (
          <div className="hidden md:flex text-[10.5px] text-muted-foreground/70 mt-2 px-1 items-center gap-3 flex-wrap">
            <span>↵ to send</span>
            <span>⇧↵ for new line</span>
            <span className="opacity-50">·</span>
            <span><kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">/</kbd> commands</span>
            <span><kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">@</kbd> attach a file</span>
          </div>
        )}
      </div>
      {statusOpen && (
        <StatusModal threadId={threadId ?? null} onClose={() => setStatusOpen(false)} />
      )}
      {helpOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-md animate-[fadeSlideIn_0.15s_ease-out]"
          role="dialog"
          aria-label="Slash commands"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="max-w-md w-[92vw] rounded-[var(--glass-radius-lg)] glass-heavy overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-light dark:text-text-dark">Slash commands</h2>
              <button
                onClick={() => setHelpOpen(false)}
                className="inline-btn text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark"
                aria-label="Close help"
              >
                ×
              </button>
            </div>
            <ul className="divide-y divide-white/5 max-h-[60vh] overflow-y-auto">
              {SLASH_COMMANDS.map((cmd) => (
                <li key={cmd.command} className="px-5 py-2.5 flex items-baseline gap-3">
                  <span className="text-sm font-mono font-medium text-text-light dark:text-text-dark">{cmd.command}</span>
                  {cmd.arg && (
                    <span className="text-[10px] font-mono text-text-light-muted/60 dark:text-text-dark-muted/60">{cmd.arg}</span>
                  )}
                  <span className="ml-auto text-xs text-text-light-muted dark:text-text-dark-muted text-right">{cmd.description}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
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

const REASONING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

function ReasoningPicker({ threadId, onChange }: { threadId: string; onChange?: () => void }) {
  // Subscribe to the override for this thread so the active state stays in sync.
  const current = useChatSettingsStore((s) => s.reasoningOverride[threadId] ?? null)
  return (
    <div className="flex items-center gap-2 px-2 pb-2 -mt-1">
      <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground pl-1 pr-2 shrink-0">
        Reasoning
      </span>
      <div className="flex-1 flex items-center gap-1">
        {REASONING_LEVELS.map((level) => {
          const isActive = current === level
          return (
            <button
              key={level}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                useChatSettingsStore.getState().setReasoningOverride(threadId, level)
                onChange?.()
              }}
              className={`flex-1 px-1 py-1.5 rounded-md text-[11px] font-medium text-center transition-all ${
                isActive
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent-soft'
              }`}
            >
              {level === 'xhigh' ? 'x-high' : level}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StopIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  )
}

// ── Small toolbar primitives (mockup-style) ────────────────────────────────

function PaperclipMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  )
}

function AtSignMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>
    </svg>
  )
}

function MicMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}

function StopMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  )
}

function SparklesMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
  )
}

function ChevronMini({ rotated }: { rotated?: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`opacity-60 transition-transform ${rotated ? 'rotate-180' : ''}`}>
      <path d="m6 9 6 6 6-6"/>
    </svg>
  )
}

function CheckMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  )
}

function IconBtn({
  children,
  title,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  disabled,
  variant = 'default',
}: {
  children: React.ReactNode
  title: string
  onClick?: () => void
  onPointerDown?: () => void
  onPointerUp?: () => void
  onPointerLeave?: () => void
  disabled?: boolean
  variant?: 'default' | 'danger'
}) {
  const cls = variant === 'danger'
    ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]'
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      disabled={disabled}
      className={`inline-btn w-8 h-8 rounded-xl flex items-center justify-center transition-colors disabled:opacity-30 touch-none ${cls}`}
    >
      {children}
    </button>
  )
}

function SendBtn({ onClick, disabled, pulse }: { onClick: () => void; disabled?: boolean; pulse?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label="Send"
      title="Send"
      className={`inline-btn h-8 w-8 rounded-xl flex items-center justify-center transition-all touch-none ${
        disabled ? 'bg-foreground/[0.07] text-muted-foreground' : 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm'
      } ${pulse ? 'animate-[sendPulse_0.3s_ease-out]' : ''}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5"/>
        <path d="m5 12 7-7 7 7"/>
      </svg>
    </button>
  )
}

// Inline dropdown pill for model selection
function ModelPill({ modelId, onChange, threadId }: { modelId: string; onChange: (id: string) => void; threadId?: string | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const autoEnabled = useAutoClassifyStore((s) => s.autoEnabled)
  const classification = useAutoClassifyStore((s) => threadId ? s.classifications[threadId] ?? null : null)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const isAuto = modelId === 'auto' || autoEnabled
  const current = MODEL_OPTIONS.find((m) => m.id === modelId) || MODEL_OPTIONS[0]

  let pillLabel: string
  if (isAuto && classification) {
    const classifiedModel = MODEL_OPTIONS.find((m) => m.id === classification.modelId)
    pillLabel = `Auto · ${classifiedModel?.shortLabel ?? classification.modelId}`
  } else if (isAuto) {
    pillLabel = 'Auto'
  } else {
    pillLabel = current.shortLabel
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-btn h-7 px-2 rounded-xl text-[11.5px] flex items-center gap-1.5 transition-colors ${
          open ? 'bg-foreground/[0.07] text-foreground' : 'text-foreground/75 hover:text-foreground hover:bg-foreground/[0.06]'
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: isAuto ? 'var(--color-cat-chat)' : 'var(--color-cat-violet)' }} />
        <span className="truncate max-w-[140px]">{pillLabel}</span>
        <ChevronMini rotated={open} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 z-30 min-w-[240px] rounded-xl bg-popover border border-border shadow-xl overflow-hidden">
          <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
            Model
          </div>
          <div className="py-1">
            <button
              type="button"
              onClick={() => { onChange('auto'); setOpen(false) }}
              className={`inline-btn w-full text-left px-3 py-2 flex items-center gap-2.5 text-[13px] transition-colors ${
                isAuto ? 'bg-accent-soft/60' : 'hover:bg-accent-soft'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-cat-chat)' }} />
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-foreground">Auto</span>
                <span className="block text-[11.5px] text-muted-foreground mt-0.5">Pick model & reasoning automatically</span>
              </span>
              {isAuto && <CheckMini />}
            </button>
            {MODEL_OPTIONS.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => { onChange(m.id); setOpen(false) }}
                className={`inline-btn w-full text-left px-3 py-2 flex items-center gap-2.5 text-[13px] transition-colors ${
                  !isAuto && m.id === modelId ? 'bg-accent-soft/60' : 'hover:bg-accent-soft'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-cat-violet)' }} />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-foreground">{m.label}</span>
                </span>
                {!isAuto && m.id === modelId && <CheckMini />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Inline dropdown pill for reasoning level
const REASONING_DESCRIPTIONS: Record<string, string> = {
  auto: 'Auto — server default',
  none: 'No reasoning',
  minimal: 'Minimal — quick replies',
  low: 'Low — light deliberation',
  medium: 'Medium — balanced',
  high: 'High — careful thinking',
  xhigh: 'X-high — maximum reasoning',
}

function ReasoningPill({ threadId }: { threadId: string | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const effective = useChatSettingsStore((s) => s.getEffectiveReasoning(threadId))
  const autoEnabled = useAutoClassifyStore((s) => s.autoEnabled)
  const autoClassification = useAutoClassifyStore((s) => threadId ? s.classifications[threadId] ?? null : null)
  const isAutoLocked = autoEnabled && autoClassification !== null
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = (level: string) => {
    if (isAutoLocked) return
    const store = useChatSettingsStore.getState()
    if (level === 'auto') {
      if (threadId) store.setReasoningOverride(threadId, null)
      else store.setGlobalReasoning(null)
    } else {
      const typedLevel = level as import('../../state/chatSettings').ReasoningLevel
      if (threadId) store.setReasoningOverride(threadId, typedLevel)
      else store.setGlobalReasoning(typedLevel)
    }
    setOpen(false)
  }

  const displayReasoning = isAutoLocked ? autoClassification.reasoning : effective
  const formatLevel = (level: string) => level === 'xhigh' ? 'X-High' : level.charAt(0).toUpperCase() + level.slice(1)
  const displayLabel = isAutoLocked
    ? `Auto · ${formatLevel(autoClassification.reasoning)}`
    : effective ? formatLevel(effective) : 'Auto'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !isAutoLocked && setOpen(!open)}
        className={`inline-btn h-7 px-2 rounded-xl text-[11.5px] flex items-center gap-1.5 transition-colors ${
          isAutoLocked ? 'text-foreground/50 cursor-default' :
          open ? 'bg-foreground/[0.07] text-foreground' : 'text-foreground/75 hover:text-foreground hover:bg-foreground/[0.06]'
        }`}
        title={isAutoLocked ? 'Reasoning set by Auto mode' : undefined}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-cat-chat)' }} />
        <span className="truncate max-w-[110px]">{displayLabel}</span>
        {!isAutoLocked && <ChevronMini rotated={open} />}
      </button>
      {open && !isAutoLocked && (
        <div className="absolute bottom-full left-0 mb-2 z-30 min-w-[240px] rounded-xl bg-popover border border-border shadow-xl overflow-hidden">
          <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
            Reasoning
          </div>
          <div className="py-1">
            {(['auto','none','minimal','low','medium','high','xhigh'] as const).map((level) => {
              const isActive = level === 'auto' ? displayReasoning === null : displayReasoning === level
              return (
                <button
                  type="button"
                  key={level}
                  onClick={() => handleSelect(level)}
                  className={`inline-btn w-full text-left px-3 py-2 flex items-center gap-2.5 text-[13px] transition-colors ${
                    isActive ? 'bg-accent-soft/60' : 'hover:bg-accent-soft'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-cat-chat)' }} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-foreground">{level === 'xhigh' ? 'X-High' : level.charAt(0).toUpperCase() + level.slice(1)}</span>
                    <span className="block text-[11.5px] text-muted-foreground mt-0.5">{REASONING_DESCRIPTIONS[level]}</span>
                  </span>
                  {isActive && <CheckMini />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
