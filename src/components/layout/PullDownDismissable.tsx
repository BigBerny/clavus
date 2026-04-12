import { useRef, useCallback, useEffect, type ReactNode } from 'react'

interface PullDownDismissableProps {
  children: ReactNode
  tabId: string
  onDismiss: (tabId: string) => void
  enabled?: boolean
}

type Phase = 'idle' | 'undecided' | 'pulling-down' | 'horizontal' | 'vertical-scroll'

const THRESHOLD = 8       // px before committing to a direction
const DISMISS_THRESHOLD = 120 // px of pull to trigger dismiss
const DAMPING = 0.45      // rubber band damping factor

function rubberBand(distance: number): number {
  // Logarithmic rubber band for natural iOS-like feel
  return Math.log(distance * DAMPING + 1) * 80
}

export function PullDownDismissable({ children, tabId, onDismiss, enabled = true }: PullDownDismissableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<Phase>('idle')
  const startYRef = useRef(0)
  const startXRef = useRef(0)
  const currentTranslateRef = useRef(0)
  const animFrameRef = useRef(0)

  const findScrollableAncestor = useCallback((target: EventTarget | null): HTMLElement | null => {
    let el = target as HTMLElement | null
    while (el && el !== containerRef.current) {
      if (el.scrollTop > 0) return el
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

        if (translated > DISMISS_THRESHOLD) {
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
          // Spring back
          container.classList.add('panel-spring-back')
          container.style.transform = ''
          container.style.opacity = ''
          container.style.borderRadius = ''

          const cleanup = () => {
            container.classList.remove('panel-spring-back')
          }
          container.addEventListener('transitionend', cleanup, { once: true })
          // Fallback cleanup
          setTimeout(cleanup, 400)
        }
      }

      phaseRef.current = 'idle'
      currentTranslateRef.current = 0
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
    <div ref={containerRef} className="h-full flex flex-col min-h-0" style={{ willChange: 'transform' }}>
      {children}
    </div>
  )
}
