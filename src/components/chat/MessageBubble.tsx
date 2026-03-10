import { memo, useState, useCallback, useEffect } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Message } from '../../state/chat'

interface Props {
  message: Message
  isSpeaking?: boolean
  ttsLoading?: boolean
  onSpeak?: (id: string, text: string) => void
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
      <code className="px-1.5 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-[13px] font-mono" {...props}>
        {children}
      </code>
    )
  }
  return (
    <div className="relative group/code my-2 max-w-full">
      <button
        onClick={() => {
          const text = String(children).replace(/\n$/, '')
          navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="inline-btn absolute top-2 right-2 opacity-100 px-2 py-1 text-xs rounded-md bg-black/20 dark:bg-white/10 text-text-light-muted dark:text-text-dark-muted hover:text-text-light dark:hover:text-text-dark transition-colors backdrop-blur-sm z-10"
        aria-label="Copy code"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <code className={`${className} block overflow-x-auto p-4 rounded-xl bg-surface-light-2 dark:bg-[#141720] text-[13px] font-mono whitespace-pre leading-relaxed max-w-full`} {...props}>
        {children}
      </code>
    </div>
  )
}

const MARKSENSE_PATTERN = /mac-mini-von-janis\.taild2ad59\.ts\.net\/file\//

function MarksenseCard({ href }: { href: string }) {
  const filename = decodeURIComponent(href.split('/file/').pop() || 'Document')
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-4 py-3 my-2 rounded-xl bg-accent/10 dark:bg-accent/15 border border-accent/20 hover:bg-accent/20 dark:hover:bg-accent/25 transition-colors no-underline"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-accent truncate">{filename}</p>
        <p className="text-[11px] text-text-light-muted dark:text-text-dark-muted">Open in Marksense</p>
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted flex-shrink-0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </a>
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

export const MessageBubble = memo(function MessageBubble({ message, isSpeaking, ttsLoading, onSpeak }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isAssistant = message.role === 'assistant'
  const isError = isSystem && message.content.startsWith('Error:')
  const [copied, setCopied] = useState(false)
  const [showFullTime, setShowFullTime] = useState(false)
  const [relTime, setRelTime] = useState(() => relativeTime(message.timestamp))

  // Update relative time periodically
  useEffect(() => {
    const interval = setInterval(() => setRelTime(relativeTime(message.timestamp)), 30000)
    return () => clearInterval(interval)
  }, [message.timestamp])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [message.content])

  const handleSpeak = useCallback(() => {
    onSpeak?.(message.id, message.content)
  }, [onSpeak, message.id, message.content])

  // System/error messages
  if (isSystem) {
    return (
      <div className="flex justify-center animate-[fadeSlideIn_0.3s_ease-out]" role="status">
        <div className={`max-w-[90%] px-4 py-2 rounded-xl text-xs text-center ${
          isError
            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
            : 'bg-surface-light-2/80 dark:bg-surface-dark-2/80 text-text-light-muted dark:text-text-dark-muted'
        }`}>
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-[fadeSlideIn_0.3s_ease-out] group/msg`}
      role="article"
      aria-label={`${isUser ? 'You' : 'Jane'}: ${message.content.slice(0, 80)}`}
    >
      {/* Assistant avatar */}
      {isAssistant && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 shadow-sm">
          J
        </div>
      )}
      <div className={`flex flex-col gap-1 max-w-[85%] md:max-w-[70%] min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`px-4 py-2.5 overflow-hidden min-w-0 max-w-full ${
            isUser
              ? 'bg-accent text-white rounded-2xl rounded-br-lg shadow-sm shadow-accent/20'
              : 'bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark rounded-2xl rounded-bl-lg shadow-sm shadow-black/5 dark:shadow-black/20'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed select-text" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>{message.content}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 select-text overflow-hidden" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
              <Markdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{ code: CodeBlock, a: ExternalLink }}
              >
                {message.content || ' '}
              </Markdown>
            </div>
          )}
          {message.streaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse rounded-sm" aria-label="Typing" />
          )}
        </div>
        <div className={`flex items-center gap-2 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span
            className="text-[10px] text-text-light-muted/70 dark:text-text-dark-muted/70 cursor-pointer select-none"
            onClick={() => setShowFullTime((v) => !v)}
            title={fullDateTime(message.timestamp)}
          >
            {showFullTime ? fullDateTime(message.timestamp) : relTime}
          </span>
          {!message.streaming && message.content && (
            <button
              onClick={handleCopy}
              className="inline-btn opacity-0 group-hover/msg:opacity-100 text-[10px] text-text-light-muted dark:text-text-dark-muted hover:text-text-light dark:hover:text-text-dark transition-opacity"
              aria-label="Copy message"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}
          {/* TTS button for assistant messages */}
          {isAssistant && !message.streaming && message.content && onSpeak && (
            <button
              onClick={handleSpeak}
              className={`inline-btn opacity-0 group-hover/msg:opacity-100 p-0.5 rounded-md transition-all ${
                isSpeaking
                  ? '!opacity-100 text-accent'
                  : ttsLoading
                    ? '!opacity-100 text-text-dark-muted'
                    : 'text-text-light-muted dark:text-text-dark-muted hover:text-accent'
              }`}
              aria-label={isSpeaking ? 'Stop speaking' : 'Read aloud'}
              title={isSpeaking ? 'Stop' : 'Read aloud'}
            >
              {ttsLoading ? (
                <div className="voice-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
              ) : isSpeaking ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
