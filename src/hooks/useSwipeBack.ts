import { useRef, useState } from 'react'

/**
 * Swipe-back gesture for the desktop pager — a rightward drag anywhere on the
 * detail pane pages back to Home, mirroring the Clavus Desktop design's
 * coordinated pager (both panes move in lockstep with the drag).
 *
 * Ported from the design mockup's `useSwipeBack`. Drag starts lock to the
 * horizontal axis once |dx| clearly dominates |dy|; releasing past ~22% of
 * the pane width commits the back navigation.
 */
export function useSwipeBack(enabled: boolean, onBack: () => void) {
  const [dragFrac, setDragFrac] = useState(0) // 0 = detail front, 1 = home front
  const [dragging, setDragging] = useState(false)
  const st = useRef<{
    x: number
    y: number
    lock: 'x' | 'y' | null
    id: number
    el: HTMLElement
    w: number
  } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!enabled) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    // Don't hijack drags that start on interactive elements or message
    // content (protects text selection in bubbles / code blocks).
    const target = e.target as HTMLElement
    if (target.closest('button, a, textarea, input, select, [contenteditable], .prose, pre, code')) return
    st.current = {
      x: e.clientX,
      y: e.clientY,
      lock: null,
      id: e.pointerId,
      el: e.currentTarget,
      w: e.currentTarget.offsetWidth || 1,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const s = st.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (s.lock === null) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return
      s.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
      if (s.lock === 'x') {
        try { s.el.setPointerCapture(s.id) } catch { /* detached */ }
        setDragging(true)
      }
    }
    if (s.lock === 'x') {
      setDragFrac(Math.max(0, Math.min(1, dx / s.w)))
      if (e.cancelable) e.preventDefault()
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const s = st.current
    if (!s) return
    if (s.lock === 'x') {
      const frac = Math.max(0, (e.clientX - s.x) / s.w)
      try { s.el.releasePointerCapture(s.id) } catch { /* detached */ }
      const commit = frac > 0.22
      setDragging(false)
      setDragFrac(0)
      if (commit) onBack()
    }
    st.current = null
  }

  return {
    dragFrac,
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  }
}
