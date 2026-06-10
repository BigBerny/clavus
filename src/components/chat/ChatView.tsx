import { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import type { Message } from '../../state/chat'
import { useThreadsStore } from '../../state/threads'
import { useRecordingStore } from '../../state/recording'

interface Props {
  messages: Message[]
  title?: string
  threadId: string
  onRegenerate?: (assistantMessageId: string) => void
  /** Begin editing this user message — content is loaded into the main InputBar. */
  onStartEdit?: (messageId: string, content: string) => void
  /** The id of the message currently being edited in the InputBar, if any. */
  editingMessageId?: string | null
  onBranch?: (messageId: string) => void
}

// Cache scroll positions per thread (in-memory + sessionStorage for reload survival)
const scrollPositionCache = new Map<string, number>()
const SCROLL_STORAGE_PREFIX = 'clavus-scroll-'

function persistScrollPosition(threadId: string, scrollTop: number) {
  scrollPositionCache.set(threadId, scrollTop)
  try { sessionStorage.setItem(SCROLL_STORAGE_PREFIX + threadId, String(scrollTop)) } catch { /* full */ }
}

function getScrollPosition(threadId: string): number | undefined {
  const mem = scrollPositionCache.get(threadId)
  if (mem !== undefined) return mem
  try {
    const stored = sessionStorage.getItem(SCROLL_STORAGE_PREFIX + threadId)
    if (stored !== null) return Number(stored)
  } catch { /* unavailable */ }
  return undefined
}

function getLatestUserMessageId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].id
  }
  return null
}

function getLatestStreamingAssistantId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.streaming) return msg.id
  }
  return null
}

function getLatestVisibleMessageId(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'system') continue
    if (
      msg.role === 'assistant'
      && !msg.content.trim()
      && !msg.streaming
      && !msg.thinking
      && !msg.toolCalls?.length
    ) {
      continue
    }
    return msg.id
  }
  return null
}

function findMessageElement(container: HTMLElement, messageId: string): HTMLElement | null {
  const els = container.querySelectorAll<HTMLElement>('[data-msg-id]')
  for (const el of els) {
    if (el.dataset.msgId === messageId) return el
  }
  return null
}

function getElementTopInScroll(container: HTMLElement, el: HTMLElement): number {
  const containerRect = container.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  return elRect.top - containerRect.top + container.scrollTop
}

function getTopLockOffset(container: HTMLElement): number {
  const title = container.parentElement?.querySelector<HTMLElement>('[data-chat-title-pill]')
  if (!title) return 0
  const style = window.getComputedStyle(title)
  if (style.display === 'none' || style.visibility === 'hidden') return 0

  const containerRect = container.getBoundingClientRect()
  const titleRect = title.getBoundingClientRect()
  const titleBottom = titleRect.bottom - containerRect.top
  return titleBottom > 0 ? Math.ceil(titleBottom + 8) : 0
}

function FavoriteButton({ threadId }: { threadId: string }) {
  const isFavorite = useThreadsStore((s) => s.threads.find((t) => t.id === threadId)?.favorite)
  const toggleFavorite = useThreadsStore((s) => s.toggleFavorite)
  return (
    <button
      onClick={() => toggleFavorite(threadId)}
      className={`inline-btn shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
        isFavorite ? 'text-amber-500' : 'text-foreground/30 hover:text-amber-500'
      }`}
      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    </button>
  )
}

function TranscribingMessageBubble() {
  return (
    <div
      className="mt-2 flex justify-end animate-[fadeSlideIn_0.3s_ease-out]"
      role="status"
      aria-label="Transcribing voice message"
      data-transcribing-bubble
    >
      <div className="flex items-end gap-1 max-w-[95%] md:max-w-[750px] min-w-0 flex-row-reverse">
        <div className="glass-user text-foreground/85 rounded-[16px] rounded-br-[5px] px-3.5 py-2 min-w-[10.5rem]">
          <div className="flex items-center gap-2">
            <div className="voice-spinner shrink-0" aria-hidden="true" />
            <span className="text-[15px] leading-[1.55]">Transcribing...</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ChatView({ messages, title, threadId, onRegenerate, onStartEdit, editingMessageId, onBranch }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const recordingState = useRecordingStore((s) => s.state)
  const recordingTargetThreadId = useRecordingStore((s) => s.targetThreadId)
  const isTranscribingForThread = recordingState === 'transcribing' && recordingTargetThreadId === threadId
  const latestUserIdRef = useRef<string | null>(getLatestUserMessageId(messages))
  const streamingAssistantIdRef = useRef<string | null>(getLatestStreamingAssistantId(messages))
  const manualBottomStreamingIdRef = useRef<string | null>(null)
  const programmaticScrollRef = useRef(false)
  const programmaticScrollMarkRef = useRef(0)
  const forceAutoScrollRef = useRef(false)
  const latestMessagesRef = useRef(messages)

  useEffect(() => {
    latestMessagesRef.current = messages
  }, [messages])

  useEffect(() => {
    const currentMessages = latestMessagesRef.current
    latestUserIdRef.current = getLatestUserMessageId(currentMessages)
    streamingAssistantIdRef.current = getLatestStreamingAssistantId(currentMessages)
    manualBottomStreamingIdRef.current = null
  }, [threadId])

  // Save scroll position on unmount
  useEffect(() => {
    const container = containerRef.current
    return () => {
      if (container && threadId) {
        persistScrollPosition(threadId, container.scrollTop)
      }
    }
  }, [threadId])

  // Restore scroll position on mount, or scroll to bottom by default
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const savedPos = getScrollPosition(threadId)
    if (savedPos !== undefined) {
      container.scrollTop = savedPos
      setAutoScroll(container.scrollHeight - savedPos - container.clientHeight < 50)
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

  const getAutoScrollTarget = useCallback((container: HTMLElement, streamingAssistantId: string | null) => {
    const maxTarget = Math.max(0, container.scrollHeight - container.clientHeight)
    if (!streamingAssistantId || manualBottomStreamingIdRef.current === streamingAssistantId) {
      return { target: maxTarget, capped: false }
    }

    const assistantEl = findMessageElement(container, streamingAssistantId)
    if (!assistantEl) return { target: maxTarget, capped: false }

    const cap = Math.max(0, getElementTopInScroll(container, assistantEl) - getTopLockOffset(container))
    const capped = maxTarget > cap + 1
    return { target: capped ? cap : maxTarget, capped }
  }, [])

  const setProgrammaticScrollTop = useCallback((container: HTMLElement, scrollTop: number) => {
    const mark = programmaticScrollMarkRef.current + 1
    programmaticScrollMarkRef.current = mark
    programmaticScrollRef.current = true
    container.scrollTop = scrollTop
    window.setTimeout(() => {
      if (programmaticScrollMarkRef.current === mark) {
        programmaticScrollRef.current = false
      }
    }, 120)
  }, [])

  const scrollToLatestMessageStart = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    manualBottomStreamingIdRef.current = null
    const maxTarget = Math.max(0, container.scrollHeight - container.clientHeight)
    const latestMessageId = getLatestVisibleMessageId(messages)
    const latestMessageEl = latestMessageId ? findMessageElement(container, latestMessageId) : null
    const target = latestMessageEl
      ? Math.min(maxTarget, Math.max(0, getElementTopInScroll(container, latestMessageEl) - getTopLockOffset(container)))
      : maxTarget
    const start = container.scrollTop
    const distance = target - start
    if (Math.abs(distance) < 10) {
      setProgrammaticScrollTop(container, target)
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
      setProgrammaticScrollTop(container, start + distance * eased)
      if (progress < 1) {
        requestAnimationFrame(step)
      }
    }
    requestAnimationFrame(step)
    setAutoScroll(true)
  }, [messages, setProgrammaticScrollTop])

  const activeStreamingAssistantId = getLatestStreamingAssistantId(messages)
  const prevMessagesLenRef = useRef(messages.length)
  const prevLastMessageRef = useRef<string | null>(messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null)

  useEffect(() => {
    const latestUserId = getLatestUserMessageId(messages)
    if (latestUserId && latestUserId !== latestUserIdRef.current) {
      latestUserIdRef.current = latestUserId
      manualBottomStreamingIdRef.current = null
      forceAutoScrollRef.current = true
    }
  }, [messages])

  useEffect(() => {
    if (activeStreamingAssistantId !== streamingAssistantIdRef.current) {
      streamingAssistantIdRef.current = activeStreamingAssistantId
      manualBottomStreamingIdRef.current = null
    }
  }, [activeStreamingAssistantId])

  useEffect(() => {
    const forceAutoScroll = forceAutoScrollRef.current
    if (!autoScroll && !forceAutoScroll) {
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
          const c = containerRef.current
          if (!c) return
          const { target, capped } = getAutoScrollTarget(c, activeStreamingAssistantId)
          // Scroll only this container, and only downward, so manual reading
          // position is never pulled back toward an earlier anchor point.
          if (target > c.scrollTop + 1) {
            setProgrammaticScrollTop(c, target)
          }
          const shouldStopAtReplyStart = capped && manualBottomStreamingIdRef.current !== activeStreamingAssistantId
          if (forceAutoScrollRef.current) {
            forceAutoScrollRef.current = false
            if (!shouldStopAtReplyStart) {
              setAutoScroll(true)
            }
          }
          if (shouldStopAtReplyStart) {
            setAutoScroll(false)
          }
        })
      })
    }
    prevMessagesLenRef.current = messages.length
    prevLastMessageRef.current = currentLastId
  }, [messages, autoScroll, activeStreamingAssistantId, getAutoScrollTarget, setProgrammaticScrollTop])

  // Track count of unseen messages when scrolled up
  const [unseenCount, setUnseenCount] = useState(0)
  const unseenMessagesLenRef = useRef(messages.length)
  useEffect(() => {
    if (!autoScroll && messages.length > unseenMessagesLenRef.current) {
      setUnseenCount((count) => count + messages.length - unseenMessagesLenRef.current)
    } else if (autoScroll) {
      setUnseenCount(0)
    }
    unseenMessagesLenRef.current = messages.length
  }, [messages.length, autoScroll])

  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (programmaticScrollRef.current) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    if (activeStreamingAssistantId) {
      manualBottomStreamingIdRef.current = atBottom ? activeStreamingAssistantId : null
    }
    setAutoScroll(atBottom)
    // Debounced persist to sessionStorage (survives WKWebView process termination)
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current)
    scrollSaveTimer.current = setTimeout(() => {
      if (containerRef.current && threadId) {
        persistScrollPosition(threadId, containerRef.current.scrollTop)
      }
    }, 300)
  }, [threadId, activeStreamingAssistantId])

  // Keep autoScroll readable inside the ResizeObserver without re-subscribing
  const autoScrollRef = useRef(autoScroll)
  useEffect(() => {
    autoScrollRef.current = autoScroll
  }, [autoScroll])

  useEffect(() => {
    if (!isTranscribingForThread) return
    const el = containerRef.current
    if (!el) return
    const activeStreamingId = streamingAssistantIdRef.current
    if (activeStreamingId) {
      manualBottomStreamingIdRef.current = activeStreamingId
    }
    requestAnimationFrame(() => {
      const c = containerRef.current
      if (!c) return
      setProgrammaticScrollTop(c, Math.max(0, c.scrollHeight - c.clientHeight))
      setAutoScroll(true)
    })
  }, [isTranscribingForThread, setProgrammaticScrollTop])

  // Keep the conversation glued to the bottom while the messages container
  // shrinks during keyboard expansion. ResizeObserver fires before paint, so
  // setting scrollTop here happens in the SAME visual frame as the height
  // change — making the input bar and the bottom of the conversation appear
  // to move together (instead of the input bar racing ahead).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let prevHeight = el.clientHeight
    const observer = new ResizeObserver(() => {
      const newHeight = el.clientHeight
      if (newHeight !== prevHeight && autoScrollRef.current && el.scrollTop > 10) {
        // Pin to bottom whenever the container resizes while user was at
        // bottom — works for both keyboard open (shrink) and close (grow).
        const { target, capped } = getAutoScrollTarget(el, streamingAssistantIdRef.current)
        setProgrammaticScrollTop(el, target)
        if (capped && manualBottomStreamingIdRef.current !== streamingAssistantIdRef.current) {
          setAutoScroll(false)
        }
      }
      prevHeight = newHeight
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [getAutoScrollTarget, setProgrammaticScrollTop])

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
      {/* Floating title pill (mobile-only) */}
      {title && (
        <div data-chat-title-pill className="absolute top-0 left-0 right-0 z-10 flex justify-center pointer-events-none md:hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
          <div className="px-3.5 py-1.5 rounded-full glass flex items-center gap-1.5 pointer-events-auto">
            <span className="text-[12px] font-medium text-text-light dark:text-text-dark truncate max-w-[220px] block">{title}</span>
            <FavoriteButton threadId={threadId} />
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
        <div className="max-w-[900px] mx-auto px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3rem)', paddingBottom: 'calc(var(--input-bar-h, 72px) + 0.5rem)' }}>
        {isEmptyChat && !isTranscribingForThread ? (
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
                <div key={msg.id} data-msg-id={msg.id} data-msg-role={msg.role} className={spacing}>
                  <MessageBubble
                    message={msg}
                    showAvatar={showAvatar}
                    isLastInGroup={isLastInGroup}
                    threadId={threadId}
                    onRegenerate={onRegenerate}
                    onStartEdit={onStartEdit}
                    isBeingEdited={editingMessageId === msg.id}
                    onBranch={onBranch}
                  />
                </div>
              )
            })}
            {isTranscribingForThread && <TranscribingMessageBubble />}
          </>
        )}
        </div>
        <div ref={bottomRef} className="h-2" />
      </div>

      {!autoScroll && (
        <button
          onTouchStart={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); scrollToLatestMessageStart() }}
          className="absolute right-3 z-20 flex items-center justify-center w-11 h-11 rounded-full glass text-muted-foreground active:scale-90 transition-all animate-[fadeSlideIn_0.2s_ease-out]"
          style={{ bottom: 'calc(var(--input-bar-h, 72px) + 0.5rem)' }}
          aria-label={unseenCount > 0 ? `${unseenCount} new messages` : 'Scroll to latest message'}
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
