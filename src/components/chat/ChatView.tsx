import { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { useTTS } from '../../hooks/useTTS'
import type { Message } from '../../state/chat'
import { useThreadsStore } from '../../state/threads'

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

export function ChatView({ messages, title, threadId, onRegenerate, onStartEdit, editingMessageId, onBranch }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const tts = useTTS()

  // Save scroll position on unmount
  useEffect(() => {
    return () => {
      if (containerRef.current && threadId) {
        persistScrollPosition(threadId, containerRef.current.scrollTop)
      }
    }
  }, [threadId])

  // Find the bottom edge of the last message in container scroll coordinates.
  // Used so "scroll to bottom" lands at the message edge, not in the spacer
  // area we added below the conversation.
  const getLastMessageBottom = useCallback((container: HTMLElement): number => {
    const els = container.querySelectorAll('[data-msg-id]')
    const lastEl = els[els.length - 1] as HTMLElement | undefined
    if (!lastEl) return container.scrollHeight - container.clientHeight
    const containerRect = container.getBoundingClientRect()
    const elRect = lastEl.getBoundingClientRect()
    const elBottomInScroll = elRect.bottom - containerRect.top + container.scrollTop
    // Leave just enough room under the input bar
    const inputBarPad = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--input-bar-h')) || 72
    const target = elBottomInScroll - container.clientHeight + inputBarPad + 16
    return Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight))
  }, [])

  const animateScrollTo = useCallback((container: HTMLElement, target: number, duration = 300) => {
    const start = container.scrollTop
    const distance = target - start
    if (Math.abs(distance) < 10) {
      container.scrollTop = target
      return
    }
    const startTime = performance.now()
    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      container.scrollTop = start + distance * eased
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [])

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    animateScrollTo(container, getLastMessageBottom(container))
    setAutoScroll(true)
  }, [animateScrollTo, getLastMessageBottom])

  const prevMessagesLenRef = useRef(messages.length)
  const prevLastMessageRef = useRef<string | null>(messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null)
  // Id of the latest user msg we have already reacted to. Only updates when
  // a fresh user send is detected (NOT every render) so a brand-new send
  // re-engages autoScroll even when it spans multiple React commits.
  const anchoredUserIdRef = useRef<string | null>(null)
  // Spacer height below the messages list. Sized to exactly what's needed so
  // the latest user message can reach the top of the viewport — no more, so
  // we don't leave a lot of empty space at the end of long conversations.
  const [spacerHeight, setSpacerHeight] = useState(0)

  // Restore scroll position on mount, or scroll to bottom by default
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const savedPos = getScrollPosition(threadId)
    if (savedPos !== undefined) {
      container.scrollTop = savedPos
      setAutoScroll(container.scrollHeight - savedPos - container.clientHeight < 50)
    } else {
      // Default: scroll to the bottom of the last message (not into the
      // empty spacer below it).
      requestAnimationFrame(() => {
        const c = containerRef.current
        if (!c) return
        c.scrollTop = getLastMessageBottom(c)
        setAutoScroll(true)
      })
    }
    // Reset turn tracking when switching threads so we don't treat an old
    // user msg as a fresh send.
    let mountUserId: string | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { mountUserId = messages[i].id; break }
    }
    anchoredUserIdRef.current = mountUserId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId])

  // Detect a fresh user send (vs. regeneration / streaming token / nothing
  // new) and re-engage autoScroll so the follow-tail effect below picks it
  // up even if the user had previously scrolled away.
  useEffect(() => {
    if (messages.length === 0) return
    let newestUserId: string | null = null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { newestUserId = messages[i].id; break }
    }
    if (newestUserId && newestUserId !== anchoredUserIdRef.current) {
      anchoredUserIdRef.current = newestUserId
      setAutoScroll(true)
    }
  }, [messages])

  // Follow the assistant as it streams: keep its tail visible at the bottom
  // of the viewport, but stop once the latest user message reaches the top.
  // Beyond that, the user reads manually — content overflows below.
  useEffect(() => {
    if (!autoScroll) return
    const container = containerRef.current
    if (!container) return

    const userEls = container.querySelectorAll('[data-msg-role="user"]')
    const lastUserEl = userEls[userEls.length - 1] as HTMLElement | undefined

    let target = getLastMessageBottom(container)
    if (lastUserEl) {
      // Don't scroll past the point where the user msg's top would slide
      // under the floating title pill.
      const containerRect = container.getBoundingClientRect()
      const userRect = lastUserEl.getBoundingClientRect()
      const userTopInScroll = userRect.top - containerRect.top + container.scrollTop
      const userTopCap = Math.max(0, userTopInScroll - 56)
      target = Math.min(target, userTopCap)
    }

    // Only scroll DOWN — never reverse the user's manual scroll-up.
    if (target > container.scrollTop + 1) {
      // Double rAF so the new content (and updated spacer) are laid out
      // before we sample / set scrollTop. Critical on iOS.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const c = containerRef.current
          if (!c) return
          // Re-evaluate inside rAF so we use the freshest layout.
          const userElsNow = c.querySelectorAll('[data-msg-role="user"]')
          const lastUserNow = userElsNow[userElsNow.length - 1] as HTMLElement | undefined
          let t = getLastMessageBottom(c)
          if (lastUserNow) {
            const cr = c.getBoundingClientRect()
            const ur = lastUserNow.getBoundingClientRect()
            const userTopNow = ur.top - cr.top + c.scrollTop
            t = Math.min(t, Math.max(0, userTopNow - 56))
          }
          if (t > c.scrollTop) c.scrollTop = t
        })
      })
    }
  }, [messages, autoScroll, getLastMessageBottom])

  useEffect(() => {
    prevMessagesLenRef.current = messages.length
    prevLastMessageRef.current = messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null
  }, [messages])

  // Recompute the bottom spacer's height so the latest user message can
  // reach the top of the viewport — but only as much as actually needed.
  // Recalculates on every message change AND on container resize (e.g. when
  // the assistant streams new content, making its bubble taller).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const compute = () => {
      const innerWrap = container.firstElementChild as HTMLElement | null
      if (!innerWrap) { setSpacerHeight(0); return }
      const userEls = innerWrap.querySelectorAll('[data-msg-role="user"]')
      const lastUserEl = userEls[userEls.length - 1] as HTMLElement | undefined
      if (!lastUserEl) { setSpacerHeight(0); return }
      // Distance from the top of the latest user message to the bottom of
      // the inner wrap (covers the user msg, anything after it, and the
      // wrap's padding-bottom). Use bounding rects so we don't depend on
      // offsetParent.
      const innerWrapRect = innerWrap.getBoundingClientRect()
      const lastUserRect = lastUserEl.getBoundingClientRect()
      const belowUserHeight = innerWrapRect.bottom - lastUserRect.top
      // 56px headroom matches the follow-tail cap (room for the floating
      // title pill at the top of the chat).
      const needed = container.clientHeight - 56 - belowUserHeight
      setSpacerHeight(Math.max(0, Math.round(needed)))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(container)
    const innerWrap = container.firstElementChild
    if (innerWrap) ro.observe(innerWrap as Element)
    return () => ro.disconnect()
  }, [messages])

  // Track count of unseen messages when scrolled up
  const unseenCountRef = useRef(0)
  if (!autoScroll && messages.length > prevMessagesLenRef.current) {
    unseenCountRef.current += messages.length - prevMessagesLenRef.current
  }
  if (autoScroll) {
    unseenCountRef.current = 0
  }
  const unseenCount = unseenCountRef.current

  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    // "At bottom" = the bottom of the last message is in view. The spacer
    // below intentionally extends past it, so scrollHeight is not the right
    // reference anymore.
    const atBottom = el.scrollTop >= getLastMessageBottom(el) - 50
    setAutoScroll(atBottom)
    // Debounced persist to sessionStorage (survives WKWebView process termination)
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current)
    scrollSaveTimer.current = setTimeout(() => {
      if (containerRef.current && threadId) {
        persistScrollPosition(threadId, containerRef.current.scrollTop)
      }
    }, 300)
  }, [threadId, getLastMessageBottom])

  // Keep autoScroll readable inside the ResizeObserver without re-subscribing
  const autoScrollRef = useRef(autoScroll)
  useEffect(() => {
    autoScrollRef.current = autoScroll
  }, [autoScroll])

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
        // Pin to the last message's bottom (not the absolute scroll end —
        // that would jump into the empty spacer below).
        el.scrollTop = getLastMessageBottom(el)
      }
      prevHeight = newHeight
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [getLastMessageBottom])

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
        <div className="absolute top-0 left-0 right-0 z-10 flex justify-center pointer-events-none md:hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}>
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
          </>
        )}
        </div>
        {/* Spacer: gives the latest user message just enough room to scroll
            to the top of the viewport. Sized dynamically so it shrinks to 0
            once the assistant response is tall enough on its own. */}
        {!isEmptyChat && spacerHeight > 0 && (
          <div aria-hidden style={{ height: spacerHeight }} />
        )}
        <div ref={bottomRef} className="h-2" />
      </div>

      {!autoScroll && (
        <button
          onTouchStart={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => { e.stopPropagation(); scrollToBottom() }}
          className="absolute right-3 z-20 flex items-center justify-center w-11 h-11 rounded-full glass text-muted-foreground active:scale-90 transition-all animate-[fadeSlideIn_0.2s_ease-out]"
          style={{ bottom: 'calc(var(--input-bar-h, 72px) + 0.5rem)' }}
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
