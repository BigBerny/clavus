import { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { useTTS } from '../../hooks/useTTS'
import { useThreadsStore } from '../../state/threads'
import type { Message } from '../../state/chat'

interface Props {
  messages: Message[]
}

// Cache scroll positions per thread
const scrollPositionCache = new Map<string, number>()

export function ChatView({ messages }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const tts = useTTS()

  const threadId = useThreadsStore((s) => s.activeThreadId)

  // Save scroll position on unmount
  useEffect(() => {
    return () => {
      if (containerRef.current && threadId) {
        scrollPositionCache.set(threadId, containerRef.current.scrollTop)
      }
    }
  }, [threadId])

  // Restore scroll position on mount (or scroll to bottom for new)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const savedPos = scrollPositionCache.get(threadId)
    if (savedPos !== undefined) {
      container.scrollTop = savedPos
      setAutoScroll(container.scrollHeight - savedPos - container.clientHeight < 100)
    } else {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [threadId])

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const target = container.scrollHeight - container.clientHeight
    const start = container.scrollTop
    const distance = target - start
    if (Math.abs(distance) < 10) {
      container.scrollTop = target
      setAutoScroll(true)
      return
    }
    const duration = 150 // ms
    const startTime = performance.now()
    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      container.scrollTop = start + distance * eased
      if (progress < 1) {
        requestAnimationFrame(step)
      }
    }
    requestAnimationFrame(step)
    setAutoScroll(true)
  }, [])

  const prevMessagesLenRef = useRef(messages.length)
  useEffect(() => {
    if (!autoScroll) {
      prevMessagesLenRef.current = messages.length
      return
    }
    // New message added → instant scroll; streaming → instant to keep up; otherwise smooth
    const isNewMessage = messages.length > prevMessagesLenRef.current
    const isActivelyStreaming = messages.some(m => m.streaming)
    const container = containerRef.current
    if (container) {
      // Double rAF ensures DOM is fully laid out (critical for iOS)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (containerRef.current) {
            // Use bottom sentinel to avoid iOS off-by-padding issues
            bottomRef.current?.scrollIntoView({ block: 'end' })
          }
        })
      })
    }
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
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    setAutoScroll(atBottom)
  }, [])

  // Check if this is an empty/new conversation
  const isEmptyChat = messages.length === 0

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden min-h-0 chat-bg">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onClick={(e) => {
          // Dismiss keyboard on tap, but not when clicking interactive elements
          const target = e.target as HTMLElement
          if (target.closest('button, a, [role="button"]')) return
          const active = document.activeElement as HTMLElement | null
          if (active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT') {
            active.blur()
          }
        }}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        <div className="max-w-[900px] mx-auto px-4 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 4rem)' }}>
        {isEmptyChat ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-text-light-muted/30 dark:text-text-dark-muted/30">New conversation</p>
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
            {/* Typing indicator removed — dots now render inside MessageBubble */}
          </>
        )}
        </div>
        <div ref={bottomRef} className="h-2" />
      </div>

      {!autoScroll && (
        <button
          onTouchStart={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); scrollToBottom() }}
          className="absolute bottom-2 right-3 flex items-center justify-center w-11 h-11 rounded-full bg-surface-light/95 dark:bg-surface-dark-2/95 text-text-light-muted dark:text-text-dark-muted shadow-lg shadow-black/10 dark:shadow-black/30 border border-surface-light-3/40 dark:border-surface-dark-3/40 backdrop-blur-sm hover:bg-surface-light-2 dark:hover:bg-surface-dark-3 active:scale-90 transition-all animate-[fadeSlideIn_0.2s_ease-out]"
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
