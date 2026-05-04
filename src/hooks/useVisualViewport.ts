import { useEffect, useRef } from 'react'
import { isNative, subscribeKeyboard } from '../lib/native'

/**
 * Keyboard / viewport tracking.
 *
 * Two very different implementations depending on the runtime:
 *
 * - Capacitor / iOS WKWebView (`isNative`):
 *     The WebView shrinks itself when the keyboard opens (Capacitor
 *     `Keyboard.resize: 'native'`), so `100dvh` / `100vh` already reflect
 *     the visible area. We do NOT touch any CSS variables or scroll
 *     positions — the native resize does the layout work. The hook's
 *     sole responsibility is toggling `data-keyboard-open` via the
 *     deterministic `keyboardWillShow` / `keyboardWillHide` events so
 *     the app (chat auto-scroll, etc.) can react.
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

    // ---- Native (Capacitor with Keyboard.resize: 'none') ----
    //
    // `keyboardWillShow` fires BEFORE iOS begins the keyboard animation
    // and provides the final keyboard height. We set `--kb-height` in the
    // same frame so the CSS rule in index.css (see `html[data-native]`)
    // shrinks #root instantly. A short CSS transition on #root height
    // keeps the motion smooth without adding perceivable delay.
    if (isNative) {
      root.style.setProperty('--kb-height', '0px')
      let unsub: (() => void) | null = null
      subscribeKeyboard({
        onWillShow: (h) => {
          root.style.setProperty('--kb-height', `${h}px`)
          root.setAttribute('data-keyboard-open', 'true')
        },
        onDidShow: (h) => {
          root.style.setProperty('--kb-height', `${h}px`)
        },
        onWillHide: () => {
          root.style.setProperty('--kb-height', '0px')
          root.removeAttribute('data-keyboard-open')
        },
        onDidHide: () => {
          root.style.setProperty('--kb-height', '0px')
          root.removeAttribute('data-keyboard-open')
        },
      }).then((u) => {
        unsub = u
      })
      return () => {
        unsub?.()
        root.style.removeProperty('--kb-height')
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
