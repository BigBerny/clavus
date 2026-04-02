import { useEffect, useRef } from 'react'

/**
 * Tracks the visual viewport on iOS Safari PWA and sets CSS custom properties
 * on document.documentElement:
 *   --vvh: visible viewport height (falls back to 100dvh)
 *   --vv-offset: iOS keyboard scroll offset (falls back to 0px)
 *   data-keyboard-open: "true" when software keyboard is detected
 *
 * Also resets window scroll position when the keyboard closes (iOS quirk).
 */
export function useVisualViewport() {
  const rafId = useRef(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const root = document.documentElement
    const KEYBOARD_THRESHOLD = 150 // px difference → keyboard is open

    const update = () => {
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const height = vv.height
        const offset = vv.offsetTop

        root.style.setProperty('--vvh', `${height}px`)
        root.style.setProperty('--vv-offset', `${offset}px`)

        const keyboardOpen = window.innerHeight - height > KEYBOARD_THRESHOLD
        if (keyboardOpen) {
          root.setAttribute('data-keyboard-open', 'true')
        } else {
          root.removeAttribute('data-keyboard-open')
          // Reset iOS scroll position when keyboard closes
          if (window.scrollY !== 0) {
            window.scrollTo(0, 0)
          }
        }
      })
    }

    // Run once immediately
    update()

    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)

    // Orientation change: delayed update since viewport takes time to settle
    const handleOrientation = () => {
      setTimeout(update, 200)
    }
    window.addEventListener('orientationchange', handleOrientation)

    return () => {
      cancelAnimationFrame(rafId.current)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      window.removeEventListener('orientationchange', handleOrientation)
      // Clean up CSS vars
      root.style.removeProperty('--vvh')
      root.style.removeProperty('--vv-offset')
      root.removeAttribute('data-keyboard-open')
    }
  }, [])
}
