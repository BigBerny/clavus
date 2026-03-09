import { memo, useState, useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Message } from '../../state/chat'

interface Props {
  message: Message
  isSpeaking?: boolean
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

function CodeBlock({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) {
  const isInline = !className
  if (isInline) {
    return (
      <code className="px-1.5 py-0.5 rounded bg-surface-light-3 dark:bg-surface-dark-3 text-sm font-mono" {...props}>
        {children}
      </code>
    )
  }
  return (
    <div className="relative group my-2">
      <button
        onClick={() => {
          const text = String(children).replace(/\n$/, '')
          navigator.clipboard.writeText(text)
        }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 px-2 py-1 text-xs rounded bg-surface-dark-3/80 text-text-dark-muted hover:text-text-dark transition-opacity"
      >
        Copy
      </button>
      <code className={`${className} block overflow-x-auto p-4 rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 text-sm font-mono`} {...props}>
        {children}
      </code>
    </div>
  )
}

export const MessageBubble = memo(function MessageBubble({ message, isSpeaking, onSpeak }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const isAssistant = message.role === 'assistant'
  const isError = isSystem && message.content.startsWith('Error:')
  const [copied, setCopied] = useState(false)

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
      <div className="flex justify-center animate-[fadeSlideIn_0.3s_ease-out]">
        <div className={`max-w-[90%] px-4 py-2 rounded-lg text-xs text-center ${
          isError
            ? 'bg-red-500/10 text-red-400 border border-red-500/20'
            : 'bg-surface-light-2 dark:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted'
        }`}>
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-[fadeSlideIn_0.3s_ease-out] group/msg`}>
      <div className="flex flex-col gap-1 max-w-[85%] md:max-w-[70%]">
        <div
          className={`px-4 py-2.5 rounded-2xl ${
            isUser
              ? 'bg-accent text-white rounded-br-md'
              : 'bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark rounded-bl-md'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed select-text">{message.content}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 select-text">
              <Markdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{ code: CodeBlock }}
              >
                {message.content || ' '}
              </Markdown>
            </div>
          )}
          {message.streaming && (
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
          )}
        </div>
        <div className={`flex items-center gap-2 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-text-light-muted dark:text-text-dark-muted">
            {relativeTime(message.timestamp)}
          </span>
          {!message.streaming && message.content && (
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover/msg:opacity-100 text-[10px] text-text-light-muted dark:text-text-dark-muted hover:text-text-light dark:hover:text-text-dark transition-opacity"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}
          {/* TTS button for assistant messages */}
          {isAssistant && !message.streaming && message.content && onSpeak && (
            <button
              onClick={handleSpeak}
              className={`opacity-0 group-hover/msg:opacity-100 p-0.5 rounded text-text-light-muted dark:text-text-dark-muted hover:text-accent transition-opacity ${
                isSpeaking ? '!opacity-100 text-accent' : ''
              }`}
              title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
            >
              {isSpeaking ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
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
