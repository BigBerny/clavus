import { useRef, useCallback, useState } from 'react'
import { useUIStore } from '../state/ui'
import { useThreadsStore, loadThreadMessages } from '../state/threads'
import { useChatStore } from '../state/chat'

const SWIPE_THRESHOLD = 80 // px to trigger snap
const VELOCITY_THRESHOLD = 0.4 // px/ms
const EDGE_RESISTANCE = 0.25 // resistance when no view in that direction
const SPRING_DURATION = 320 // ms for snap-back animation
const TRANSITION_DURATION = 280 // ms for view transition

type SwipeState = {
  offset: number
  isDragging: boolean
  isAnimating: boolean
}

export function useSwipeNavigation() {
  const startX = useRef(0)
  const startY = useRef(0)
  const startTime = useRef(0)
  const tracking = useRef(false)
  const directionLocked = useRef<'horizontal' | 'vertical' | null>(null)
  const lastMoveX = useRef(0)
  const lastMoveTime = useRef(0)
  const instantVelocity = useRef(0)

  const [swipeState, setSwipeState] = useState<SwipeState>({
    offset: 0,
    isDragging: false,
    isAnimating: false,
  })

  const canSwipe = useCallback((direction: 'left' | 'right'): boolean => {
    const currentView = useUIStore.getState().currentView
    const threads = useThreadsStore.getState().threads
    const activeThreadId = useThreadsStore.getState().activeThreadId

    const sortedThreads = [...threads]
      .filter(t => {
        const msgs = loadThreadMessages(t.id)
        return msgs.length > 0 || t.lastMessagePreview
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)

    if (currentView === 'home') {
      return direction === 'left' && sortedThreads.length > 0
    } else if (currentView === 'chat') {
      if (direction === 'right') return true // can always go to home or newer chat
      const currentIdx = sortedThreads.findIndex(t => t.id === activeThreadId)
      return currentIdx < sortedThreads.length - 1
    }
    return false
  }, [])

  const executeSwipe = useCallback((direction: 'left' | 'right') => {
    const currentView = useUIStore.getState().currentView
    const threads = useThreadsStore.getState().threads
    const activeThreadId = useThreadsStore.getState().activeThreadId
    const switchThread = useThreadsStore.getState().switchThread
    const loadThread = useChatStore.getState().loadThread
    const setCurrentView = useUIStore.getState().setCurrentView

    const sortedThreads = [...threads]
      .filter(t => {
        const msgs = loadThreadMessages(t.id)
        return msgs.length > 0 || t.lastMessagePreview
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)

    if (currentView === 'home') {
      if (direction === 'left' && sortedThreads.length > 0) {
        const latest = sortedThreads[0]
        switchThread(latest.id)
        loadThread(latest.id)
        setCurrentView('chat')
      }
    } else if (currentView === 'chat') {
      const currentIdx = sortedThreads.findIndex(t => t.id === activeThreadId)
      if (direction === 'right') {
        if (currentIdx <= 0) {
          setCurrentView('home')
        } else {
          const newer = sortedThreads[currentIdx - 1]
          switchThread(newer.id)
          loadThread(newer.id)
        }
      } else if (direction === 'left') {
        if (currentIdx < sortedThreads.length - 1) {
          const older = sortedThreads[currentIdx + 1]
          switchThread(older.id)
          loadThread(older.id)
        }
      }
    }
  }, [])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length > 1) return
    const target = e.target as HTMLElement
    if (target.closest('.image-preview-strip, pre, code, table, .compose-flow')) return

    // Only allow swipe on home/chat views
    const currentView = useUIStore.getState().currentView
    if (currentView !== 'home' && currentView !== 'chat') return

    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    startTime.current = Date.now()
    lastMoveX.current = e.touches[0].clientX
    lastMoveTime.current = Date.now()
    instantVelocity.current = 0
    tracking.current = true
    directionLocked.current = null
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!tracking.current) return

    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const deltaX = currentX - startX.current
    const deltaY = currentY - startY.current

    // Lock direction after 10px of movement
    if (!directionLocked.current) {
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        directionLocked.current = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical'
      }
      return
    }

    if (directionLocked.current === 'vertical') return

    // Prevent vertical scrolling while swiping horizontally
    e.preventDefault()

    // Calculate instantaneous velocity
    const now = Date.now()
    const dt = now - lastMoveTime.current
    if (dt > 0) {
      instantVelocity.current = (currentX - lastMoveX.current) / dt
    }
    lastMoveX.current = currentX
    lastMoveTime.current = now

    // Determine if we can swipe in this direction
    const direction = deltaX > 0 ? 'right' : 'left'
    const allowed = canSwipe(direction)

    // Apply resistance if can't swipe in this direction
    let offset = deltaX
    if (!allowed) {
      offset = deltaX * EDGE_RESISTANCE
    }

    setSwipeState({
      offset,
      isDragging: true,
      isAnimating: false,
    })
  }, [canSwipe])

  const onTouchEnd = useCallback(() => {
    if (!tracking.current || directionLocked.current !== 'horizontal') {
      tracking.current = false
      directionLocked.current = null
      setSwipeState({ offset: 0, isDragging: false, isAnimating: false })
      return
    }

    tracking.current = false
    directionLocked.current = null

    const finalOffset = swipeState.offset
    const direction: 'left' | 'right' = finalOffset > 0 ? 'right' : 'left'
    const velocity = Math.abs(instantVelocity.current)
    const distance = Math.abs(finalOffset)
    const allowed = canSwipe(direction)

    const shouldComplete = allowed && (
      distance > SWIPE_THRESHOLD ||
      (velocity > VELOCITY_THRESHOLD && distance > 20)
    )

    if (shouldComplete) {
      // Animate to full screen width in the swipe direction
      const screenWidth = window.innerWidth
      const targetOffset = direction === 'right' ? screenWidth : -screenWidth

      setSwipeState({
        offset: targetOffset,
        isDragging: false,
        isAnimating: true,
      })

      setTimeout(() => {
        executeSwipe(direction)
        setSwipeState({ offset: 0, isDragging: false, isAnimating: false })
      }, TRANSITION_DURATION)
    } else {
      // Spring back
      setSwipeState({
        offset: 0,
        isDragging: false,
        isAnimating: true,
      })
      setTimeout(() => {
        setSwipeState({ offset: 0, isDragging: false, isAnimating: false })
      }, SPRING_DURATION)
    }
  }, [swipeState.offset, canSwipe, executeSwipe])

  const swipeStyle: React.CSSProperties = {
    transform: swipeState.offset !== 0 ? `translateX(${swipeState.offset}px)` : undefined,
    transition: swipeState.isAnimating
      ? `transform ${swipeState.offset === 0 ? SPRING_DURATION : TRANSITION_DURATION}ms cubic-bezier(0.32, 0.72, 0, 1)`
      : swipeState.isDragging
        ? 'none'
        : undefined,
    willChange: swipeState.isDragging ? 'transform' : undefined,
  }

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    swipeStyle,
    isDragging: swipeState.isDragging,
  }
}
