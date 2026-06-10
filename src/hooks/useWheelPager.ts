import { useEffect, useRef, useState } from 'react'

interface Opts {
  enabled: boolean
  /** Is the detail (chat) pane currently front? */
  detailFront: boolean
  /** Commit back-to-home (two-finger swipe right on the conversation). */
  onBack: () => void
  /** Open the most recent conversation (two-finger swipe left on Home). */
  onForward: () => void
}

/**
 * Trackpad two-finger swipe for the desktop pager — the native macOS gesture
 * (horizontal wheel events), complementing the pointer-drag swipe-back.
 *
 * On the conversation: swiping right tracks the gesture 1:1 (panes follow the
 * fingers, mockup-style) and commits back to Home past ~22% of the width.
 * On Home: a leftward flick (> 60px) pages forward into the most recent
 * conversation via the regular slide-in.
 */
export function useWheelPager(
  ref: React.RefObject<HTMLDivElement | null>,
  { enabled, detailFront, onBack, onForward }: Opts,
) {
  const [frac, setFrac] = useState(0) // 0 = detail front … 1 = home front
  const [active, setActive] = useState(false)
  const accum = useRef(0)
  const activeRef = useRef(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const forwardLock = useRef(false)
  const cbs = useRef({ detailFront, onBack, onForward })
  cbs.current = { detailFront, onBack, onForward }

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    const settle = () => {
      settleTimer.current = null
      forwardLock.current = false
      if (!activeRef.current) {
        accum.current = 0
        return
      }
      const width = el.offsetWidth || 1
      const commit = accum.current / width > 0.22
      accum.current = 0
      activeRef.current = false
      setActive(false)
      setFrac(0)
      if (commit) cbs.current.onBack()
    }

    const scheduleSettle = (ms: number) => {
      if (settleTimer.current) clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(settle, ms)
    }

    const onWheel = (e: WheelEvent) => {
      // Horizontal intent only — vertical scrolling stays untouched.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return
      // Don't hijack horizontal scrolling inside code blocks / tables.
      let n = e.target as HTMLElement | null
      while (n && n !== el) {
        if (n.scrollWidth > n.clientWidth + 1) {
          const ox = getComputedStyle(n).overflowX
          if (ox === 'auto' || ox === 'scroll') return
        }
        n = n.parentElement
      }

      if (cbs.current.detailFront) {
        // Natural scrolling: two-finger swipe right → deltaX < 0 → back.
        accum.current = Math.max(0, accum.current - e.deltaX)
        const width = el.offsetWidth || 1
        if (accum.current > 2) {
          activeRef.current = true
          setActive(true)
          setFrac(Math.max(0, Math.min(1, accum.current / width)))
          if (e.cancelable) e.preventDefault()
        }
        // Momentum events keep arriving after the fingers lift; the gesture
        // is "done" once they stop for a beat.
        scheduleSettle(140)
      } else {
        // Home: leftward flick (deltaX > 0) opens the latest conversation.
        if (forwardLock.current) return
        accum.current = Math.max(0, accum.current + e.deltaX)
        if (accum.current > 60) {
          forwardLock.current = true
          accum.current = 0
          cbs.current.onForward()
          scheduleSettle(500) // swallow the gesture's momentum tail
        }
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (settleTimer.current) clearTimeout(settleTimer.current)
      accum.current = 0
      activeRef.current = false
    }
  }, [ref, enabled])

  return { frac, active }
}
