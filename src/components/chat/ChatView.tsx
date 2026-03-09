import { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'
import { useTTS } from '../../hooks/useTTS'
import type { Message } from '../../state/chat'

interface Props {
  messages: Message[]
}

export function ChatView({ messages }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const tts = useTTS()

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setAutoScroll(true)
  }, [])

  const prevMessagesLenRef = useRef(messages.length)
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMessagesLenRef.current = messages.length
  }, [messages, autoScroll])

  // Show "new messages" badge when not auto-scrolling and messages change
  const hasNewMessages = !autoScroll && messages.length > prevMessagesLenRef.current

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    setAutoScroll(atBottom)
  }, [])

  // Detect if last message is assistant with empty content (waiting for first token)
  const lastMsg = messages[messages.length - 1]
  const showTyping = lastMsg?.streaming && lastMsg.content === ''

  // Check if this is an empty/new conversation (only welcome message)
  const isEmptyChat = messages.length <= 1 && messages[0]?.id === 'msg-welcome'

  return (
    <div className="flex-1 relative overflow-hidden chat-bg">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto overscroll-none px-4 py-4 space-y-3"
        style={{ WebkitOverflowScrolling: 'touch' }}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {isEmptyChat ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 animate-[fadeSlideIn_0.4s_ease-out]">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold mb-4 shadow-lg shadow-violet-500/25">
              J
            </div>
            <h2 className="text-lg font-semibold text-text-light dark:text-text-dark mb-1">
              Hi, I'm Jane
            </h2>
            <p className="text-sm text-text-light-muted dark:text-text-dark-muted max-w-[260px]">
              Your OpenClaw assistant. Ask me anything, or tap the mic to talk.
            </p>
            <div className="flex gap-2 mt-6">
              {['What can you do?', 'Tell me a joke', 'Help me code'].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    // This is handled via the onSend prop we'll need to pass down
                    const event = new CustomEvent('clavus:send', { detail: suggestion })
                    window.dispatchEvent(event)
                  }}
                  className="inline-btn px-3 py-1.5 text-xs rounded-full border border-surface-light-3 dark:border-surface-dark-3 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 hover:text-text-light dark:hover:text-text-dark transition-all active:scale-95"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isSpeaking={tts.speakingId === msg.id}
                ttsLoading={tts.loading && tts.speakingId === msg.id}
                onSpeak={tts.speak}
              />
            ))}
            {showTyping && <TypingIndicator />}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {hasNewMessages && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-accent text-white text-xs font-medium shadow-lg shadow-accent/25 hover:bg-accent-hover active:scale-95 transition-all animate-[fadeSlideIn_0.2s_ease-out]"
          aria-label="Scroll to new messages"
        >
          New messages
        </button>
      )}
    </div>
  )
}
