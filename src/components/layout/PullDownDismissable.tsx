import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react'
import { haptic } from '../../lib/native'

interface PullDownDismissableProps {
  children: ReactNode
  tabId: string
  onDismiss: (tabId: string) => void
  enabled?: boolean
}

type Phase = 'idle' | 'undecided' | 'pulling-down' | 'horizontal' | 'vertical-scroll'

const THRESHOLD = 8       // px before committing to a direction
const DISMISS_THRESHOLD = 200 // raw px of finger pull to trigger dismiss

function rubberBand(distance: number): number {
  // Content follows finger at ~60% speed initially, decelerating further out.
  // At 200px raw the visual is ~140px — content always trails the finger.
  const dim = window.innerHeight
  return dim * (1 - Math.exp(-distance / dim)) * 0.6
}

export function PullDownDismissable({ children, tabId, onDismiss, enabled = true }: PullDownDismissableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<Phase>('idle')
  const startYRef = useRef(0)
  const startXRef = useRef(0)
  const currentTranslateRef = useRef(0)
  const rawDyRef = useRef(0)
  const animFrameRef = useRef(0)
  const [pastThreshold, setPastThreshold] = useState(false)
  const pastThresholdRef = useRef(false)

  const findScrollableAncestor = useCallback((target: EventTarget | null): HTMLElement | null => {
    let el = target as HTMLElement | null
    while (el && el !== containerRef.current) {
      // Already scrolled down — let native scroll handle it
      if (el.scrollTop > 0) return el
      // Element is scrollable (overflow auto/scroll) and has content to scroll into
      // — block pull-down so the editor's own scroll works naturally
      const overflow = getComputedStyle(el).overflowY
      if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        return el
      }
      el = el.parentElement
    }
    return null
  }, [])

  useEffect(() => {
    if (!enabled) return
    const container = containerRef.current
    if (!container) return

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      startYRef.current = t.clientY
      startXRef.current = t.clientX
      phaseRef.current = 'undecided'
      currentTranslateRef.current = 0
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const dy = t.clientY - startYRef.current
      const dx = t.clientX - startXRef.current

      if (phaseRef.current === 'undecided') {
        const ax = Math.abs(dx)
        const ay = Math.abs(dy)
        if (ax < THRESHOLD && ay < THRESHOLD) return

        if (ax > ay) {
          phaseRef.current = 'horizontal'
          return
        }

        if (dy > 0) {
          // Pulling down — check if inner content is at scrollTop === 0
          const scrollable = findScrollableAncestor(e.target)
          if (scrollable) {
            phaseRef.current = 'vertical-scroll'
            return
          }
          phaseRef.current = 'pulling-down'
          // Signal to global pull-to-refresh handler
          ;(window as any).__pullDownActive = true
        } else {
          phaseRef.current = 'vertical-scroll'
          return
        }
      }

      if (phaseRef.current === 'pulling-down') {
        if (e.cancelable) e.preventDefault()
        const rawDy = Math.max(0, t.clientY - startYRef.current)
        const translated = rubberBand(rawDy)
        currentTranslateRef.current = translated
        rawDyRef.current = rawDy
        const isPast = rawDy > DISMISS_THRESHOLD
        setPastThreshold(isPast)

        // Haptic feedback when crossing threshold
        if (isPast && !pastThresholdRef.current) {
          haptic.tap()
        }
        pastThresholdRef.current = isPast

        // Apply transform directly to DOM for 60fps
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = requestAnimationFrame(() => {
          if (!container) return
          const scale = 1 - (translated / window.innerHeight) * 0.15
          const opacity = 1 - (translated / window.innerHeight) * 0.5
          container.style.transform = `translateY(${translated}px) scale(${Math.max(0.85, scale)})`
          container.style.opacity = String(Math.max(0.3, opacity))
          container.style.borderRadius = translated > 10 ? '16px' : '0px'
        })
      }
    }

    const onTouchEnd = () => {
      ;(window as any).__pullDownActive = false

      if (phaseRef.current === 'pulling-down') {
        const translated = currentTranslateRef.current

        if (rawDyRef.current > DISMISS_THRESHOLD) {
          // Dismiss animation
          container.style.transition = 'transform 0.3s ease-in, opacity 0.3s ease-in'
          container.style.transform = `translateY(${window.innerHeight * 0.4}px) scale(0.7)`
          container.style.opacity = '0'
          container.addEventListener('transitionend', () => {
            // Reset styles
            container.style.transition = ''
            container.style.transform = ''
            container.style.opacity = ''
            container.style.borderRadius = ''
            onDismiss(tabId)
          }, { once: true })
        } else {
          // Spring back — cancel pending rAF, commit current position,
          // then animate to origin in the next frame
          cancelAnimationFrame(animFrameRef.current)
          // Force browser to commit the current translated position
          void container.offsetHeight
          container.classList.add('panel-spring-back')
          requestAnimationFrame(() => {
            container.style.transform = ''
            container.style.opacity = ''
            container.style.borderRadius = ''
          })

          const cleanup = () => {
            container.classList.remove('panel-spring-back')
          }
          container.addEventListener('transitionend', cleanup, { once: true })
          setTimeout(cleanup, 450)
        }
      }

      phaseRef.current = 'idle'
      currentTranslateRef.current = 0
      rawDyRef.current = 0
      setPastThreshold(false)
      pastThresholdRef.current = false
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd, { passive: true })
    container.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
      cancelAnimationFrame(animFrameRef.current)
      ;(window as any).__pullDownActive = false
    }
  }, [enabled, tabId, onDismiss, findScrollableAncestor])

  return (
    <div className="h-full flex flex-col min-h-0 relative">
      {/* "Release to archive" indicator — outside transformed container so it stays in place */}
      {pastThreshold && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1 rounded-full bg-red-500/80 text-white text-[11px] font-medium animate-[fadeSlideIn_0.15s_ease-out] pointer-events-none">
          Release to archive
        </div>
      )}
      <div ref={containerRef} className="h-full flex flex-col min-h-0" style={{ willChange: 'transform' }}>
        {children}
      </div>
    </div>
  )
}
