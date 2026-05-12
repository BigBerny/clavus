import { useEffect, useRef } from 'react'
import { isNative, subscribeKeyboard } from '../lib/native'

/**
 * Keyboard state tracking + smooth layout compensation.
 *
 * On iOS Safari with `interactive-widget=resizes-content`, the layout viewport
 * only shrinks at the END of the keyboard animation, so `100dvh` content
 * appears to slide out of view during the animation and the input bar lags
 * behind the keyboard's top edge. We compensate by tracking
 * `visualViewport.height` (which updates continuously during the animation)
 * and exposing it as a CSS variable `--kb-inset` so layout can follow the
 * keyboard frame-by-frame.
 *
 * Also toggles `data-keyboard-open` on <html> for legacy callers that branch
 * on keyboard state.
 *
 * - Capacitor: listens to native keyboard plugin events.
 * - Web / iOS Safari PWA: drives `--kb-inset` from `visualViewport`.
 */
export function useVisualViewport() {
  const rafId = useRef(0)

  useEffect(() => {
    const root = document.documentElement

    // ---- Native (Capacitor): drive --kb-inset from the keyboard plugin ----
    // In the Capacitor WKWebView, `visualViewport` doesn't change on keyboard
    // show (the keyboard sits outside the webview). Use the native plugin's
    // willShow/willHide events, which expose the final keyboard height, and
    // let CSS animate `#root` height via a transition keyed to data-native.
    //
    // Self-detection: if the native shell (MainViewController.swift) is ALSO
    // resizing the webview frame on keyboard show, `innerHeight` will drop
    // when the keyboard appears. Applying `--kb-inset` on top of that
    // collapses `#root` to almost zero. After we observe the first show, we
    // switch to "let native handle it" mode so subsequent shows aren't broken.
    if (isNative) {
      let unsub: (() => void) | null = null
      let nativeAlsoResizes = false
      let heightBeforeShow = 0
      subscribeKeyboard({
        onWillShow: (kbHeight) => {
          heightBeforeShow = window.innerHeight
          root.setAttribute('data-keyboard-open', 'true')
          // If we've already detected the native shell is resizing the webview,
          // leave layout to native (avoids double-shrink).
          if (nativeAlsoResizes) {
            root.style.setProperty('--kb-inset', '0px')
          } else {
            root.style.setProperty('--kb-inset', `${kbHeight}px`)
          }
        },
        onDidShow: (kbHeight) => {
          const drop = heightBeforeShow - window.innerHeight
          // Threshold: a significant innerHeight drop means the native shell
          // resized the webview itself. Switch modes for next time.
          if (drop > 50) {
            nativeAlsoResizes = true
            // Compensate now so this show isn't broken either.
            const compensated = Math.max(0, kbHeight - drop)
            root.style.setProperty('--kb-inset', `${compensated}px`)
          }
        },
        onWillHide: () => {
          root.removeAttribute('data-keyboard-open')
          root.style.setProperty('--kb-inset', '0px')
        },
        onDidHide: () => {
          root.removeAttribute('data-keyboard-open')
          root.style.setProperty('--kb-inset', '0px')
        },
      }).then((u) => {
        unsub = u
      })
      return () => {
        unsub?.()
        root.removeAttribute('data-keyboard-open')
        root.style.removeProperty('--kb-inset')
      }
    }

    // ---- Web / iOS Safari PWA: drive --kb-inset from visualViewport ----
    const vv = window.visualViewport
    if (!vv) return

    const KEYBOARD_THRESHOLD = 150 // px difference → keyboard is open

    // Track the maximum innerHeight we've observed in the current orientation.
    // With `interactive-widget=resizes-content`, innerHeight stays at full
    // height during the keyboard animation, then shrinks to match vv.height
    // at the end. Comparing current innerHeight to this baseline lets us
    // detect "keyboard logically open" even after innerHeight catches up
    // (when kbInset would otherwise read 0).
    let maxInnerHeight = window.innerHeight

    const update = () => {
      cancelAnimationFrame(rafId.current)
      rafId.current = requestAnimationFrame(() => {
        const innerH = window.innerHeight
        if (innerH > maxInnerHeight) maxInnerHeight = innerH
        // Space at the bottom of the layout viewport covered by the keyboard.
        // Updates on every visualViewport resize/scroll, so the layout can
        // animate in lockstep with the keyboard slide.
        const kbInset = Math.max(0, innerH - vv.height - vv.offsetTop)
        root.style.setProperty('--kb-inset', `${kbInset}px`)
        const keyboardOpen =
          kbInset > KEYBOARD_THRESHOLD ||
          maxInnerHeight - innerH > KEYBOARD_THRESHOLD
        if (keyboardOpen) {
          root.setAttribute('data-keyboard-open', 'true')
        } else {
          root.removeAttribute('data-keyboard-open')
        }
      })
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)

    const handleOrientation = () => {
      // Reset the baseline so the new orientation's full height becomes the
      // reference for "keyboard open" detection.
      maxInnerHeight = 0
      setTimeout(update, 200)
    }
    window.addEventListener('orientationchange', handleOrientation)

    return () => {
      cancelAnimationFrame(rafId.current)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      window.removeEventListener('orientationchange', handleOrientation)
      root.removeAttribute('data-keyboard-open')
      root.style.removeProperty('--kb-inset')
    }
  }, [])
}
