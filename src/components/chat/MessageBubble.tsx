import { memo, useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react'
import type { Message } from '../../state/chat'
import { ToolCallCards } from './ToolCallCard.tsx'
import { ButtonGroup, SelectBlock, ConfirmBlock, parseButtonsLine, parseSelectLine, type ButtonAction, type SelectOption } from './InteractiveBlock.tsx'

const RichMessageRenderer = lazy(() => import('./RichMessageRenderer.tsx').then(m => ({ default: m.RichMessageRenderer })))

// ─── Thinking Block ─────────────────────────────────────────────────────────

function ThinkingBlock({ thinking, isStreaming, defaultExpanded }: { thinking: string; isStreaming: boolean; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  // Auto-collapse when thinking is done (streaming stops)
  useEffect(() => {
    if (!isStreaming && expanded) {
      const timer = setTimeout(() => setExpanded(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isStreaming])

  // Auto-expand when streaming starts
  useEffect(() => {
    if (isStreaming) setExpanded(true)
  }, [isStreaming])

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-btn flex items-center gap-1.5 text-[12px] text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors"
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
          <span>Reasoning</span>
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 pl-4 border-l-2 border-text-light-muted/15 dark:border-text-dark-muted/15">
          <p className="text-[13px] text-text-light-muted/60 dark:text-text-dark-muted/60 whitespace-pre-wrap leading-relaxed" style={{ overflowWrap: 'break-word' }}>
            {thinking}
          </p>
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

  const handleCopy = useCallback(async () => {
    if (!contentRef.current) return
    try {
      const html = contentRef.current.innerHTML
      const plain = contentRef.current.innerText
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ])
    } catch {
      // Fallback: copy plain text
      navigator.clipboard.writeText(contentRef.current.innerText)
    }
    setCopied(true)
    navigator.vibrate?.(10)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  return (
    <div className="my-3 rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/8 overflow-hidden relative group/copy">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-accent/10">
        <span className="text-[11px] font-medium text-accent/60 uppercase tracking-wider">Output</span>
        <button
          onClick={handleCopy}
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
      <div ref={contentRef} className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none text-[15px] leading-[1.55] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
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
    // Render as a styled placeholder card for non-URL refs
    return (
      <div className="my-2 rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/8 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-accent/15">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent shrink-0"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
          <span className="text-[13px] font-medium text-accent truncate">{title || src}</span>
        </div>
        <div className="px-4 py-6 flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent/60"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
          </div>
          <span className="text-[12px] text-text-light-muted/50 dark:text-text-dark-muted/50">Interactive widget: {src}</span>
        </div>
      </div>
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

// Parse custom blocks from markdown content
function splitContentBlocks(content: string): ContentBlock[] {
  const parts: ContentBlock[] = []
  const lines = content.split('\n')
  let current = ''
  let inCopy = false
  let copyContent = ''

  let inConfirm = false
  let confirmContent = ''

  for (const line of lines) {
    // :::confirm block
    if (line.trim() === ':::confirm' && !inCopy && !inConfirm) {
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

interface Props {
  message: Message
  isSpeaking?: boolean
  ttsLoading?: boolean
  onSpeak?: (id: string, text: string) => void
  onRegenerate?: (messageId: string) => void
  showAvatar?: boolean
  isLastInGroup?: boolean
}

function relativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 10) return 'just now'
  if (diff < 60) return `${diff}s ago`
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function fullDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export const MessageBubble = memo(function MessageBubble({ message, isSpeaking, ttsLoading, onSpeak, onRegenerate, showAvatar = true, isLastInGroup = true }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isAssistant = message.role === 'assistant'

  // Hide empty assistant messages (no content, not streaming)
  if (isAssistant && !message.content?.trim() && !message.streaming && !message.thinking) {
    return null
  }
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
  const [showFullTime, setShowFullTime] = useState(false)
  const [relTime, setRelTime] = useState(() => relativeTime(message.timestamp))
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Update relative time periodically
  useEffect(() => {
    const interval = setInterval(() => setRelTime(relativeTime(message.timestamp)), 30000)
    return () => clearInterval(interval)
  }, [message.timestamp])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content)
    navigator.vibrate?.(10)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [message.content])

  // Long-press to copy on mobile
  const handleTouchStart = useCallback(() => {
    if (!message.content || message.streaming) return
    longPressTimer.current = setTimeout(() => {
      handleCopy()
    }, 500)
  }, [message.content, message.streaming, handleCopy])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const handleSpeak = useCallback(() => {
    onSpeak?.(message.id, message.content)
  }, [onSpeak, message.id, message.content])

  // System/error messages
  if (isSystem) {
    return (
      <div className="flex justify-center animate-[fadeSlideIn_0.3s_ease-out] py-0.5" role="status">
        <div className={`max-w-[85%] px-3.5 py-2 rounded-xl text-[12px] text-center leading-snug ${
          isError
            ? 'bg-red-500/8 text-red-500/90 dark:text-red-400/90 border border-red-500/15'
            : 'bg-surface-light-2/60 dark:bg-surface-dark-2/60 text-text-light-muted/70 dark:text-text-dark-muted/70'
        }`}>
          {isError ? (
            <div className="flex items-center justify-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-80"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>{message.content.replace(/^Error:\s*/, '')}</span>
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
      role="article"
      aria-label={`${isUser ? 'You' : 'Jane'}: ${message.content.slice(0, 80)}`}
    >
      <div className={`flex items-end gap-1 max-w-[95%] md:max-w-[750px] min-w-0 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <div
          className={`px-4 py-2.5 min-w-0 w-fit relative transition-[min-height] duration-200 ease-out ${message.streaming ? 'streaming-bubble' : ''} ${
            isUser
              ? `bg-gradient-to-br from-[#7B2FBE] to-[#9B59D0] text-white shadow-sm shadow-purple-500/15 ${
                  showAvatar && isLastInGroup ? 'rounded-[20px]' :
                  showAvatar ? 'rounded-[20px] rounded-br-[6px]' :
                  isLastInGroup ? 'rounded-[20px] rounded-tr-[6px]' :
                  'rounded-[20px] rounded-r-[6px]'
                }`
              : `bg-[#1E1F2B] text-text-light dark:text-text-dark shadow-sm shadow-black/10 ${
                  showAvatar && isLastInGroup ? 'rounded-[20px]' :
                  showAvatar ? 'rounded-[20px] rounded-bl-[6px]' :
                  isLastInGroup ? 'rounded-[20px] rounded-tl-[6px]' :
                  'rounded-[20px] rounded-l-[6px]'
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
                      <span className="text-sm">🔊</span>
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
                      <span className="text-sm">📎</span>
                      <span className="text-[13px] text-text-light-muted dark:text-text-dark-muted truncate">{m.title || 'Download'}</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {isUser ? (
            message.content ? (
              <p className="whitespace-pre-wrap text-[15px] leading-[1.55]" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>{message.content}</p>
            ) : null
          ) : message.streaming && !message.content && !message.thinking ? (
            <div className="flex items-center gap-[4px] py-0.5">
              <span className="w-[5px] h-[5px] rounded-full bg-text-light-muted/40 dark:bg-text-dark-muted/40 animate-[bounce_1.4s_ease-in-out_infinite]" />
              <span className="w-[5px] h-[5px] rounded-full bg-text-light-muted/40 dark:bg-text-dark-muted/40 animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
              <span className="w-[5px] h-[5px] rounded-full bg-text-light-muted/40 dark:bg-text-dark-muted/40 animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
            </div>
          ) : (
            <>
            {/* Thinking/Reasoning block */}
            {message.thinking && (
              <ThinkingBlock
                thinking={message.thinking}
                isStreaming={!!message.streaming && !message.thinkingDone}
                defaultExpanded={!!message.streaming && !message.thinkingDone}
              />
            )}
            {/* Tool call cards */}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <ToolCallCards toolCalls={message.toolCalls} />
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
                    return <RichMessageRenderer key={i} content={part.content} />
                  })
                ) : (
                  <RichMessageRenderer content={replyQuote ? replyQuote.rest : (message.content || ' ')} />
                )}
              </Suspense>
            </div>
          </>
          )}
          {/* Streaming cursor rendered via CSS ::after on .streaming-bubble .prose */}
          {/* Model info */}
          {isAssistant && !message.streaming && message.model && (
            <div className="mt-1 text-[10px] text-text-light-muted/30 dark:text-text-dark-muted/30 truncate">
              {message.model}
            </div>
          )}
        </div>
        {/* Copied toast */}
        {copied && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-accent/90 text-white text-[10px] font-medium animate-[fadeSlideIn_0.2s_ease-out] pointer-events-none">
            Copied
          </div>
        )}
        {/* Action buttons — next to bubble */}
        {isAssistant && !message.streaming && message.content && isLastInGroup && (
          <div className="flex flex-col gap-0.5 flex-shrink-0 mb-0.5">
            <button
              onClick={handleCopy}
              className={`inline-btn p-1.5 rounded-full active:scale-90 transition-all ${
                copied
                  ? 'text-emerald-500'
                  : 'text-text-light-muted/35 dark:text-text-dark-muted/35 hover:text-text-light-muted dark:hover:text-text-dark-muted'
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
                      : 'text-text-light-muted/35 dark:text-text-dark-muted/35 hover:text-text-light-muted dark:hover:text-text-dark-muted'
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
            {onRegenerate && (
              <button
                onClick={() => onRegenerate(message.id)}
                className="inline-btn p-1.5 rounded-full active:scale-90 transition-all text-text-light-muted/35 dark:text-text-dark-muted/35 hover:text-text-light-muted dark:hover:text-text-dark-muted"
                aria-label="Regenerate response"
                title="Regenerate"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
