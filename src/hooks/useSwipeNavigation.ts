import { useRef, useCallback, useEffect } from 'react'
import { useUIStore } from '../state/ui'
import { useThreadsStore, loadThreadMessages } from '../state/threads'
import { useChatStore } from '../state/chat'

const SWIPE_THRESHOLD = 50 // minimum px to trigger
const SWIPE_VELOCITY_THRESHOLD = 0.3 // px/ms

export function useSwipeNavigation() {
  const startX = useRef(0)
  const startY = useRef(0)
  const startTime = useRef(0)
  const tracking = useRef(false)

  const handleSwipe = useCallback((direction: 'left' | 'right') => {
    const currentView = useUIStore.getState().currentView
    const threads = useThreadsStore.getState().threads
    const activeThreadId = useThreadsStore.getState().activeThreadId
    const switchThread = useThreadsStore.getState().switchThread
    const loadThread = useChatStore.getState().loadThread
    const setCurrentView = useUIStore.getState().setCurrentView

    // Get sorted threads (newest first), filter to those with messages
    const sortedThreads = [...threads]
      .filter(t => {
        const msgs = loadThreadMessages(t.id)
        return msgs.length > 0 || t.lastMessagePreview
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)

    if (currentView === 'home') {
      // Home is rightmost. Swipe left → go to latest conversation
      if (direction === 'left' && sortedThreads.length > 0) {
        const latest = sortedThreads[0]
        switchThread(latest.id)
        loadThread(latest.id)
        setCurrentView('chat')
      }
      // Swipe right from home → nothing (already rightmost)
    } else if (currentView === 'chat') {
      const currentIdx = sortedThreads.findIndex(t => t.id === activeThreadId)

      if (direction === 'right') {
        // Swipe right → go to newer conversation or Home
        if (currentIdx <= 0) {
          // Already at newest → go to Home
          setCurrentView('home')
        } else {
          // Go to newer conversation
          const newer = sortedThreads[currentIdx - 1]
          switchThread(newer.id)
          loadThread(newer.id)
        }
      } else if (direction === 'left') {
        // Swipe left → go to older conversation
        if (currentIdx < sortedThreads.length - 1) {
          const older = sortedThreads[currentIdx + 1]
          switchThread(older.id)
          loadThread(older.id)
        }
        // If already at oldest → nothing
      }
    }
  }, [])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Don't interfere with multi-touch or horizontal scrollable elements
    if (e.touches.length > 1) return
    const target = e.target as HTMLElement
    // Skip if inside a horizontally scrollable element
    if (target.closest('.image-preview-strip, pre, code, table')) return
    
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    startTime.current = Date.now()
    tracking.current = true
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!tracking.current) return
    tracking.current = false

    const endX = e.changedTouches[0].clientX
    const endY = e.changedTouches[0].clientY
    const deltaX = endX - startX.current
    const deltaY = endY - startY.current
    const elapsed = Date.now() - startTime.current

    // Must be primarily horizontal
    if (Math.abs(deltaY) > Math.abs(deltaX) * 0.7) return
    // Must exceed threshold
    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return
    // Check velocity
    const velocity = Math.abs(deltaX) / elapsed
    if (velocity < SWIPE_VELOCITY_THRESHOLD && Math.abs(deltaX) < 100) return

    handleSwipe(deltaX > 0 ? 'right' : 'left')
  }, [handleSwipe])

  return { onTouchStart, onTouchEnd }
}
