import { memo, useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Message } from '../../state/chat'

interface Props {
  message: Message
  isSpeaking: boolean
  onSpeak: (id: string, text: string) => void
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
  const isAssistant = message.role === 'assistant'

  const handleSpeak = useCallback(() => {
    onSpeak(message.id, message.content)
  }, [onSpeak, message.id, message.content])

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-[fadeIn_0.2s_ease-out]`}>
      <div className={`max-w-[85%] md:max-w-[70%] ${isUser ? '' : 'group/msg'}`}>
        <div
          className={`px-4 py-2.5 rounded-2xl ${
            isUser
              ? 'bg-accent text-white rounded-br-md'
              : 'bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark rounded-bl-md'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
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

        {/* TTS button for assistant messages */}
        {isAssistant && !message.streaming && message.content && (
          <div className="mt-1 ml-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
            <button
              onClick={handleSpeak}
              className={`p-1 rounded-md text-text-light-muted dark:text-text-dark-muted hover:text-accent transition-colors ${
                isSpeaking ? '!opacity-100 text-accent' : ''
              }`}
              title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
            >
              {isSpeaking ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
