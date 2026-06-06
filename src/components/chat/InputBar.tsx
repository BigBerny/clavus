import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'
import { haptic } from '../../lib/native'
import { useModelStore } from '../../state/preset'
import { useChatSettingsStore } from '../../state/chatSettings'
import { useChatStore, type PendingFile } from '../../state/chat'
import { listAllWorkspaceFiles, searchWorkspaceFiles } from '../../lib/workspaceApi'
import { useThreadsStore } from '../../state/threads'
import { useDraftsStore } from '../../state/drafts'
import StatusModal from './StatusModal'
import {
  SLASH_COMMANDS,
  filterSlashCommands,
  tryRunSlashCommand,
  syncReasoningToHermes,
  type SlashCommand,
} from '../../lib/slashCommands'
import {
  AtSignMini,
  IconBtn,
  MicMini,
  ModelPill,
  PaperclipMini,
  ReasoningPill,
  SendBtn,
  StopMini,
} from './InputBarControls'
import { InputBarTalkMode, type InputBarTalkModeState } from './InputBarTalkMode'

interface Props {
  onSend: (message: string, images?: string[], files?: PendingFile[]) => void
  onAbort: () => void
  /** Abort the current stream and immediately send the queued message. */
  onSendNow?: () => void
  isStreaming: boolean
  onRecordingChange?: (recording: boolean, duration: string, cancel: () => void) => void
  isHome?: boolean
  onFocusInput?: () => void
  onClear?: () => void
  /** Currently visible thread id, or null when on the home screen. */
  threadId?: string | null
  /** Resend the last user message in this thread (used by /retry). */
  onRetry?: () => void
  talkMode?: InputBarTalkModeState
  /** Stable key for draft persistence — e.g. 'home', a thread id, or a doc path. */
  draftKey?: string
  /** When set, the InputBar is editing this message instead of composing a fresh one. */
  editingMessage?: { messageId: string; originalContent: string } | null
  /** Called when the user submits the edit. */
  onEditSubmit?: (newContent: string) => void
  /** Called when the user cancels the edit (X button or Escape). */
  onEditCancel?: () => void
}

const MAX_IMAGES = 4
const MAX_IMAGE_SIZE = 4 * 1024 * 1024 // 4MB per image
const MAX_FILES = 5
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB per file

async function uploadFile(file: File, threadId?: string | null): Promise<{ path: string } | null> {
  try {
    const form = new FormData()
    form.append('file', file)
    const url = threadId ? `/api/upload?threadId=${encodeURIComponent(threadId)}` : '/api/upload'
    const res = await fetch(url, { method: 'POST', body: form })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export function InputBar({ onSend, onAbort, onSendNow, isStreaming, onRecordingChange, isHome, onFocusInput, onClear, threadId, onRetry, talkMode, draftKey, editingMessage, onEditSubmit, onEditCancel }: Props) {
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

  // Persist edits whenever the draftKey is set (debounced inside the store).
  // Skip persistence while editing a message — the textarea is holding the
  // message content, not a draft for this column.
  useEffect(() => {
    if (!draftKey) return
    if (editingMessage) return
    useDraftsStore.getState().setDraft(draftKey, value)
  }, [value, draftKey, editingMessage])

  // Entering/leaving edit mode: stash the current draft and load the message
  // content; on exit, restore whichever draft was active before.
  const editingMessageIdRef = useRef<string | null>(null)
  const stashedDraftRef = useRef<string | null>(null)
  useEffect(() => {
    const current = editingMessage?.messageId ?? null
    if (current === editingMessageIdRef.current) return // no transition
    if (current) {
      // ENTERING edit mode — save the current textarea content as the draft so
      // we can restore it on cancel/submit.
      stashedDraftRef.current = valueRef.current
      setValue(editingMessage!.originalContent)
      setTimeout(() => {
        const ta = textareaRef.current
        if (ta) {
          ta.focus()
          // Auto-resize to fit the loaded content.
          ta.style.height = 'auto'
          ta.style.height = `${ta.scrollHeight}px`
          // Place cursor at the end.
          const len = ta.value.length
          try { ta.setSelectionRange(len, len) } catch {}
        }
      }, 0)
    } else {
      // LEAVING edit mode — restore the stashed draft (if any).
      if (stashedDraftRef.current !== null) {
        setValue(stashedDraftRef.current)
        stashedDraftRef.current = null
      } else {
        setValue('')
      }
      setTimeout(() => {
        const ta = textareaRef.current
        if (ta) {
          ta.style.height = 'auto'
          ta.style.height = `${ta.scrollHeight}px`
        }
      }, 0)
    }
    editingMessageIdRef.current = current
  }, [editingMessage])
  const [sendAnim, setSendAnim] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [slashIndex, setSlashIndex] = useState(0)
  const [dragOver, setDragOver] = useState(false)
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
    setValue(next.slice(0, 100000))
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

  // Forward-declared so the voice hook (defined later) can submit via this ref
  // without depending on declaration order.
  const handleSubmitRef = useRef<((overrideText?: string) => void) | null>(null)

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

  // Image paste handler + long text auto-attach
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

    // Long text paste: auto-attach as a file instead of filling the textarea
    const textData = e.clipboardData?.getData('text/plain')
    if (textData && textData.length > 2000 && pendingFiles.length < MAX_FILES) {
      e.preventDefault()
      const blob = new Blob([textData], { type: 'text/plain' })
      const file = new File([blob], `pasted-${Date.now()}.txt`, { type: 'text/plain' })
      uploadFile(file, threadId).then((uploaded) => {
        if (!uploaded) return
        setPendingFiles((prev) => prev.length >= MAX_FILES ? prev : [
          ...prev, { name: file.name, content: '', size: textData.length, localPath: uploaded.path },
        ])
      })
    }
  }, [pendingImages.length, pendingFiles.length, threadId])

  // Listen for screenshots from the Clavus desktop dictation overlay.
  useEffect(() => {
    const handler = (e: Event) => {
      const images = (e as CustomEvent).detail?.images as string[] | undefined
      if (!images || images.length === 0) return
      setPendingImages((prev) => {
        const combined = [...prev, ...images]
        return combined.slice(0, MAX_IMAGES)
      })
    }
    window.addEventListener('clavus-screenshot', handler)
    return () => window.removeEventListener('clavus-screenshot', handler)
  }, [])

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
      setReasoningOverride: (tid, level) => { useChatSettingsStore.getState().setReasoningOverride(tid, level); useThreadsStore.getState().updateThreadReasoning(tid, level) },
      getReasoningOverride: (tid) => useChatSettingsStore.getState().getReasoningOverride(tid),
      setModelId: (id) => { useModelStore.getState().setSelectedModelId(id); if (threadId) useThreadsStore.getState().updateThreadModel(threadId, id) },
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

  const handleSubmit = useCallback(async (overrideText?: string | React.SyntheticEvent) => {
    // React passes the click/submit event when this function is used directly
    // as an event handler. Treat non-string values as "no override"; otherwise
    // `(overrideText ?? value).trim()` crashes and sending silently fails.
    const sourceText = typeof overrideText === 'string' ? overrideText : value
    const trimmed = sourceText.trim()
    if (!trimmed && pendingImages.length === 0 && pendingFiles.length === 0) return

    // Editing a previously-sent message: route through onEditSubmit instead of
    // creating a new message. Attachments and slash commands are bypassed —
    // the edit just replaces the message text and re-runs from that point.
    if (editingMessage && onEditSubmit) {
      if (!trimmed) return
      onEditSubmit(trimmed.slice(0, 100000))
      setSendAnim(true)
      setTimeout(() => setSendAnim(false), 300)
      haptic.tap()
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      return
    }

    // Try local slash command interpreter first
    if (trimmed.startsWith('/')) {
      const handled = await runSlash(trimmed)
      if (handled) {
        setValue('')
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
        return
      }
    }

    // During streaming: queue raw (preserves files for later editing) instead
    // of dropping or aborting. The single-item queue auto-appends, and the
    // drain in useChat sends it when the current response completes.
    if (isStreaming && threadId) {
      console.log('[Clavus] InputBar queued submit — isStreaming=true', { threadId })
      useChatStore.getState().enqueueOrAppend(threadId, {
        content: trimmed,
        files: pendingFiles.length > 0 ? pendingFiles : undefined,
        images: pendingImages.length > 0 ? pendingImages : undefined,
      })
      setSendAnim(true)
      setTimeout(() => setSendAnim(false), 300)
      haptic.tap()
      setValue('')
      setPendingImages([])
      setPendingFiles([])
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      setTimeout(() => textareaRef.current?.focus(), 50)
      return
    }

    setSendAnim(true)
    setTimeout(() => setSendAnim(false), 300)
    haptic.tap()
    onSend(trimmed.slice(0, 100000), pendingImages.length > 0 ? pendingImages : undefined, pendingFiles.length > 0 ? pendingFiles : undefined)
    setValue('')
    setPendingImages([])
    setPendingFiles([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [value, onSend, pendingImages, pendingFiles, runSlash, isStreaming, threadId, editingMessage, onEditSubmit])

  // Keep the forward-declared ref in sync with the latest handleSubmit.
  useEffect(() => { handleSubmitRef.current = handleSubmit }, [handleSubmit])

  const voice = useVoiceRecorder({
    threadId,
    onTranscription: (text) => {
      // Combine any in-progress textarea content with the transcription, then
      // route through handleSubmit so pendingFiles/pendingImages are attached
      // and slash commands still work.
      const current = value.trim()
      const finalText = current ? current + ' ' + text : text
      handleSubmitRef.current?.(finalText)
      haptic.tap()
    },
    onInsertTranscription: (text) => {
      // Insert text into textarea without sending
      const current = value.trim()
      const newValue = current ? current + ' ' + text : text
      setValue(newValue.slice(0, 100000))
      haptic.tap()
      setTimeout(() => textareaRef.current?.focus(), 50)
    },
  })
  const voiceState = voice.state
  const cancelVoiceRecording = voice.cancel

  // Report recording state changes to parent (for header recording bar)
  useEffect(() => {
    onRecordingChange?.(voice.state === 'recording', voice.formattedDuration, voice.cancel)
  }, [voice.state, voice.formattedDuration, voice.cancel, onRecordingChange])

  // Global Escape key listener to cancel active recordings regardless of focus
  useEffect(() => {
    if (voiceState !== 'recording') return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelVoiceRecording()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [voiceState, cancelVoiceRecording])

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
      // Escape cancels an in-progress message edit (restores the previous draft).
      if (e.key === 'Escape' && editingMessage) {
        e.preventDefault()
        onEditCancel?.()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit, showSlashPalette, filteredCommands, slashIndex, selectSlashCommand, editingMessage, onEditCancel],
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
      } else {
        // All non-image files: upload to get a local path the agent can read directly
        if (pendingFiles.length >= MAX_FILES) continue
        if (file.size > MAX_FILE_SIZE) continue
        const f = file
        uploadFile(f, threadId).then((uploaded) => {
          setPendingFiles((prev) => {
            if (prev.length >= MAX_FILES) return prev
            return [...prev, { name: f.name, content: '', size: f.size, localPath: uploaded?.path }]
          })
        })
      }
    }

    // Reset input so same file can be re-selected
    e.target.value = ''
  }, [pendingImages.length, pendingFiles.length, threadId])

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
      } else {
        if (pendingFiles.length >= MAX_FILES) continue
        if (file.size > MAX_FILE_SIZE) continue
        const f = file
        uploadFile(f, threadId).then((uploaded) => {
          setPendingFiles(prev => prev.length >= MAX_FILES ? prev : [...prev, {
            name: f.name,
            content: '',
            size: f.size,
            localPath: uploaded?.path,
          }])
        })
      }
    }
  }, [pendingImages.length, pendingFiles.length, threadId])

  const { selectedModelId, setSelectedModelId: setGlobalModelId } = useModelStore()
  const setSelectedModelId = useCallback((id: string) => {
    setGlobalModelId(id)
    if (threadId) useThreadsStore.getState().updateThreadModel(threadId, id)
  }, [setGlobalModelId, threadId])

  // Queued message for this thread (set when the user submits while streaming).
  const queuedMessage = useChatStore((s) =>
    threadId ? s.threadStates[threadId]?.queuedMessage ?? null : null,
  )

  /** Pull queued content + attachments back into the composer for editing. */
  const handleEditQueued = useCallback(() => {
    if (!threadId) return
    const queued = useChatStore.getState().pullQueuedMessage(threadId)
    if (!queued) return
    setValue(queued.content)
    setPendingFiles(queued.files ?? [])
    setPendingImages(queued.images ?? [])
    haptic.tap()
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [threadId])

  /** Drop the queued message without sending. */
  const handleTrashQueued = useCallback(() => {
    if (!threadId) return
    useChatStore.getState().clearQueuedMessage(threadId)
    haptic.tap()
  }, [threadId])

  /** Abort current stream and send the queued message immediately. */
  const handleSendNowQueued = useCallback(() => {
    if (!queuedMessage) return
    haptic.tap()
    onSendNow?.()
  }, [onSendNow, queuedMessage])

  const hasText = value.trim().length > 0
  const hasContent = hasText || pendingImages.length > 0 || pendingFiles.length > 0

  if (talkMode?.active) {
    return <InputBarTalkMode talkMode={talkMode} />
  }

  return (
    <div
      ref={barRef}
      className={`safe-area-bottom relative pointer-events-none`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-2 rounded-xl border-2 border-dashed border-accent/50 bg-accent/8 flex items-center justify-center z-10 pointer-events-none backdrop-blur-xs transition-all">
          <div className="flex items-center gap-2 text-accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span className="text-sm font-medium">Drop to attach</span>
          </div>
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

        {/* Editing-message row — visible above the composer while the user is
            editing a previously-sent message. Submitting truncates the
            conversation from that point and re-sends with the new content. */}
        {editingMessage && (
          <div
            className="mb-2 px-3 py-2 rounded-3xl glass-heavy flex items-center gap-2.5 animate-[fadeSlideIn_0.2s_ease-out]"
            role="status"
            aria-label="Editing message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="text-accent flex-shrink-0"
              aria-hidden="true"
            ><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            <span className="flex-1 text-[13px] text-foreground/90 truncate">
              Editing message — submit will re-run from this point
            </span>
            <button
              onClick={() => onEditCancel?.()}
              className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
              aria-label="Cancel edit"
              title="Cancel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}

        {/* Queued message row — visible above the composer while a response
            streams and the user has submitted another message. */}
        {queuedMessage && (
          <div
            className="mb-2 px-3 py-2 rounded-3xl glass-heavy flex items-center gap-2.5 animate-[fadeSlideIn_0.2s_ease-out]"
            role="status"
            aria-label="Queued message"
          >
            <div
              className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/40 flex-shrink-0"
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-[13px] text-foreground/90 truncate">
                {queuedMessage.content || (queuedMessage.files?.length || queuedMessage.images?.length ? 'Attachments queued' : 'Queued')}
              </span>
              {(queuedMessage.files?.length || queuedMessage.images?.length) ? (
                <span className="text-[10.5px] text-muted-foreground flex-shrink-0">
                  {queuedMessage.files?.length ? `${queuedMessage.files.length} file${queuedMessage.files.length === 1 ? '' : 's'}` : null}
                  {queuedMessage.files?.length && queuedMessage.images?.length ? ' · ' : null}
                  {queuedMessage.images?.length ? `${queuedMessage.images.length} image${queuedMessage.images.length === 1 ? '' : 's'}` : null}
                </span>
              ) : null}
            </div>
            <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground/70 flex-shrink-0">Queued</span>
            <button
              onClick={handleEditQueued}
              className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
              aria-label="Edit queued message"
              title="Edit"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
            <button
              onClick={handleSendNowQueued}
              className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
              aria-label="Send queued message now"
              title="Send now"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
            </button>
            <button
              onClick={handleTrashQueued}
              className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
              aria-label="Discard queued message"
              title="Discard"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
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
          accept="*/*"
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
              maxLength={100000}
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
          {value.length > 90000 && (
            <div className={`absolute right-3 -top-5 text-[11px] font-mono tabular-nums ${
              value.length > 98000 ? 'text-red-400' : 'text-muted-foreground/60'
            }`}>
              {value.length.toLocaleString()}/100,000
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
