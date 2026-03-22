import { memo, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Message } from '../../state/chat'

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
          <p className="text-[13px] text-text-light-muted/60 dark:text-text-dark-muted/60 whitespace-pre-wrap leading-relaxed select-text" style={{ overflowWrap: 'break-word' }}>
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
      <div ref={contentRef} className="px-4 py-3 prose prose-sm dark:prose-invert max-w-none text-[15px] leading-[1.55] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 select-text">
        <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
      </div>
    </div>
  )
}

// Parse :::copy blocks from markdown content
function splitCopyBlocks(content: string): Array<{ type: 'text' | 'copy'; content: string }> {
  const parts: Array<{ type: 'text' | 'copy'; content: string }> = []
  const lines = content.split('\n')
  let current = ''
  let inCopy = false
  let copyContent = ''

  for (const line of lines) {
    if (line.trim() === ':::copy' && !inCopy) {
      if (current.trim()) parts.push({ type: 'text', content: current })
      current = ''
      inCopy = true
      copyContent = ''
    } else if (line.trim() === ':::' && inCopy) {
      parts.push({ type: 'copy', content: copyContent.trim() })
      copyContent = ''
      inCopy = false
    } else if (inCopy) {
      copyContent += line + '\n'
    } else {
      current += line + '\n'
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

interface Props {
  message: Message
  isSpeaking?: boolean
  ttsLoading?: boolean
  onSpeak?: (id: string, text: string) => void
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

function CodeBlock({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) {
  const [copied, setCopied] = useState(false)
  const isInline = !className
  if (isInline) {
    return (
      <code className="px-1.5 py-0.5 rounded-md bg-black/[0.05] dark:bg-white/[0.08] text-[13px] font-mono" {...props}>
        {children}
      </code>
    )
  }
  // Extract language from className (e.g. "hljs language-python" → "python")
  const langMatch = className?.match(/language-(\w+)/)
  const lang = langMatch?.[1]
  return (
    <div className="relative group/code my-2.5 -mx-1 max-w-[calc(100%+0.5rem)]">
      <div className="flex items-center justify-between px-3 py-1.5 rounded-t-xl bg-surface-light-3/50 dark:bg-[#0d0f14] border-b border-surface-light-3/30 dark:border-white/[0.04]">
        <span className="text-[11px] font-medium text-text-light-muted/60 dark:text-text-dark-muted/50 uppercase tracking-wider">
          {lang || 'code'}
        </span>
        <button
          onClick={() => {
            const text = String(children).replace(/\n$/, '')
            navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="inline-btn px-2 py-0.5 text-[11px] rounded-md text-text-light-muted/60 dark:text-text-dark-muted/50 hover:text-text-light dark:hover:text-text-dark transition-colors"
          aria-label="Copy code"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <code className={`${className} block overflow-x-auto p-3 rounded-b-xl bg-surface-light-2/80 dark:bg-[#141720] text-[13px] font-mono whitespace-pre leading-[1.65] max-w-full`} style={{ WebkitOverflowScrolling: 'touch' }} {...props}>
        {children}
      </code>
    </div>
  )
}

const MARKSENSE_PATTERN = /mac-mini-von-janis\.taild2ad59\.ts\.net\/file\//

function MarksenseCard({ href }: { href: string }) {
  const filename = decodeURIComponent(href.split('/file/').pop() || 'Document')
  const [content, setContent] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const filePath = href.split('/file/').pop()
    if (!filePath) return
    setLoading(true)
    fetch(`/marksense/file/${filePath}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed')
        return res.text()
      })
      .then(text => {
        setContent(text)
        setLoading(false)
      })
      .catch(() => {
        setFailed(true)
        setLoading(false)
      })
  }, [href])

  // Fallback to link card if fetch failed
  if (failed) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 my-2 rounded-xl bg-accent/10 dark:bg-accent/15 border border-accent/20 hover:bg-accent/20 dark:hover:bg-accent/25 transition-colors no-underline">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-accent truncate">{filename}</p>
          <p className="text-[12px] text-text-light-muted dark:text-text-dark-muted">Open in Marksense</p>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted flex-shrink-0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
    )
  }

  const lines = content?.split('\n') || []
  const isLong = lines.length > 12
  const displayContent = expanded ? content || '' : lines.slice(0, 10).join('\n')

  return (
    <div className="my-2 rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/8 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-accent/15">
        <div className="flex items-center gap-2 min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span className="text-[13px] font-medium text-accent truncate">{filename}</span>
        </div>
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-btn flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-light-muted dark:text-text-dark-muted hover:text-accent transition-colors no-underline whitespace-nowrap">
          Open
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
      </div>
      {/* Content */}
      <div className="px-4 py-3">
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <div className="voice-spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
            <span className="text-[12px] text-text-light-muted dark:text-text-dark-muted">Loading...</span>
          </div>
        ) : (
          <>
            <div className={`prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${!expanded && isLong ? 'max-h-[200px] overflow-hidden relative' : ''}`}>
              <Markdown remarkPlugins={[remarkGfm]}>{displayContent}</Markdown>
              {!expanded && isLong && (
                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-accent/5 dark:from-accent/8 to-transparent pointer-events-none" />
              )}
            </div>
            {isLong && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="inline-btn mt-2 text-[12px] text-accent hover:text-accent/80 font-medium transition-colors"
              >
                {expanded ? 'Show less' : `Show more (${lines.length} lines)`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ExternalLink({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) {
  if (href && MARKSENSE_PATTERN.test(href)) {
    return <MarksenseCard href={href} />
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline"
      {...props}
    >
      {children}
    </a>
  )
}

export const MessageBubble = memo(function MessageBubble({ message, isSpeaking, ttsLoading, onSpeak, showAvatar = true, isLastInGroup = true }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isAssistant = message.role === 'assistant'
  const contentParts = useMemo(() => 
    isAssistant ? splitCopyBlocks(message.content) : [],
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
      {/* Assistant avatar (or spacer for grouped messages) */}
      {isAssistant && (
        showAvatar ? (
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-[#9333EA] to-[#B855F5] flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 shadow-sm shadow-purple-500/20">
            J
          </div>
        ) : (
          <div className="flex-shrink-0 w-7 mr-2" />
        )
      )}
      <div className={`flex flex-col gap-1 max-w-[78%] md:max-w-[65%] min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`px-4 py-2.5 min-w-0 max-w-full transition-[min-height] duration-200 ease-out ${message.streaming ? 'streaming-bubble' : ''} ${
            isUser
              ? `bg-gradient-to-br from-[rgba(130,60,210,0.78)] to-[rgba(155,85,235,0.78)] backdrop-blur-[20px] text-white shadow-sm shadow-purple-500/15 border border-purple-300/[0.12] ${
                  showAvatar && isLastInGroup ? 'rounded-[20px]' :
                  showAvatar ? 'rounded-[20px] rounded-br-[6px]' :
                  isLastInGroup ? 'rounded-[20px] rounded-tr-[6px]' :
                  'rounded-[20px] rounded-r-[6px]'
                }`
              : `bg-[rgba(33,33,45,0.72)] backdrop-blur-[20px] text-text-light dark:text-text-dark shadow-sm shadow-black/15 border border-white/[0.08] ${
                  showAvatar && isLastInGroup ? 'rounded-[20px]' :
                  showAvatar ? 'rounded-[20px] rounded-bl-[6px]' :
                  isLastInGroup ? 'rounded-[20px] rounded-tl-[6px]' :
                  'rounded-[20px] rounded-l-[6px]'
                }`
          }`}
        >
          {/* Image attachments */}
          {message.images && message.images.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 ${message.content ? 'mb-2' : ''}`}>
              {message.images.map((img, i) => (
                <a key={i} href={img} target="_blank" rel="noopener noreferrer" className="block rounded-lg overflow-hidden max-w-[200px]">
                  <img src={img} alt={`Image ${i + 1}`} className="max-w-full h-auto rounded-lg" loading="lazy" />
                </a>
              ))}
            </div>
          )}
          {isUser ? (
            message.content ? (
              <p className="whitespace-pre-wrap text-[15px] leading-[1.55] select-text" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>{message.content}</p>
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
            <div className="prose prose-sm dark:prose-invert max-w-none text-[15px] leading-[1.55] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 select-text overflow-x-auto overflow-y-hidden" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
              {contentParts.length > 1 || contentParts.some(p => p.type === 'copy') ? (
                contentParts.map((part, i) =>
                  part.type === 'copy' ? (
                    <CopyableBlock key={i}>{part.content}</CopyableBlock>
                  ) : (
                    <Markdown
                      key={i}
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                      components={{ code: CodeBlock, a: ExternalLink }}
                    >
                      {part.content}
                    </Markdown>
                  )
                )
              ) : (
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  components={{ code: CodeBlock, a: ExternalLink }}
                >
                  {message.content || ' '}
                </Markdown>
              )}
            </div>
          </>
          )}
          {/* Streaming cursor rendered via CSS ::after on .streaming-bubble .prose */}
        </div>
        {/* Metadata row: timestamp + direct action buttons */}
        <div className={`flex items-center gap-1.5 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span
            className={`text-[11px] text-text-light-muted/55 dark:text-text-dark-muted/55 cursor-pointer select-none hover:text-text-light-muted dark:hover:text-text-dark-muted transition-all ${
              isLastInGroup || message.streaming ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100'
            }`}
            onClick={() => setShowFullTime((v) => !v)}
            title={fullDateTime(message.timestamp)}
          >
            {showFullTime ? fullDateTime(message.timestamp) : relTime}
          </span>
          {/* Direct action buttons — always visible for assistant messages */}
          {!message.streaming && message.content && (
            <>
              <button
                onClick={handleCopy}
                className="inline-btn p-2 rounded-lg text-text-light-muted/50 dark:text-text-dark-muted/50 hover:text-text-light-muted dark:hover:text-text-dark-muted hover:bg-surface-light-2/80 dark:hover:bg-surface-dark-2/80 active:scale-90 transition-all"
                aria-label={copied ? 'Copied' : 'Copy message'}
                title={copied ? 'Copied!' : 'Copy'}
              >
                {copied ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent"><polyline points="20 6 9 17 4 12"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                )}
              </button>
              {isAssistant && onSpeak && (
                <button
                  onClick={handleSpeak}
                  className={`inline-btn p-2 rounded-lg active:scale-90 transition-all ${
                    isSpeaking
                      ? 'text-accent hover:text-accent/80'
                      : ttsLoading
                        ? 'text-text-light-muted/40 dark:text-text-dark-muted/40'
                        : 'text-text-light-muted/50 dark:text-text-dark-muted/50 hover:text-text-light-muted dark:hover:text-text-dark-muted hover:bg-surface-light-2/80 dark:hover:bg-surface-dark-2/80'
                  }`}
                  aria-label={isSpeaking ? 'Stop speaking' : 'Listen to message'}
                  title={isSpeaking ? 'Stop' : 'Listen'}
                >
                  {ttsLoading ? (
                    <div className="voice-spinner" style={{ width: 18, height: 18, borderWidth: 1.5 }} />
                  ) : isSpeaking ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
})
