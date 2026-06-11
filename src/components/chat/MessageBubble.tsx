import { memo, useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import { FileText, Paperclip, Volume2 } from 'lucide-react'
import type { Message, MessageUsage } from '../../state/chat'
import { ToolCallCards } from './ToolCallCard.tsx'
import { ButtonGroup, SelectBlock, ConfirmBlock, FormBlock, parseButtonsLine, parseSelectLine, parseFormBlock, type ButtonAction, type SelectOption, type FormBlockData } from './InteractiveBlock.tsx'
import { haptic } from '../../lib/native'
import { normalizeToolCalls } from '../../lib/toolCalls.ts'

const RichMessageRenderer = lazy(() => import('./RichMessageRenderer.tsx').then(m => ({ default: m.RichMessageRenderer })))

// ─── Thinking Block ─────────────────────────────────────────────────────────

function ThinkingBlock({ thinking, isStreaming, defaultExpanded, toolCalls, isStreamingMsg }: {
  thinking: string
  isStreaming: boolean
  defaultExpanded: boolean
  toolCalls?: import('../../state/chat').ToolCall[]
  isStreamingMsg?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  // Auto-collapse when thinking is done (streaming stops)
  useEffect(() => {
    if (!isStreaming && expanded) {
      const timer = setTimeout(() => setExpanded(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isStreaming, expanded])

  // Auto-expand when streaming starts
  useEffect(() => {
    if (isStreaming) setExpanded(true)
  }, [isStreaming])

  const normalizedToolCalls = useMemo(() => normalizeToolCalls(toolCalls), [toolCalls])
  const hasToolCalls = normalizedToolCalls.length > 0

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-btn flex items-center gap-1.5 text-[11px] text-text-light-muted/50 dark:text-text-dark-muted/50 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        {isStreaming ? (
          <span className="animate-pulse">Thinking...</span>
        ) : (
          <span>
            Reasoning
            {hasToolCalls && <span className="ml-1.5 text-text-light-muted/40 dark:text-text-dark-muted/40 text-[11px]">+ {normalizedToolCalls.length} {normalizedToolCalls.length === 1 ? 'action' : 'actions'}</span>}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 pl-3.5 border-l border-text-light-muted/12 dark:border-text-dark-muted/12">
          <div className="prose prose-sm dark:prose-invert max-w-none text-[12px] text-text-light-muted/50 dark:text-text-dark-muted/50 leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-[13px] [&_h2]:text-[13px] [&_h3]:text-[12px] [&_h4]:text-[12px] [&_strong]:text-text-light-muted/70 dark:[&_strong]:text-text-dark-muted/70" style={{ overflowWrap: 'break-word' }}>
            <Suspense fallback={<p className="whitespace-pre-wrap">{thinking}</p>}>
              <RichMessageRenderer content={thinking} />
            </Suspense>
          </div>
          {hasToolCalls && (
            <div className="mt-2">
              <ToolCallCards toolCalls={normalizedToolCalls} isStreaming={!!isStreamingMsg} className="mb-1.5" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Copyable Block ─────────────────────────────────────────────────────────
// Renders content inside :::copy fences as a styled card with a copy button.
// Copies as rich text (HTML) so formatting (links, lists, etc.) is preserved
// when pasting into Slack, email, etc.

function CopyableBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchedRef = useRef(false)

  const handleCopy = useCallback(async () => {
    if (!contentRef.current) return
    try {
      const html = contentRef.current.innerHTML
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([children], { type: 'text/plain' }),
        }),
      ])
    } catch {
      // Fallback: copy plain text
      navigator.clipboard.writeText(children)
    }
    setCopied(true)
    haptic.tap()
    setTimeout(() => setCopied(false), 2000)
  }, [children])

  // Long-press to copy on mobile
  const handleTouchStart = useCallback(() => {
    touchedRef.current = true
    longPressTimer.current = setTimeout(() => {
      handleCopy()
    }, 500)
  }, [handleCopy])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // Click to copy on desktop (skip if text is selected or on touch device)
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Skip if this was a touch interaction (longpress handles mobile)
    if (touchedRef.current) {
      touchedRef.current = false
      return
    }
    // Don't copy if user is selecting text
    if (window.getSelection()?.toString()) return
    // Don't copy if clicking the header copy button
    if ((e.target as HTMLElement).closest('button')) return
    handleCopy()
  }, [handleCopy])

  return (
    <div
      className="!my-1.5 rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/8 overflow-hidden relative group/copy cursor-pointer"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onClick={handleClick}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-accent/10">
        <span className="text-[11px] font-medium text-accent/60 uppercase tracking-wider">{copied ? 'Copied!' : 'Output'}</span>
        <button
          onClick={(e) => { e.stopPropagation(); handleCopy() }}
          className={`inline-btn flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-all ${
            copied
              ? 'text-emerald-500 bg-emerald-500/10'
              : 'text-accent/70 hover:text-accent hover:bg-accent/10'
          }`}
          aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
        >
          {copied ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Copied!
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              Copy
            </>
          )}
        </button>
      </div>
      <div ref={contentRef} className="p-4 prose prose-sm dark:prose-invert max-w-none text-[15px] leading-[1.55] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <Suspense fallback={<p className="whitespace-pre-wrap">{children}</p>}>
          <RichMessageRenderer content={children} remarkPluginsGfmOnly />
        </Suspense>
      </div>
    </div>
  )
}

// ─── Embed Block ────────────────────────────────────────────────────────────
// Renders [embed ref="url" ...] as sandboxed iframes or placeholders

function EmbedBlock({ src, title }: { src: string; title?: string }) {
  // If src is a valid URL, render as iframe
  const isUrl = src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/')

  if (!isUrl) {
    return (
      <p className="text-[13px] text-text-light-muted/60 dark:text-text-dark-muted/50 italic my-1">
        {title || src}
      </p>
    )
  }

  return (
    <div className="my-2 rounded-xl border border-surface-light-3/20 dark:border-surface-dark-3/20 overflow-hidden bg-white dark:bg-[#0d0f14]">
      {title && (
        <div className="px-3 py-1.5 border-b border-surface-light-3/15 dark:border-surface-dark-3/15 text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/50 truncate">
          {title}
        </div>
      )}
      <iframe
        src={src}
        title={title || 'Embedded content'}
        sandbox="allow-scripts allow-same-origin"
        className="w-full border-0"
        style={{ minHeight: 200, maxHeight: 400 }}
      />
    </div>
  )
}

// ─── Reply Quote Block ──────────────────────────────────────────────────────

function ReplyQuoteBlock({ content }: { content: string }) {
  return (
    <div className="mb-2 pl-3 border-l-2 border-accent/30 rounded-r-lg bg-accent/5 dark:bg-accent/8 px-3 py-1.5">
      <div className="text-[10px] text-accent/60 font-medium mb-0.5">Reply to</div>
      <p className="text-[12px] text-text-light-muted/70 dark:text-text-dark-muted/70 line-clamp-2" style={{ overflowWrap: 'break-word' }}>
        {content}
      </p>
    </div>
  )
}

// ─── Content Block Parser ───────────────────────────────────────────────────

type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'copy'; content: string }
  | { type: 'embed'; src: string; title?: string }
  | { type: 'reply'; content: string }
  | { type: 'buttons'; buttons: ButtonAction[] }
  | { type: 'select'; prompt: string; options: SelectOption[] }
  | { type: 'confirm'; message: string; confirmLabel?: string; cancelLabel?: string }
  | { type: 'form'; data: FormBlockData }

// Parse custom blocks from markdown content
function splitContentBlocks(content: string): ContentBlock[] {
  const parts: ContentBlock[] = []
  const lines = content.split('\n')
  let current = ''
  let inCopy = false
  let copyContent = ''

  let inConfirm = false
  let confirmContent = ''

  let inForm = false
  let formLines: string[] = []

  for (const line of lines) {
    // :::form block
    if (line.trim() === ':::form' && !inCopy && !inConfirm && !inForm) {
      if (current.trim()) parts.push({ type: 'text', content: current })
      current = ''
      inForm = true
      formLines = []
    } else if (line.trim() === ':::' && inForm) {
      const formData = parseFormBlock(formLines)
      if (formData) parts.push({ type: 'form', data: formData })
      formLines = []
      inForm = false
    } else if (inForm) {
      formLines.push(line)
    }
    // :::confirm block
    else if (line.trim() === ':::confirm' && !inCopy && !inConfirm) {
      if (current.trim()) parts.push({ type: 'text', content: current })
      current = ''
      inConfirm = true
      confirmContent = ''
    } else if (line.trim() === ':::' && inConfirm) {
      // Parse confirm block: first line is message, optional confirmLabel/cancelLabel
      const cLines = confirmContent.trim().split('\n')
      const msg = cLines[0] || ''
      let confirmLabel: string | undefined
      let cancelLabel: string | undefined
      for (const cl of cLines.slice(1)) {
        const cm = cl.match(/^confirmLabel:\s*"?([^"]*)"?$/)
        if (cm) confirmLabel = cm[1]
        const dm = cl.match(/^cancelLabel:\s*"?([^"]*)"?$/)
        if (dm) cancelLabel = dm[1]
      }
      parts.push({ type: 'confirm', message: msg, confirmLabel, cancelLabel })
      confirmContent = ''
      inConfirm = false
    } else if (inConfirm) {
      confirmContent += line + '\n'
    }
    // :::copy block start
    else if (line.trim() === ':::copy' && !inCopy) {
      if (current.trim()) parts.push({ type: 'text', content: current })
      current = ''
      inCopy = true
      copyContent = ''
    // :::copy block end
    } else if (line.trim() === ':::' && inCopy) {
      parts.push({ type: 'copy', content: copyContent.trim() })
      copyContent = ''
      inCopy = false
    } else if (inCopy) {
      copyContent += line + '\n'
    } else {
      // Check for [embed ref="..." ...] pattern (also matches self-closing /] and extra attrs like height)
      const embedMatch = line.trim().match(/^\[embed\s+ref="([^"]+)"(?:\s+title="([^"]*)")?(?:\s+[a-z]+"[^"]*")*\s*\/?\]$/)
      if (embedMatch) {
        if (current.trim()) parts.push({ type: 'text', content: current })
        current = ''
        parts.push({ type: 'embed', src: embedMatch[1], title: embedMatch[2] })
      }
      // Check for [buttons ...] pattern
      else {
        const buttons = parseButtonsLine(line)
        if (buttons) {
          if (current.trim()) parts.push({ type: 'text', content: current })
          current = ''
          parts.push({ type: 'buttons', buttons })
        }
        // Check for [select ...] pattern
        else {
          const select = parseSelectLine(line)
          if (select) {
            if (current.trim()) parts.push({ type: 'text', content: current })
            current = ''
            parts.push({ type: 'select', prompt: select.prompt, options: select.options })
          }
          // Check for [[reply_to_current]] or [[reply_to:<id>]] patterns
          else if (line.trim().startsWith('[[reply_to')) {
            // Skip the directive itself
          } else {
            current += line + '\n'
          }
        }
      }
    }
  }

  // Handle unclosed copy block
  if (inCopy && copyContent.trim()) {
    parts.push({ type: 'copy', content: copyContent.trim() })
  }
  if (!inCopy && current.trim()) {
    parts.push({ type: 'text', content: current })
  }

  return parts
}

// Extract reply quote from message content (> quoted text at start)
function extractReplyQuote(content: string): { quote: string | null; rest: string } {
  const lines = content.split('\n')
  const quoteLines: string[] = []
  let startIdx = 0

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('> ')) {
      quoteLines.push(lines[i].slice(2))
      startIdx = i + 1
    } else if (quoteLines.length > 0 && lines[i].trim() === '') {
      startIdx = i + 1
      break
    } else {
      break
    }
  }

  if (quoteLines.length === 0) return { quote: null, rest: content }
  return {
    quote: quoteLines.join('\n'),
    rest: lines.slice(startIdx).join('\n'),
  }
}

// ─── Message Info Badge ──────────────────────────────────────────────────────

function MessageInfoPopover({ open, onClose, model, usage }: { open: boolean; onClose: () => void; model?: string; usage?: MessageUsage }) {
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Message info"
      className="absolute right-full top-1/2 -translate-y-1/2 mr-1.5 px-3 py-2 rounded-lg bg-[#1a1b26] border border-white/10 shadow-lg shadow-black/30 text-[11px] text-text-dark-muted whitespace-nowrap z-50 animate-[fadeSlideIn_0.1s_ease-out]"
    >
      {model && <div className="font-medium text-text-dark mb-0.5">{model}</div>}
      {usage && (
        <div className="space-y-0.5 text-text-dark-muted/70">
          <div>Input: {usage.inputTokens.toLocaleString()} tokens</div>
          <div>Output: {usage.outputTokens.toLocaleString()} tokens</div>
          <div>Total: {usage.totalTokens.toLocaleString()} tokens</div>
        </div>
      )}
      {!usage && !model && <div className="text-text-dark-muted/50">No data available</div>}
    </div>
  )
}

interface Props {
  message: Message
  isSpeaking?: boolean
  ttsLoading?: boolean
  onSpeak?: (id: string, text: string) => void
  onRegenerate?: (messageId: string) => void
  /** Begin editing this user message — content is loaded into the main InputBar. */
  onStartEdit?: (messageId: string, content: string) => void
  /** This message is currently being edited in the InputBar — show a hint and dim the bubble. */
  isBeingEdited?: boolean
  onBranch?: (messageId: string) => void
  showAvatar?: boolean
  isLastInGroup?: boolean
  /** Thread id — propagated to RichMessageRenderer for linkedDoc tracking. */
  threadId?: string
}

export const MessageBubble = memo(function MessageBubble({ message, isSpeaking, ttsLoading, onSpeak, onRegenerate, onStartEdit, isBeingEdited, onBranch, showAvatar = true, isLastInGroup = true, threadId }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isAssistant = message.role === 'assistant'

  const contentParts = useMemo(() =>
    isAssistant ? splitContentBlocks(message.content) : [],
    [isAssistant, message.content]
  )
  const replyQuote = useMemo(() =>
    isAssistant ? extractReplyQuote(message.content) : null,
    [isAssistant, message.content]
  )
  const isError = isSystem && message.content.startsWith('Error:')
  const [copied, setCopied] = useState(false)
  const [infoUnlocked, setInfoUnlocked] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content)
    haptic.tap()
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [message.content])

  // Long-press to copy + unlock info button on mobile
  const handleTouchStart = useCallback(() => {
    if (!message.content || message.streaming) return
    longPressTimer.current = setTimeout(() => {
      handleCopy()
      setInfoUnlocked(true)
    }, 500)
  }, [message.content, message.streaming, handleCopy])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // Desktop: right-click to unlock info button
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!message.content || message.streaming || !isAssistant) return
    e.preventDefault()
    setInfoUnlocked(true)
  }, [message.content, message.streaming, isAssistant])

  const handleSpeak = useCallback(() => {
    onSpeak?.(message.id, message.content)
  }, [onSpeak, message.id, message.content])

  // Hide empty assistant messages (no content, not streaming)
  if (isAssistant && !message.content?.trim() && !message.streaming && !message.thinking) {
    return null
  }

  // System/error messages
  if (isSystem) {
    return (
      <div className="flex justify-center animate-[fadeSlideIn_0.3s_ease-out] py-0.5" role="status">
        <div className={`max-w-[85%] px-3.5 py-2 rounded-xl text-[12px] text-center leading-snug ${
          isError
            ? 'bg-red-500/8 text-red-500/90 dark:text-red-400/90 border border-red-500/15'
            : 'glass-light text-muted-foreground/70'
        }`}>
          {isError ? (
            <div className="flex items-center justify-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-80"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>{message.content.replace(/^Error:\s*/, '')}</span>
              <button
                onClick={() => handleCopy()}
                className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity p-0.5 -mr-1"
                title="Copy error message"
              >
                {copied ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                )}
              </button>
            </div>
          ) : (
            message.content
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-[fadeSlideIn_0.3s_ease-out] group/msg`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      onContextMenu={handleContextMenu}
      role="article"
      aria-label={`${isUser ? 'You' : 'Jane'}: ${message.content.slice(0, 80)}`}
    >
      <div className={`flex items-end gap-1 max-w-[95%] md:max-w-[750px] min-w-0 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <div
          className={`px-3.5 py-2 min-w-0 w-fit relative transition-[min-height,opacity] duration-200 ease-out ${message.streaming ? 'streaming-bubble' : ''} ${isBeingEdited ? 'opacity-50' : ''} ${
            isUser
              ? `glass-user text-foreground ${
                  showAvatar && isLastInGroup ? 'rounded-[16px]' :
                  showAvatar ? 'rounded-[16px] rounded-br-[5px]' :
                  isLastInGroup ? 'rounded-[16px] rounded-tr-[5px]' :
                  'rounded-[16px] rounded-r-[5px]'
                }`
              : `glass-light text-foreground ${
                  showAvatar && isLastInGroup ? 'rounded-[16px]' :
                  showAvatar ? 'rounded-[16px] rounded-bl-[5px]' :
                  isLastInGroup ? 'rounded-[16px] rounded-tl-[5px]' :
                  'rounded-[16px] rounded-l-[5px]'
                }`
          }`}
        >
          {/* Image attachments (user-sent) */}
          {message.images && message.images.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 ${message.content ? 'mb-2' : ''}`}>
              {message.images.map((img, i) => (
                <a key={i} href={img} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden max-w-[200px]">
                  <img src={img} alt={`Image ${i + 1}`} className="max-w-full h-auto rounded-lg" loading="lazy" />
                </a>
              ))}
            </div>
          )}
          {/* Media attachments (agent-sent) */}
          {message.media && message.media.length > 0 && (
            <div className={`space-y-1.5 ${message.content ? 'mb-2' : ''}`}>
              {message.media.map((m, i) => (
                <div key={i}>
                  {m.type === 'image' && (
                    <a href={m.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden max-w-[300px]">
                      <img src={m.url} alt={m.title || `Image ${i + 1}`} className="max-w-full h-auto rounded-lg" loading="lazy" />
                    </a>
                  )}
                  {m.type === 'audio' && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-light-2/50 dark:bg-surface-dark-2/50">
                      <Volume2 className="w-3.5 h-3.5 text-text-light-muted/70 dark:text-text-dark-muted/70 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                      <audio controls preload="metadata" className="h-8 flex-1 min-w-0">
                        <source src={m.url} type={m.mimeType || 'audio/mpeg'} />
                      </audio>
                    </div>
                  )}
                  {m.type === 'video' && (
                    <video controls preload="metadata" className="max-w-full rounded-lg max-h-[300px]">
                      <source src={m.url} type={m.mimeType || 'video/mp4'} />
                    </video>
                  )}
                  {m.type === 'file' && (
                    <a href={m.url} download={m.title} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-light-2/50 dark:bg-surface-dark-2/50 hover:bg-surface-light-3/50 dark:hover:bg-surface-dark-3/50 transition-colors">
                      <Paperclip className="w-3.5 h-3.5 text-text-light-muted/70 dark:text-text-dark-muted/70 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                      <span className="text-[13px] text-text-light-muted dark:text-text-dark-muted truncate">{m.title || 'Download'}</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {/* File attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 ${message.content ? 'mb-2' : ''}`}>
              {message.attachments.map((file, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-light-2/40 dark:bg-surface-dark-2/40 text-[12.5px] text-text-light-muted dark:text-text-dark-muted">
                  <FileText className="w-3.5 h-3.5 shrink-0 opacity-60" strokeWidth={1.75} aria-hidden="true" />
                  <span className="truncate max-w-[200px]">{file.name}</span>
                  {file.size > 0 && <span className="opacity-50 shrink-0">{file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}</span>}
                </span>
              ))}
            </div>
          )}
          {isUser ? (
            message.content ? (
              <p className="whitespace-pre-wrap text-[15px] leading-[1.55]" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>{message.content}</p>
            ) : null
          ) : message.streaming && !message.content && !message.thinking && !message.toolCalls?.length ? (
            <div className="flex items-center gap-[3px] py-0.5">
              <span className="w-[3.5px] h-[3.5px] rounded-full bg-text-light-muted/30 dark:bg-text-dark-muted/30 animate-[pulse_1.6s_ease-in-out_infinite]" />
              <span className="w-[3.5px] h-[3.5px] rounded-full bg-text-light-muted/30 dark:bg-text-dark-muted/30 animate-[pulse_1.6s_ease-in-out_0.2s_infinite]" />
              <span className="w-[3.5px] h-[3.5px] rounded-full bg-text-light-muted/30 dark:bg-text-dark-muted/30 animate-[pulse_1.6s_ease-in-out_0.4s_infinite]" />
            </div>
          ) : (
            <>
            {/* Thinking/Reasoning block (includes actions when present) */}
            {message.thinking && (
              <ThinkingBlock
                thinking={message.thinking}
                isStreaming={!!message.streaming && !message.thinkingDone}
                defaultExpanded={!!message.streaming && !message.thinkingDone}
                toolCalls={message.toolCalls}
                isStreamingMsg={message.streaming}
              />
            )}
            {/* Standalone tool call cards — only when no thinking block */}
            {!message.thinking && message.toolCalls && message.toolCalls.length > 0 && (
              <ToolCallCards toolCalls={message.toolCalls} isStreaming={!!message.streaming} className={message.content?.trim() ? 'mb-1.5' : undefined} />
            )}
            {/* Reply quote block */}
            {replyQuote?.quote && (
              <ReplyQuoteBlock content={replyQuote.quote} />
            )}
            <div className="prose prose-sm dark:prose-invert max-w-none text-[15px] leading-[1.55] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_pre]:overflow-x-auto [&_table]:overflow-x-auto [&_code]:break-keep-all" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
              <Suspense fallback={<p className="whitespace-pre-wrap">{message.content}</p>}>
                {contentParts.length > 1 || contentParts.some(p => p.type !== 'text') ? (
                  contentParts.map((part, i) => {
                    if (part.type === 'copy') return <CopyableBlock key={i}>{part.content}</CopyableBlock>
                    if (part.type === 'embed') return <EmbedBlock key={i} src={part.src} title={part.title} />
                    if (part.type === 'buttons') return <ButtonGroup key={i} buttons={part.buttons} />
                    if (part.type === 'select') return <SelectBlock key={i} prompt={part.prompt} options={part.options} />
                    if (part.type === 'confirm') return <ConfirmBlock key={i} message={part.message} confirmLabel={part.confirmLabel} cancelLabel={part.cancelLabel} />
                    if (part.type === 'form') return <FormBlock key={i} data={part.data} />
                    return <RichMessageRenderer key={i} content={part.content} threadId={threadId} isStreaming={message.streaming} />
                  })
                ) : (
                  <RichMessageRenderer content={replyQuote ? replyQuote.rest : (message.content || ' ')} threadId={threadId} isStreaming={message.streaming} />
                )}
              </Suspense>
            </div>
          </>
          )}
          {/* Streaming cursor rendered via CSS ::after on .streaming-bubble .prose */}
        </div>
        {/* Copied toast */}
        {copied && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-accent/90 text-white text-[10px] font-medium animate-[fadeSlideIn_0.2s_ease-out] pointer-events-none">
            Copied
          </div>
        )}
        {/* Action buttons — next to bubble */}
        {isAssistant && message.content && isLastInGroup && (
          <div className="flex flex-col gap-0.5 flex-shrink-0 mb-0.5">
            <button
              onClick={handleCopy}
              className={`inline-btn p-1.5 rounded-full active:scale-90 transition-all ${
                copied
                  ? 'text-emerald-500'
                  : 'text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark'
              }`}
              aria-label={copied ? 'Copied' : 'Copy message'}
            >
              {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="13" height="13" x="9" y="9" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              )}
            </button>
            {onSpeak && (
              <button
                onClick={handleSpeak}
                className={`inline-btn p-1.5 rounded-full active:scale-90 transition-all ${
                  isSpeaking
                    ? 'text-accent'
                    : ttsLoading
                      ? 'text-text-light-muted/30 dark:text-text-dark-muted/30'
                      : 'text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark'
                }`}
                aria-label={isSpeaking ? 'Stop speaking' : 'Listen to message'}
              >
                {ttsLoading ? (
                  <div className="voice-spinner" style={{ width: 20, height: 20, borderWidth: 1.5 }} />
                ) : isSpeaking ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                )}
              </button>
            )}
            {!message.streaming && onRegenerate && (
              <button
                onClick={() => onRegenerate(message.id)}
                className="inline-btn p-1.5 rounded-full active:scale-90 transition-all text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark"
                aria-label="Regenerate response"
                title="Regenerate"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
              </button>
            )}
            {!message.streaming && onBranch && (
              <button
                onClick={() => onBranch(message.id)}
                className="inline-btn p-1.5 rounded-full active:scale-90 transition-all text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark"
                aria-label="Branch conversation"
                title="Branch off"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
              </button>
            )}
            {!message.streaming && infoUnlocked && (message.model || message.usage) && (
              <div className="relative">
                <button
                  onClick={() => setInfoOpen((v) => !v)}
                  className="inline-btn p-1.5 rounded-full active:scale-90 transition-all text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark"
                  aria-label="Message info"
                  aria-expanded={infoOpen}
                  title="Message info"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                </button>
                <MessageInfoPopover open={infoOpen} onClose={() => setInfoOpen(false)} model={message.model} usage={message.usage} />
              </div>
            )}
          </div>
        )}
        {/* User message action buttons */}
        {isUser && message.content && isLastInGroup && (
          <div className="flex flex-col gap-0.5 flex-shrink-0 mb-0.5">
            {onStartEdit && (
              <button
                onClick={() => onStartEdit(message.id, message.content)}
                className={`inline-btn p-1.5 rounded-full active:scale-90 transition-all ${
                  isBeingEdited
                    ? 'text-accent'
                    : 'text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark'
                }`}
                aria-label="Edit message"
                title={isBeingEdited ? 'Editing in input field below' : 'Edit'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
