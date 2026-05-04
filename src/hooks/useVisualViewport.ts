import { useEffect, useRef } from 'react'
import { isNative, subscribeKeyboard } from '../lib/native'

/**
 * Keyboard / viewport tracking.
 *
 * Two very different implementations depending on the runtime:
 *
 * - Capacitor / iOS WKWebView (`isNative`):
 *     The WebView is resized by the Capacitor keyboard plugin
 *     (`Keyboard.resize: 'native'`), so `100dvh` / `100vh` already reflect
 *     the visible area after the native resize. This hook deliberately does
 *     not set layout CSS variables or scroll the page on native; it only
 *     toggles `data-keyboard-open` for app logic such as chat auto-scroll.
 *
 * - iOS Safari PWA / web:
 *     The browser scrolls focused inputs into view, shifts
 *     `visualViewport.offsetTop`, and the URL bar behaviour makes
 *     `100vh` wrong. We track `visualViewport` and expose:
 *       --vvh          visible viewport height (defaults to 100dvh)
 *       --vv-offset    vertical scroll offset to compensate for
 *       data-keyboard-open  present when software keyboard is detected
 *     Also resets `window.scrollY` on keyboard close to clear iOS's
 *     residual scroll state.
 */
export function useVisualViewport() {
  const rafId = useRef(0)

  useEffect(() => {
    const root = document.documentElement

    // ---- Native (Capacitor): keyboard state only, zero layout JS ----
    if (isNative) {
      let unsub: (() => void) | null = null
      subscribeKeyboard({
        onWillShow: () => root.setAttribute('data-keyboard-open', 'true'),
        onWillHide: () => {
          root.removeAttribute('data-keyboard-open')
        },
        onDidHide: () => {
          root.removeAttribute('data-keyboard-open')
        },
      }).then((u) => {
        unsub = u
      })
      return () => {
        unsub?.()
        root.removeAttribute('data-keyboard-open')
      }
    }

    // ---- Web / iOS Safari PWA: visualViewport compensation ----
    const vv = window.visualViewport
    if (!vv) return

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
          if (window.scrollY !== 0) {
            window.scrollTo(0, 0)
          }
        }
      })
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)

    const handleOrientation = () => {
      setTimeout(update, 200)
    }
    window.addEventListener('orientationchange', handleOrientation)

    return () => {
      cancelAnimationFrame(rafId.current)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      window.removeEventListener('orientationchange', handleOrientation)
      root.style.removeProperty('--vvh')
      root.style.removeProperty('--vv-offset')
      root.removeAttribute('data-keyboard-open')
    }
  }, [])
}
