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

  const scrollToBottom = useCallback((instant = false) => {
    bottomRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' })
    setAutoScroll(true)
  }, [])

  const prevMessagesLenRef = useRef(messages.length)
  useEffect(() => {
    if (!autoScroll) {
      prevMessagesLenRef.current = messages.length
      return
    }
    // New message added → instant scroll; streaming update → smooth scroll
    const isNewMessage = messages.length > prevMessagesLenRef.current
    bottomRef.current?.scrollIntoView({ behavior: isNewMessage ? 'instant' : 'smooth' })
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
        onClick={() => {
          // Tap to dismiss keyboard on mobile
          const active = document.activeElement as HTMLElement | null
          if (active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT') {
            active.blur()
          }
        }}
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
            <div className="flex flex-wrap justify-center gap-2 mt-6 max-w-[320px]">
              {['What can you do?', 'Tell me a joke', 'Help me code'].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    const event = new CustomEvent('clavus:send', { detail: suggestion })
                    window.dispatchEvent(event)
                  }}
                  className="inline-btn px-3.5 py-2 text-xs rounded-full border border-surface-light-3 dark:border-surface-dark-3 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 hover:text-text-light dark:hover:text-text-dark transition-all active:scale-95"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              // Show date separator when day changes between messages
              const prevMsg = idx > 0 ? messages[idx - 1] : null
              const showDate = prevMsg && new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString()
              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex items-center gap-3 py-2">
                      <div className="flex-1 h-px bg-surface-light-3/60 dark:bg-surface-dark-3/60" />
                      <span className="text-[10px] text-text-light-muted/60 dark:text-text-dark-muted/60 font-medium">
                        {new Date(msg.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      <div className="flex-1 h-px bg-surface-light-3/60 dark:bg-surface-dark-3/60" />
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    isSpeaking={tts.speakingId === msg.id}
                    ttsLoading={tts.loading && tts.speakingId === msg.id}
                    onSpeak={tts.speak}
                  />
                </div>
              )
            })}
            {showTyping && <TypingIndicator />}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {!autoScroll && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-surface-light dark:bg-surface-dark-2 text-text-light dark:text-text-dark text-xs font-medium shadow-lg border border-surface-light-3/60 dark:border-surface-dark-3/60 hover:bg-surface-light-2 dark:hover:bg-surface-dark-3 active:scale-95 transition-all animate-[fadeSlideIn_0.2s_ease-out]"
          aria-label="Scroll to bottom"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 13 5 5 5-5"/><path d="M12 18V6"/></svg>
          {hasNewMessages ? 'New messages' : 'Scroll down'}
        </button>
      )}
    </div>
  )
}
