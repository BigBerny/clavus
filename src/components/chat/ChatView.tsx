import { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { useTTS } from '../../hooks/useTTS'
import { useThreadsStore } from '../../state/threads'
import type { Message } from '../../state/chat'

interface Props {
  messages: Message[]
  title?: string
}

// Cache scroll positions per thread
const scrollPositionCache = new Map<string, number>()

export function ChatView({ messages, title }: Props) {
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

  // Restore scroll position on mount, or scroll to bottom by default
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const savedPos = scrollPositionCache.get(threadId)
    if (savedPos !== undefined) {
      container.scrollTop = savedPos
      setAutoScroll(container.scrollHeight - savedPos - container.clientHeight < 100)
    } else {
      // Default: scroll to bottom (latest messages)
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight
          setAutoScroll(true)
        }
      })
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
    const duration = 300 // ms
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
  const prevLastMessageRef = useRef<string | null>(messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null)
  useEffect(() => {
    if (!autoScroll) {
      prevMessagesLenRef.current = messages.length
      prevLastMessageRef.current = messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null
      return
    }
    // Only scroll when messages actually changed (new message or content update)
    const currentLastId = messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null
    const messagesChanged = messages.length !== prevMessagesLenRef.current || currentLastId !== prevLastMessageRef.current
    const isActivelyStreaming = messages.some(m => m.streaming)
    if (!messagesChanged && !isActivelyStreaming) {
      prevMessagesLenRef.current = messages.length
      prevLastMessageRef.current = currentLastId
      return
    }
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
    prevLastMessageRef.current = currentLastId
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

  /**
   * THE iOS SAFARI SWIPE BUG FIX:
   * 
   * On iOS, even with `touch-action: pan-x`, if an element has `overflow-y: auto`, 
   * the gesture recognizer may "hand off" to the vertical scroll behavior 
   * if a vertical movement is detected first, even if scrollable=false.
   * 
   * This locks out the horizontal parent scroll-snap container.
   * 
   * FIX: We change the CSS `overflow` property to `visible` (instead of `auto` or `hidden`)
   * when the content doesn't need vertical scrolling. iOS Safari 15+ seems to 
   * only trigger the vertical scroll capture if the computed overflow includes 
   * a scroll capability.
   */
  const [isScrollable, setIsScrollable] = useState(false)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const check = () => {
      // 2px buffer to avoid rounding issues
      const scrollable = el.scrollHeight > el.clientHeight + 2
      setIsScrollable(scrollable)
    }
    // Check after layout settles
    requestAnimationFrame(check)
    const ro = new ResizeObserver(check)
    ro.observe(el)
    // Also check when child content changes
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [messages.length])

  // Direction-lock: when user swipes horizontally on a scrollable chat,
  // temporarily disable vertical scrolling so the parent snap container wins.
  // This prevents iOS Safari from "capturing" the gesture on the vertical scroller.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let startX = 0
    let startY = 0
    let locked: 'none' | 'h' | 'v' = 'none'

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      locked = 'none'
      el.style.overflowY = 'auto'
    }

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      if (locked !== 'none') {
        // Already decided direction
        if (locked === 'h') el.style.overflowY = 'hidden'
        return
      }
      const dx = Math.abs(e.touches[0].clientX - startX)
      const dy = Math.abs(e.touches[0].clientY - startY)
      if (dx < 8 && dy < 8) return
      locked = dx > dy ? 'h' : 'v'
      if (locked === 'h') el.style.overflowY = 'hidden'
    }

    const onEnd = () => {
      locked = 'none'
      el.style.overflowY = 'auto'
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  return (
    <div className="flex-1 flex flex-col relative min-h-0 chat-bg">
      {/* Floating title pill */}
      {title && (
        <div className="absolute top-0 left-0 right-0 z-10 flex justify-center pointer-events-none" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
          <div className="px-4 py-1.5 rounded-full bg-surface-light/70 dark:bg-surface-dark/70 backdrop-blur-xl border border-surface-light-3/30 dark:border-surface-dark-3/30 shadow-sm shadow-black/5">
            <span className="text-[13px] font-medium text-text-light/80 dark:text-text-dark/80 truncate max-w-[250px] block">{title}</span>
          </div>
        </div>
      )}
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
        className={`flex-1 min-h-0 ${isScrollable ? 'overflow-y-auto overscroll-y-contain' : 'overflow-y-visible'}`}
        style={{
          ...(isScrollable ? { WebkitOverflowScrolling: 'touch' } : {}),
          overflowX: 'visible',
          // Tell iOS: this container only handles vertical panning. 
          // Crucial: when not scrollable, touch-action must be 'auto' or 'pan-x pan-y' 
          // to let the parent horizontal scroll-snap take over the gesture.
          touchAction: 'auto',
        }}
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        <div className="max-w-[900px] mx-auto px-4 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3rem)' }}>
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
              const spacing = !prevMsg ? '' : isRoleTransition ? 'mt-2' : 'mt-0.5'
              return (
                <div key={msg.id} className={spacing}>
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
