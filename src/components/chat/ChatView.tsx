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

  // Check if this is an empty/new conversation
  const isEmptyChat = messages.length === 0

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
        className="h-full overflow-y-auto overscroll-none py-3 scroll-smooth"
        style={{ WebkitOverflowScrolling: 'touch' }}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        <div className={`max-w-[760px] mx-auto px-4 ${isEmptyChat ? 'h-full' : ''}`}>
        {isEmptyChat ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 animate-[fadeSlideIn_0.5s_ease-out]">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold mb-5 shadow-lg shadow-violet-500/20">
              J
            </div>
            <h2 className="text-xl font-semibold text-text-light dark:text-text-dark mb-1.5 tracking-tight">
              {(() => {
                const hour = new Date().getHours()
                if (hour < 5) return 'Late night, huh?'
                if (hour < 12) return 'Good morning!'
                if (hour < 17) return 'Good afternoon!'
                if (hour < 21) return 'Good evening!'
                return 'Late night, huh?'
              })()}
            </h2>
            <p className="text-sm text-text-light-muted dark:text-text-dark-muted max-w-[280px] leading-relaxed">
              I'm Jane, your AI assistant. Ask me anything, send images, or use voice.
            </p>
            <div className="grid grid-cols-2 gap-3 mt-8 w-full max-w-[320px]">
              {[
                { icon: '💡', text: 'What can you do?' },
                { icon: '✍️', text: 'Help me write' },
                { icon: '🔍', text: 'Explain a concept' },
                { icon: '💻', text: 'Help me code' },
              ].map(({ icon, text }, i) => (
                <button
                  key={text}
                  onClick={() => {
                    const event = new CustomEvent('clavus:send', { detail: text })
                    window.dispatchEvent(event)
                  }}
                  className="inline-btn flex items-center gap-2.5 p-4 text-sm text-left rounded-xl border border-surface-light-3/60 dark:border-surface-dark-3/60 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2/80 dark:hover:bg-surface-dark-2/80 hover:text-text-light dark:hover:text-text-dark hover:border-accent/25 transition-all active:scale-[0.97] animate-[fadeSlideIn_0.3s_ease-out_both]"
                  style={{ animationDelay: `${0.35 + i * 0.07}s` }}
                >
                  <span className="text-base">{icon}</span>
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
              // Show time gap separator for messages >30 min apart (same day)
              const timeGap = prevMsg && !showDate ? msg.timestamp - prevMsg.timestamp : 0
              const showTimeGap = timeGap > 30 * 60 * 1000 // 30 minutes
              // Show avatar only for first message in a group of same-role messages
              const showAvatar = !prevMsg || prevMsg.role !== msg.role || !!showDate || showTimeGap
              // Is last message in a group of same-role messages (for timestamp display)
              const nextTimeGap = nextMsg ? nextMsg.timestamp - msg.timestamp : 0
              const nextHasTimeGap = nextTimeGap > 30 * 60 * 1000
              const isLastInGroup = !nextMsg || nextMsg.role !== msg.role || (nextMsg && new Date(nextMsg.timestamp).toDateString() !== new Date(msg.timestamp).toDateString()) || nextHasTimeGap
              // Tighter spacing for consecutive same-role messages, wider for role transitions
              const isRoleTransition = prevMsg && prevMsg.role !== msg.role
              const spacing = !prevMsg ? '' : showDate ? 'mt-5' : showTimeGap ? 'mt-5' : isRoleTransition ? 'mt-4' : 'mt-1'
              return (
                <div key={msg.id} className={spacing}>
                  {showDate && (
                    <div className="flex items-center gap-3 py-1.5 mb-1">
                      <div className="flex-1 h-px bg-surface-light-3/40 dark:bg-surface-dark-3/40" />
                      <span className="text-[11px] text-text-light-muted/50 dark:text-text-dark-muted/50 font-medium tracking-wide uppercase">
                        {new Date(msg.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      <div className="flex-1 h-px bg-surface-light-3/40 dark:bg-surface-dark-3/40" />
                    </div>
                  )}
                  {showTimeGap && !showDate && (
                    <div className="flex justify-center py-1 mb-0.5">
                      <span className="text-[11px] text-text-light-muted/40 dark:text-text-dark-muted/40 font-medium">
                        {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
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
        </div>
        <div ref={bottomRef} className="h-2" />
      </div>

      {!autoScroll && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-3 right-4 flex items-center justify-center w-10 h-10 rounded-full bg-surface-light/95 dark:bg-surface-dark-2/95 text-text-light-muted dark:text-text-dark-muted shadow-lg shadow-black/10 dark:shadow-black/30 border border-surface-light-3/40 dark:border-surface-dark-3/40 backdrop-blur-sm hover:bg-surface-light-2 dark:hover:bg-surface-dark-3 active:scale-90 transition-all animate-[fadeSlideIn_0.2s_ease-out]"
          aria-label={unseenCount > 0 ? `${unseenCount} new messages` : 'Scroll to bottom'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m7 13 5 5 5-5"/><path d="M12 18V6"/></svg>
          {unseenCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full bg-accent text-white text-[11px] font-bold shadow-sm shadow-accent/30">
              {unseenCount > 99 ? '99+' : unseenCount}
            </span>
          )}
        </button>
      )}
    </div>
  )
}
