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

  // Track count of unseen messages when scrolled up
  const unseenCountRef = useRef(0)
  if (!autoScroll && messages.length > prevMessagesLenRef.current) {
    unseenCountRef.current += messages.length - prevMessagesLenRef.current
  }
  if (autoScroll) {
    unseenCountRef.current = 0
  }
  const unseenCount = unseenCountRef.current

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
    <div className="flex-1 relative overflow-hidden chat-bg chat-fade-top animate-[chatFadeIn_0.25s_ease-out]">
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
        className="h-full overflow-y-auto overscroll-none px-4 py-4"
        style={{ WebkitOverflowScrolling: 'touch' }}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {isEmptyChat ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 animate-[fadeSlideIn_0.4s_ease-out]">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xl font-bold mb-4 shadow-lg shadow-violet-500/25">
              J
            </div>
            <h2 className="text-lg font-semibold text-text-light dark:text-text-dark mb-1">
              Hi, I'm Jane
            </h2>
            <p className="text-[13px] text-text-light-muted dark:text-text-dark-muted max-w-[280px] leading-relaxed">
              Your OpenClaw assistant. Ask me anything, send images, or tap the mic to talk.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-6 w-full max-w-[320px]">
              {[
                { icon: '💡', text: 'What can you do?' },
                { icon: '✍️', text: 'Help me write something' },
                { icon: '🔍', text: 'Explain a concept' },
                { icon: '💻', text: 'Help me code' },
              ].map(({ icon, text }, i) => (
                <button
                  key={text}
                  onClick={() => {
                    const event = new CustomEvent('clavus:send', { detail: text })
                    window.dispatchEvent(event)
                  }}
                  className="inline-btn flex items-center gap-2 px-3 py-2.5 text-xs text-left rounded-xl border border-surface-light-3/80 dark:border-surface-dark-3/80 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 hover:text-text-light dark:hover:text-text-dark hover:border-accent/30 transition-all active:scale-[0.97] animate-[fadeSlideIn_0.3s_ease-out_both]"
                  style={{ animationDelay: `${0.3 + i * 0.08}s` }}
                >
                  <span className="text-sm">{icon}</span>
                  <span>{text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const prevMsg = idx > 0 ? messages[idx - 1] : null
              const nextMsg = idx < messages.length - 1 ? messages[idx + 1] : null
              // Show date separator when day changes between messages
              const showDate = prevMsg && new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString()
              // Show avatar only for first message in a group of same-role messages
              const showAvatar = !prevMsg || prevMsg.role !== msg.role || !!showDate
              // Is last message in a group of same-role messages (for timestamp display)
              const isLastInGroup = !nextMsg || nextMsg.role !== msg.role || (nextMsg && new Date(nextMsg.timestamp).toDateString() !== new Date(msg.timestamp).toDateString())
              // Tighter spacing for consecutive same-role messages, wider for role transitions
              const isRoleTransition = prevMsg && prevMsg.role !== msg.role
              const spacing = !prevMsg ? '' : showDate ? 'mt-4' : isRoleTransition ? 'mt-3' : 'mt-1'
              return (
                <div key={msg.id} className={spacing}>
                  {showDate && (
                    <div className="flex items-center gap-3 py-2 mb-1">
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
                    showAvatar={showAvatar}
                    isLastInGroup={isLastInGroup}
                  />
                </div>
              )
            })}
            {showTyping && <TypingIndicator />}
          </>
        )}
        <div ref={bottomRef} className="h-2" />
      </div>

      {!autoScroll && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-surface-light dark:bg-surface-dark-2 text-text-light dark:text-text-dark text-xs font-medium shadow-lg border border-surface-light-3/60 dark:border-surface-dark-3/60 hover:bg-surface-light-2 dark:hover:bg-surface-dark-3 active:scale-95 transition-all animate-[fadeSlideIn_0.2s_ease-out]"
          aria-label="Scroll to bottom"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 13 5 5 5-5"/><path d="M12 18V6"/></svg>
          {unseenCount > 0 ? `${unseenCount} new` : 'Scroll down'}
        </button>
      )}
    </div>
  )
}
